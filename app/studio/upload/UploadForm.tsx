'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { UploadCloud, CheckCircle2 } from 'lucide-react'
import { createUploadDraft, finalizeUpload } from '@/lib/studio/video-actions'
import { VideoMetadataFields } from '@/components/studio/VideoMetadataFields'
import { PromoPicker, type PromoSelection } from '@/components/studio/PromoPicker'
import { FormMessage } from '@/components/form'
import { ACCEPTED_VIDEO_TYPES, MAX_UPLOAD_BYTES } from '@/lib/constants'
import type { Category, Model, Paysite } from '@/types/database'

type Phase = 'idle' | 'creating' | 'uploading' | 'finalizing' | 'done'

/**
 * Three-step upload, driven manually rather than through useActionState,
 * because the middle step is a raw byte transfer that has to report progress.
 *
 *   1. createUploadDraft  — server action; makes the row, returns a target
 *   2. PUT the file       — straight to the provider, never through an action
 *   3. finalizeUpload     — server action; queues the transcode job
 *
 * XMLHttpRequest is used for step 2 specifically because fetch() still cannot
 * report upload progress, and a multi-gigabyte upload with no progress bar
 * looks indistinguishable from a hang.
 */
export function UploadForm({
  categories,
  paysites,
  models,
}: {
  categories: Category[]
  paysites: Paysite[]
  models: Model[]
}) {
  const formRef = useRef<HTMLFormElement>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})
  const [file, setFile] = useState<File | null>(null)
  const [promo, setPromo] = useState<PromoSelection | null>(null)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setFieldErrors({})

    if (!file) {
      setError('Choose a video file first.')
      revealFirstError()
      return
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      setError('That file is larger than the 8 GB limit.')
      revealFirstError()
      return
    }

    const formData = new FormData(event.currentTarget)
    formData.set('filename', file.name)
    formData.set('contentType', file.type || 'video/mp4')
    formData.set('sizeBytes', String(file.size))

    // --- 1. Create the draft ---------------------------------------------
    setPhase('creating')
    const draft = await createUploadDraft(null, formData)

    if (!draft || draft.error || draft.fieldErrors) {
      setPhase('idle')
      setError(draft?.error ?? null)
      setFieldErrors(draft?.fieldErrors ?? {})
      revealFirstError()
      return
    }

    if (!draft.upload || !draft.videoId) {
      setPhase('idle')
      setError('The server did not return an upload target.')
      return
    }

    // --- 2. Send the bytes -------------------------------------------------
    setPhase('uploading')
    try {
      await sendFile(draft.upload, file, setProgress)
    } catch (uploadError) {
      setPhase('idle')
      setError(
        uploadError instanceof Error ? uploadError.message : 'The upload failed.',
      )
      return
    }

    // --- 3. Queue processing ----------------------------------------------
    setPhase('finalizing')
    const finalizeData = new FormData()
    finalizeData.set('videoId', draft.videoId)
    const finalized = await finalizeUpload(null, finalizeData)

    if (finalized?.error) {
      setPhase('idle')
      setError(finalized.error)
      return
    }

    setPhase('done')
    formRef.current?.reset()
  }

  if (phase === 'done') {
    return (
      <div className="rounded-xl border border-success/30 bg-success/10 p-5">
        <CheckCircle2 size={22} className="text-success" aria-hidden />
        <h3 className="mt-2 text-sm font-semibold text-success">Upload complete</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          Your video is being processed. Once that finishes it goes into the
          moderation queue, and appears publicly after approval.
        </p>
        <div className="mt-3 flex gap-2">
          <Link
            href="/studio/videos"
            className="rounded-lg bg-accent px-3.5 py-2 text-xs font-semibold text-accent-contrast hover:bg-accent-hover"
          >
            View my videos
          </Link>
          <button
            type="button"
            onClick={() => {
              setPhase('idle')
              setProgress(0)
              setFile(null)
              setPromo(null)
            }}
            className="rounded-lg border border-border px-3.5 py-2 text-xs font-medium text-muted hover:bg-surface-raised"
          >
            Upload another
          </button>
        </div>
      </div>
    )
  }

  const busy = phase !== 'idle'

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      className="space-y-4 rounded-xl border border-border bg-surface p-4"
    >
      <FormMessage error={error ?? undefined} />

      <div>
        <label htmlFor="file" className="block text-xs font-medium">
          Video file <span className="text-danger">*</span>
        </label>
        <label
          htmlFor="file"
          className="mt-1 flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border bg-background px-4 py-8 text-center hover:border-accent"
        >
          <UploadCloud size={22} className="text-muted" aria-hidden />
          {file ? (
            <>
              <span className="text-xs font-medium">{file.name}</span>
              <span className="text-[11px] text-muted">
                {(file.size / 1024 / 1024).toFixed(1)} MB
              </span>
            </>
          ) : (
            <>
              <span className="text-xs font-medium">Choose a video file</span>
              <span className="text-[11px] text-muted">
                MP4, MOV, MKV, WebM or AVI · up to 8 GB
              </span>
            </>
          )}
        </label>
        <input
          id="file"
          type="file"
          accept={ACCEPTED_VIDEO_TYPES.join(',')}
          disabled={busy}
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null)
            setPromo(null)
          }}
          className="sr-only"
        />
      </div>

      {/* The promo is chosen before anything is uploaded, from the local file.
          It comes directly after the file picker and before the details,
          because deciding which part of the video represents it is what tells
          you which categories actually apply. */}
      {file && <PromoPicker file={file} onChange={setPromo} />}

      <VideoMetadataFields
        categories={categories}
        paysites={paysites}
        models={models}
        fieldErrors={fieldErrors}
        showSourceOnly
      />

      {phase === 'uploading' && (
        <div>
          <div className="flex justify-between text-xs text-muted">
            <span>Uploading…</span>
            <span className="tabular-nums">{progress}%</span>
          </div>
          <div
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
            className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-raised"
          >
            <div
              className="h-full bg-accent transition-[width]"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-contrast hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
      >
        {phase === 'creating' && 'Preparing…'}
        {phase === 'uploading' && `Uploading ${progress}%`}
        {phase === 'finalizing' && 'Queueing…'}
        {phase === 'idle' && 'Upload video'}
      </button>
    </form>
  )
}

/**
 * Bring the first problem into view.
 *
 * The submit button sits at the bottom of a long form while errors render at
 * the top, so without this a failed submit looks like nothing happened at all
 * — the user is staring at a button that appears inert.
 */
function revealFirstError() {
  // Let React paint the error nodes before trying to scroll to one.
  requestAnimationFrame(() => {
    const target =
      document.querySelector('[aria-invalid="true"]') ??
      document.querySelector('[role="status"]')

    target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    if (target instanceof HTMLElement) target.focus?.({ preventScroll: true })
  })
}

type Target = { url: string; method: string; headers: Record<string, string> }

/**
 * Send the file using whichever protocol the provider asked for.
 *
 * The local driver takes a plain PUT. Bunny requires TUS, a resumable
 * protocol — a simple PUT to its upload endpoint is rejected. The headers in
 * either case are safe to expose: for Bunny they carry a short-lived signature
 * scoped to one video, never the library API key.
 */
function sendFile(
  target: Target,
  file: File,
  onProgress: (percent: number) => void,
): Promise<void> {
  return target.method === 'TUS'
    ? tusUpload(target, file, onProgress)
    : putWithProgress(target, file, onProgress)
}

async function tusUpload(
  target: Target,
  file: File,
  onProgress: (percent: number) => void,
): Promise<void> {
  const tus = await import('tus-js-client')

  return new Promise((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint: target.url,
      // A dropped connection mid-upload is normal on a large file; resume
      // rather than making the user start a multi-gigabyte transfer again.
      retryDelays: [0, 3000, 5000, 10000, 20000, 60000],
      headers: target.headers,
      // Bunny gives every video the same TUS endpoint, and the default
      // fingerprint is just the file plus that endpoint. Uploading a file a
      // second time therefore matched the FIRST video's finished upload,
      // resumed it, and reported success within a second — while the new video
      // received nothing and sat in Processing forever with zero bytes stored.
      // Naming the video in the fingerprint keeps one video's upload from ever
      // standing in for another's.
      fingerprint: async (candidate: File) =>
        [
          'tus',
          target.headers.VideoId ?? target.url,
          candidate.name,
          candidate.type,
          candidate.size,
          candidate.lastModified,
        ].join('/'),
      metadata: {
        filetype: file.type || 'video/mp4',
        title: file.name,
      },
      onProgress: (uploaded, total) => {
        if (total) onProgress(Math.round((uploaded / total) * 100))
      },
      onSuccess: () => resolve(),
      onError: (error) =>
        reject(new Error(error instanceof Error ? error.message : 'The upload failed.')),
    })

    // Pick up an interrupted attempt at this same video — a reload part-way
    // through a large upload, say. Within one attempt retryDelays above
    // already covers a dropped connection.
    upload.findPreviousUploads().then((previous) => {
      if (previous.length > 0) upload.resumeFromPreviousUpload(previous[0])
      upload.start()
    })
  })
}

function putWithProgress(
  target: Target,
  file: File,
  onProgress: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open(target.method, target.url)

    for (const [key, value] of Object.entries(target.headers)) {
      request.setRequestHeader(key, value)
    }

    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100))
      }
    })

    request.addEventListener('load', () => {
      if (request.status >= 200 && request.status < 300) {
        resolve()
        return
      }
      let message = `Upload failed (${request.status}).`
      try {
        const body = JSON.parse(request.responseText)
        if (body?.error) message = body.error
      } catch {
        // Non-JSON error body; the status message above is enough.
      }
      reject(new Error(message))
    })

    request.addEventListener('error', () =>
      reject(new Error('The connection dropped during upload.')),
    )
    request.addEventListener('abort', () =>
      reject(new Error('The upload was cancelled.')),
    )

    request.send(file)
  })
}
