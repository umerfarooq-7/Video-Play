#!/usr/bin/env node
/**
 * Transcode worker.
 *
 * Long-running process, deliberately separate from the Next.js app: ffmpeg
 * jobs run for minutes and would blow every serverless timeout there is.
 *
 *   node worker/index.mjs
 *
 * Claims work with claim_ingest_job(), which uses FOR UPDATE SKIP LOCKED, so
 * you can run as many of these as you have CPU for without two picking up the
 * same job.
 *
 * Requires ffmpeg and ffprobe on PATH.
 */

import { createClient } from '@supabase/supabase-js'
import { spawn } from 'node:child_process'
import { mkdir, rm, stat, readdir } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { randomUUID } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

// Load .env.local without adding a dependency.
for (const file of ['.env.local', '.env']) {
  if (!existsSync(file)) continue
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq)
    if (process.env[key] === undefined) {
      process.env[key] = trimmed.slice(eq + 1).trim()
    }
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const MEDIA_ROOT = resolve(process.env.LOCAL_MEDIA_ROOT ?? './.media')
const WORKER_ID = `${process.env.HOSTNAME ?? 'worker'}-${randomUUID().slice(0, 8)}`
const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_MS ?? 5000)
const MAX_DOWNLOAD_BYTES = Number(process.env.WORKER_MAX_BYTES ?? 8 * 1024 * 1024 * 1024)

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.\n' +
      'The worker writes back transcode results, which RLS forbids for ordinary users.',
  )
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

/**
 * Rendition ladder. Anything taller than the source is skipped, because
 * upscaling burns CPU to produce a bigger file that looks no better.
 */
const LADDER = [
  { label: '360p', height: 360, videoBitrate: '800k', audioBitrate: '96k' },
  { label: '480p', height: 480, videoBitrate: '1400k', audioBitrate: '128k' },
  { label: '720p', height: 720, videoBitrate: '2800k', audioBitrate: '128k' },
  { label: '1080p', height: 1080, videoBitrate: '5000k', audioBitrate: '192k' },
]

// Bunny Stream. Only needed for the clip tool: uploads and URL imports go to
// Bunny directly from the app, but cutting a promo needs ffmpeg, so the worker
// pulls the source down, cuts it, and pushes the result back.
const BUNNY_API = 'https://video.bunnycdn.com'
const BUNNY_LIBRARY_ID = process.env.VIDEO_PROVIDER_LIBRARY_ID
const BUNNY_API_KEY = process.env.VIDEO_PROVIDER_API_KEY
const CDN_BASE = (process.env.VIDEO_CDN_BASE_URL ?? '').replace(/\/$/, '')
// Bunny's hotlink protection rejects requests with no Referer, and ffmpeg
// sends none by default — so every pull from the CDN has to spoof one.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'

const log = (...args) => console.log(`[${new Date().toISOString()}]`, ...args)

function requireBunny() {
  if (!BUNNY_LIBRARY_ID || !BUNNY_API_KEY || !CDN_BASE) {
    throw new Error(
      'Cutting from a Bunny source needs VIDEO_PROVIDER_LIBRARY_ID, ' +
        'VIDEO_PROVIDER_API_KEY and VIDEO_CDN_BASE_URL to be set.',
    )
  }
}

async function bunnyCreateVideo(title) {
  requireBunny()

  const response = await fetch(`${BUNNY_API}/library/${BUNNY_LIBRARY_ID}/videos`, {
    method: 'POST',
    headers: { AccessKey: BUNNY_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ title: String(title).slice(0, 200) }),
  })

  if (!response.ok) {
    throw new Error(`Bunny createVideo failed: ${response.status} ${await response.text()}`)
  }

  const { guid } = await response.json()
  if (!guid) throw new Error('Bunny createVideo returned no guid.')
  return guid
}

async function bunnyUpload(guid, filePath) {
  requireBunny()

  const { size } = await stat(filePath)

  // Streamed rather than buffered: a ten-minute promo can be hundreds of
  // megabytes, and reading it into memory would be wasteful on a small worker.
  const response = await fetch(`${BUNNY_API}/library/${BUNNY_LIBRARY_ID}/videos/${guid}`, {
    method: 'PUT',
    headers: { AccessKey: BUNNY_API_KEY, 'content-length': String(size) },
    body: Readable.toWeb(createReadStream(filePath)),
    duplex: 'half',
  })

  if (!response.ok) {
    throw new Error(`Bunny upload failed: ${response.status} ${await response.text()}`)
  }
}

// ---------------------------------------------------------------------------
// Binary resolution
//
// Prefer a system ffmpeg (usually newer and hardware-accelerated), but fall
// back to the npm-installed static binaries so the worker runs without any
// system package manager. That matters on Windows, where installing ffmpeg
// otherwise means winget/choco or a manual PATH edit.
// ---------------------------------------------------------------------------

const require = createRequire(import.meta.url)

function onPath(binary) {
  try {
    execFileSync(binary, ['-version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function resolveBinaries() {
  let ffmpegPath = 'ffmpeg'
  let ffprobePath = 'ffprobe'
  let source = 'system PATH'

  if (!onPath('ffmpeg') || !onPath('ffprobe')) {
    try {
      ffmpegPath = require('ffmpeg-static')
      ffprobePath = require('ffprobe-static').path
      source = 'npm (ffmpeg-static / ffprobe-static)'
    } catch {
      return null
    }
  }

  return { ffmpegPath, ffprobePath, source }
}

const binaries = resolveBinaries()
const FFMPEG = binaries?.ffmpegPath ?? 'ffmpeg'
const FFPROBE = binaries?.ffprobePath ?? 'ffprobe'

// ---------------------------------------------------------------------------
// Process helpers
// ---------------------------------------------------------------------------

function run(command, args, { onStderr } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args)
    let stderr = ''

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString()
      stderr += text
      onStderr?.(text)
      // ffmpeg is chatty; keeping only the tail bounds memory on long jobs.
      if (stderr.length > 20000) stderr = stderr.slice(-10000)
    })

    child.on('error', reject)
    child.on('close', (code, signal) => {
      if (code === 0) return resolvePromise()

      // 143 = 128 + SIGTERM, 130 = 128 + SIGINT. The process was killed
      // deliberately (shutdown, a supervisor, a timeout), which is not a fault
      // in the media and should read as such when the uploader sees it.
      if (signal || code === 143 || code === 130) {
        return reject(
          new Error('Processing was interrupted before it finished. It will be retried.'),
        )
      }

      reject(new Error(`Transcoding failed.\n${meaningfulStderr(stderr)}`))
    })
  })
}

/**
 * ffmpeg writes a continuous progress feed to stderr ("frame=… fps=… time=…")
 * plus routine muxer chatter. Storing that verbatim buries the actual error and
 * fills the uploader's screen with noise, so keep only lines that look like a
 * real diagnostic.
 */
function meaningfulStderr(stderr) {
  const noise = /^\s*(frame=|size=|video:|audio:|\[hls @|Opening '|Press \[q\])/
  const lines = stderr
    .split(/[\r\n]+/)
    .map((line) => line.trim())
    .filter((line) => line && !noise.test(line))

  return lines.slice(-6).join('\n').slice(0, 800) || 'No further detail available.'
}

function runJson(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args)
    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (c) => (stdout += c))
    child.stderr.on('data', (c) => (stderr += c))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`${command} failed: ${stderr.slice(-500)}`))
      try {
        resolvePromise(JSON.parse(stdout))
      } catch (error) {
        reject(new Error(`Could not parse ${command} output: ${error.message}`))
      }
    })
  })
}

async function probe(file) {
  const data = await runJson(FFPROBE, [
    '-v', 'error',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    file,
  ])

  const video = data.streams?.find((s) => s.codec_type === 'video')
  if (!video) throw new Error('No video stream found in the file.')

  return {
    durationSeconds: Math.round(Number(data.format?.duration ?? 0)),
    width: Number(video.width ?? 0),
    height: Number(video.height ?? 0),
    sizeBytes: Number(data.format?.size ?? 0),
  }
}

// ---------------------------------------------------------------------------
// Remote download
// ---------------------------------------------------------------------------

function isPrivateAddress(ip) {
  const version = isIP(ip)

  if (version === 4) {
    const [a, b] = ip.split('.').map(Number)
    if (a === 0 || a === 10 || a === 127) return true
    if (a === 169 && b === 254) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && (b === 168 || b === 0)) return true
    if (a === 100 && b >= 64 && b <= 127) return true
    if (a >= 224) return true
    return false
  }

  if (version === 6) {
    const norm = ip.toLowerCase()
    if (norm === '::' || norm === '::1') return true
    if (norm.startsWith('fe80') || norm.startsWith('fc') || norm.startsWith('fd')) return true
    const mapped = norm.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (mapped) return isPrivateAddress(mapped[1])
    return false
  }

  return true
}

/**
 * Re-validate the URL at fetch time.
 *
 * The app already checked it before writing the job, but DNS can resolve
 * differently by the time a worker picks the job up — that is exactly the DNS
 * rebinding window. Checking again here shrinks it. It does not close it
 * completely: run the worker with egress firewalled to private ranges for
 * that. See docs/COMPLIANCE.md section 7.
 */
async function assertSafeUrl(rawUrl) {
  const url = new URL(rawUrl)

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Only http and https URLs can be fetched.')
  }

  const host = url.hostname.replace(/^\[|\]$/g, '')
  const address = isIP(host) ? host : (await lookup(host)).address

  if (isPrivateAddress(address)) {
    throw new Error(`Refusing to fetch ${host}: resolves to a private address.`)
  }

  return url.toString()
}

async function download(rawUrl, destination, onProgress) {
  const safeUrl = await assertSafeUrl(rawUrl)
  const response = await fetch(safeUrl, { redirect: 'follow' })

  if (!response.ok || !response.body) {
    throw new Error(`Download failed with HTTP ${response.status}.`)
  }

  const total = Number(response.headers.get('content-length')) || 0
  let received = 0

  const source = Readable.fromWeb(response.body)
  source.on('data', (chunk) => {
    received += chunk.length
    if (received > MAX_DOWNLOAD_BYTES) {
      source.destroy(new Error('Remote file exceeds the size limit.'))
      return
    }
    if (total) onProgress(Math.round((received / total) * 100))
  })

  await pipeline(source, createWriteStream(destination))
  return received
}

// ---------------------------------------------------------------------------
// Transcoding
// ---------------------------------------------------------------------------

async function buildHls(input, outputDir, meta, onProgress) {
  await mkdir(outputDir, { recursive: true })

  // Never upscale. Always keep at least the smallest rung so tiny sources
  // still produce a playable ladder.
  const rungs = LADDER.filter((r) => r.height <= meta.height)
  if (rungs.length === 0) rungs.push(LADDER[0])

  const args = ['-y', '-i', input]
  const filters = []
  const varStreamMap = []

  rungs.forEach((rung, index) => {
    // -2 keeps the width even, which H.264 requires.
    filters.push(`[0:v]scale=-2:${rung.height}[v${index}]`)
    varStreamMap.push(`v:${index},a:${index},name:${rung.label}`)
  })

  args.push('-filter_complex', filters.join(';'))

  rungs.forEach((rung, index) => {
    args.push(
      '-map', `[v${index}]`,
      `-c:v:${index}`, 'libx264',
      `-b:v:${index}`, rung.videoBitrate,
      `-preset`, 'veryfast',
      `-profile:v:${index}`, 'main',
      '-map', '0:a:0?',
      `-c:a:${index}`, 'aac',
      `-b:a:${index}`, rung.audioBitrate,
    )
  })

  args.push(
    '-f', 'hls',
    '-hls_time', '6',
    '-hls_playlist_type', 'vod',
    '-hls_flags', 'independent_segments',
    '-hls_segment_filename', join(outputDir, 'stream_%v_%03d.ts'),
    '-master_pl_name', 'master.m3u8',
    '-var_stream_map', varStreamMap.join(' '),
    join(outputDir, 'stream_%v.m3u8'),
  )

  // ffmpeg reports progress as elapsed media time; convert to a percentage.
  const durationUs = (meta.durationSeconds || 1) * 1_000_000
  await run(FFMPEG, args, {
    onStderr: (text) => {
      const match = /time=(\d+):(\d+):(\d+\.\d+)/.exec(text)
      if (!match) return
      const [, h, m, s] = match
      const elapsedUs = (Number(h) * 3600 + Number(m) * 60 + Number(s)) * 1_000_000
      onProgress(Math.min(99, Math.round((elapsedUs / durationUs) * 100)))
    },
  })

  return rungs
}

async function buildThumbnail(input, outputDir, meta) {
  // 25% in avoids the black frames and title cards that often open a video.
  const at = Math.max(1, Math.floor((meta.durationSeconds || 4) * 0.25))

  await run(FFMPEG, [
    '-y', '-ss', String(at), '-i', input,
    '-vframes', '1',
    '-vf', 'scale=1280:-2',
    '-q:v', '3',
    join(outputDir, 'thumb.jpg'),
  ])

  // Storyboard sprite for seek-bar previews: one frame every 10s, 10 per row.
  await run(FFMPEG, [
    '-y', '-i', input,
    '-vf', "fps=1/10,scale=160:-2,tile=10x10",
    '-frames:v', '1',
    '-q:v', '5',
    join(outputDir, 'sprite.jpg'),
  ]).catch(() => {
    // A missing sprite degrades hover previews but must not fail the job.
  })
}

// ---------------------------------------------------------------------------
// Job handling
// ---------------------------------------------------------------------------

async function setProgress(jobId, progress) {
  await supabase.from('ingest_jobs').update({ progress }).eq('id', jobId)
}

async function processJob(job) {
  log(`claimed ${job.kind} job ${job.id} for video ${job.video_id}`)

  const workDir = join(MEDIA_ROOT, job.video_id)
  const sourcePath = join(workDir, 'source-input')
  await mkdir(workDir, { recursive: true })

  let input

  if (job.kind === 'remote_url') {
    log(`downloading ${job.source_url}`)
    await download(job.source_url, sourcePath, (p) =>
      setProgress(job.id, Math.round(p * 0.3)),
    )
    input = sourcePath
  } else if (job.kind === 'direct_upload') {
    input = join(MEDIA_ROOT, job.source_path)
    await stat(input) // throws with a clear ENOENT if the upload vanished
  } else if (job.kind === 'clip') {
    const { data: source } = await supabase
      .from('videos')
      .select('id, provider, provider_asset_id, playback_hls_path')
      .eq('id', job.clip_source_id)
      .single()

    if (!source?.provider_asset_id) {
      throw new Error('The source video has no media to cut from.')
    }

    input = join(workDir, 'clip-input.mp4')
    const preArgs = ['-y']
    let sourceInput

    if (source.provider === 'bunny') {
      // Nothing is on local disk — pull the section straight off the CDN.
      // ffmpeg reads HLS natively, so only the part of the movie inside the
      // cut window gets downloaded, not the whole file.
      requireBunny()
      sourceInput = `${CDN_BASE}/${source.playback_hls_path ?? `${source.provider_asset_id}/playlist.m3u8`}`
      preArgs.push('-headers', `Referer: ${SITE_URL}/\r\n`)
      log(`cutting from Bunny source ${sourceInput}`)
    } else {
      // Local: cut from the original upload rather than the HLS renditions —
      // the mezzanine is higher quality and seeks frame-accurately.
      sourceInput = join(MEDIA_ROOT, source.provider_asset_id)
      await stat(sourceInput)
    }

    await run(FFMPEG, [
      ...preArgs,
      // -ss before -i seeks by keyframe (fast, and over HLS it skips whole
      // segments); re-encoding below makes the cut frame-accurate anyway.
      '-ss', String(job.clip_start_seconds),
      '-to', String(job.clip_end_seconds),
      '-i', sourceInput,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
      '-c:a', 'aac',
      input,
    ])
  } else {
    throw new Error(`Unknown job kind: ${job.kind}`)
  }

  const meta = await probe(input)
  log(`probed: ${meta.width}x${meta.height}, ${meta.durationSeconds}s`)

  await setProgress(job.id, 35)

  // Where does the finished file belong? The output video inherits its
  // provider from the source, so a promo cut from a Bunny movie goes back to
  // Bunny rather than into the local HLS pipeline below.
  const { data: outputVideo } = await supabase
    .from('videos')
    .select('provider, title')
    .eq('id', job.video_id)
    .single()

  // A preview job cuts the hover clip for a video that already exists. It must
  // not touch that video's own asset or status — only hang the finished clip
  // on it. Everything else about the row stays exactly as the moderator left
  // it, which matters because this runs after the video is already in review.
  if (job.is_preview) {
    if (outputVideo?.provider !== 'bunny') {
      throw new Error('Preview cuts are only implemented for the bunny provider.')
    }

    log('uploading hover preview to Bunny')
    const guid = await bunnyCreateVideo(
      `${outputVideo.title ?? 'Video'} — preview`,
    )
    await bunnyUpload(guid, input)

    // /original is the file we just sent, served straight back. No wait for
    // Bunny to encode: a ten-second muted loop needs no rendition ladder, and
    // waiting would leave the grid on the default preview for several minutes.
    await supabase
      .from('videos')
      .update({ preview_clip_path: `${guid}/original` })
      .eq('id', job.video_id)

    await supabase
      .from('ingest_jobs')
      .update({
        status: 'succeeded',
        progress: 100,
        finished_at: new Date().toISOString(),
        locked_by: null,
      })
      .eq('id', job.id)

    await rm(input, { force: true })
    log(`finished preview job ${job.id} (${guid})`)
    return
  }

  if (outputVideo?.provider === 'bunny') {
    log('uploading cut to Bunny')

    const guid = await bunnyCreateVideo(outputVideo.title ?? 'Promo')

    // Record the guid before uploading: Bunny's webhook looks the video up by
    // provider_asset_id, and on a fast encode the callback can arrive before
    // the upload call has even returned.
    await supabase
      .from('videos')
      .update({ provider_asset_id: guid, status: 'processing' })
      .eq('id', job.video_id)

    await bunnyUpload(guid, input)
    await setProgress(job.id, 100)

    // Deliberately NOT set to pending_review here — Bunny still has to encode
    // it, and its webhook is what moves it on with the real duration and
    // thumbnail. Marking it ready now would publish a video that cannot play.
    await supabase
      .from('ingest_jobs')
      .update({
        status: 'succeeded',
        progress: 100,
        finished_at: new Date().toISOString(),
        locked_by: null,
      })
      .eq('id', job.id)

    // The local cut is only a staging file; Bunny holds the master now.
    await rm(input, { force: true })

    log(`finished job ${job.id} (handed to Bunny as ${guid})`)
    return
  }

  const hlsDir = join(workDir, 'hls')
  const rungs = await buildHls(input, hlsDir, meta, (p) =>
    setProgress(job.id, 35 + Math.round(p * 0.55)),
  )

  await buildThumbnail(input, workDir, meta)
  await setProgress(job.id, 95)

  // Record each rendition that actually landed on disk.
  const produced = await readdir(hlsDir)
  const renditions = rungs
    .filter((rung) => produced.some((f) => f.includes(rung.label)))
    .map((rung) => ({
      video_id: job.video_id,
      label: rung.label,
      height: rung.height,
      bitrate_kbps: parseInt(rung.videoBitrate, 10),
      codec: 'h264',
      path: `${job.video_id}/hls/stream_${rung.label}.m3u8`,
    }))

  if (renditions.length > 0) {
    await supabase.from('video_renditions').upsert(renditions, {
      onConflict: 'video_id,label',
    })
  }

  // Hand the video to moderation. Never straight to 'published' — approval is
  // a human decision, and the worker must not be able to make it.
  await supabase
    .from('videos')
    .update({
      status: 'pending_review',
      duration_seconds: meta.durationSeconds,
      width: meta.width,
      height: meta.height,
      size_bytes: meta.sizeBytes,
      playback_hls_path: `${job.video_id}/hls/master.m3u8`,
      thumbnail_path: `${job.video_id}/thumb.jpg`,
      preview_sprite_path: `${job.video_id}/sprite.jpg`,
    })
    .eq('id', job.video_id)

  await supabase
    .from('ingest_jobs')
    .update({
      status: 'succeeded',
      progress: 100,
      finished_at: new Date().toISOString(),
      locked_by: null,
    })
    .eq('id', job.id)

  // The downloaded original for a URL import is no longer needed once the
  // ladder exists; uploads keep theirs so clips can be cut later.
  if (job.kind === 'remote_url') {
    await rm(sourcePath, { force: true })
  }

  log(`finished job ${job.id}`)
}

async function failJob(job, error) {
  const message = error?.message ?? String(error)
  log(`job ${job.id} failed: ${message}`)

  const exhausted = job.attempts >= job.max_attempts

  await supabase
    .from('ingest_jobs')
    .update({
      status: exhausted ? 'failed' : 'queued',
      error: message.slice(0, 2000),
      locked_by: null,
      locked_at: null,
      ...(exhausted ? { finished_at: new Date().toISOString() } : {}),
    })
    .eq('id', job.id)

  if (exhausted) {
    await supabase.from('videos').update({ status: 'failed' }).eq('id', job.video_id)
  }
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

let running = true

async function tick() {
  const { data: job, error } = await supabase.rpc('claim_ingest_job', {
    worker_id: WORKER_ID,
  })

  if (error) {
    log('claim failed:', error.message)
    return
  }
  if (!job) return

  try {
    await processJob(job)
  } catch (jobError) {
    await failJob(job, jobError)
  }
}

async function main() {
  // Fail loudly at startup rather than on the first job.
  if (!binaries) {
    console.error(
      'Could not find ffmpeg and ffprobe.\n\n' +
        'Easiest fix (no system package manager needed):\n' +
        '  npm install --save-dev ffmpeg-static ffprobe-static\n\n' +
        'Or install them system-wide:\n' +
        '  macOS:   brew install ffmpeg\n' +
        '  Ubuntu:  sudo apt install ffmpeg\n' +
        '  Windows: winget install Gyan.FFmpeg  (then reopen the terminal)',
    )
    process.exit(1)
  }

  try {
    await run(FFMPEG, ['-version'])
    await run(FFPROBE, ['-version'])
  } catch (error) {
    console.error(`ffmpeg/ffprobe are present but would not run: ${error.message}`)
    process.exit(1)
  }

  log(`using ffmpeg from ${binaries.source}`)

  await mkdir(MEDIA_ROOT, { recursive: true })
  log(`worker ${WORKER_ID} started; media root ${MEDIA_ROOT}`)

  // Return jobs abandoned by workers that died mid-flight.
  const sweeper = setInterval(async () => {
    const { data } = await supabase.rpc('reclaim_stalled_ingest_jobs', {})
    if (data) log(`reclaimed ${data} stalled job(s)`)
  }, 10 * 60 * 1000)

  const stop = (signal) => {
    log(`${signal} received; finishing the current job then exiting.`)
    running = false
    clearInterval(sweeper)
  }
  process.on('SIGINT', () => stop('SIGINT'))
  process.on('SIGTERM', () => stop('SIGTERM'))

  while (running) {
    await tick()
    if (running) await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
  }

  log('worker stopped')
  process.exit(0)
}

main().catch((error) => {
  console.error('worker crashed:', error)
  process.exit(1)
})
