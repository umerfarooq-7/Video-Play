'use client'

import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  EncodedAudioPacketSource,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  Input,
  Mp4OutputFormat,
  Output,
  type EncodedPacket,
  type InputAudioTrack,
  type InputVideoTrack,
} from 'mediabunny'

export interface Scene {
  start: number
  end: number
}

export interface CutResult {
  /** The joined scenes, ready to upload in place of the original. */
  file: File
  /**
   * Where each scene really starts and ends in the source. Wider than what was
   * asked for, because a cut can only begin on a keyframe.
   */
  segments: Scene[]
  /** Length of the output, in seconds. */
  duration: number
}

/**
 * Join chosen scenes of a local video into one short MP4, entirely in the
 * browser, so only the promo is uploaded rather than the full movie.
 *
 * Nothing is re-encoded. Compressed packets are copied across with their
 * timestamps shifted, which makes a cut out of a forty-minute file take
 * seconds instead of minutes and leaves quality untouched. The price is that a
 * scene can only start on a keyframe, so each one is widened to the keyframe
 * before its start and the keyframe after its end — usually a second or two.
 *
 * The source is read piecemeal through a BlobSource, so a multi-gigabyte movie
 * is never loaded into memory; only the promo being built is.
 */
export async function cutScenes(
  source: File,
  requested: Scene[],
  onProgress?: (fraction: number) => void,
): Promise<CutResult> {
  const input = new Input({ source: new BlobSource(source), formats: ALL_FORMATS })

  try {
    const video = await input.getPrimaryVideoTrack()
    if (!video) throw new Error('No video track was found in this file.')
    if (!video.codec) throw new Error('The video codec of this file is not supported.')

    const audio = await input.getPrimaryAudioTrack()
    // An audio track we cannot identify is dropped rather than failing the cut:
    // a silent promo is still a promo.
    const usableAudio = audio?.codec ? audio : null

    const videoSink = new EncodedPacketSink(video)
    const trackEnd = await video.computeDuration()

    const segments = await expandToKeyframes(videoSink, requested, trackEnd)
    if (segments.length === 0) throw new Error('None of the chosen scenes fall inside the video.')

    const totalSeconds = segments.reduce((sum, s) => sum + (s.end - s.start), 0)

    const target = new BufferTarget()
    const output = new Output({
      // Moov at the front so the upload can start playing before it is fully
      // fetched. The whole promo is already held in memory, so this is free.
      format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
      target,
    })

    const videoOut = new EncodedVideoPacketSource(video.codec)
    output.addVideoTrack(videoOut, { rotation: video.rotation })

    const audioOut = usableAudio ? new EncodedAudioPacketSource(usableAudio.codec!) : null
    if (audioOut) output.addAudioTrack(audioOut)

    await output.start()

    // The two tracks are copied side by side rather than one after the other,
    // so a muxer that waits for both tracks to reach a timestamp can never be
    // left waiting on a track that has not started yet.
    await Promise.all([
      copyVideo(video, videoSink, videoOut, segments, (done) =>
        onProgress?.(Math.min(1, done / totalSeconds)),
      ),
      usableAudio && audioOut
        ? copyAudio(usableAudio, audioOut, segments)
        : Promise.resolve(),
    ])

    await output.finalize()

    if (!target.buffer) throw new Error('The promo came out empty.')

    const base = source.name.replace(/\.[^.]+$/, '') || 'video'
    const file = new File([target.buffer], `${base}-promo.mp4`, { type: 'video/mp4' })

    onProgress?.(1)
    return { file, segments, duration: totalSeconds }
  } finally {
    input.dispose()
  }
}

/**
 * Widen each scene to whole GOPs and merge any that now overlap.
 *
 * Starting on a keyframe is required for the first frame to decode at all.
 * Ending on one keeps the tail intact: stopping mid-GOP can drop B-frames that
 * are stored after the cut point but displayed before it.
 */
async function expandToKeyframes(
  sink: EncodedPacketSink,
  requested: Scene[],
  trackEnd: number,
): Promise<Scene[]> {
  const widened: Scene[] = []

  for (const scene of [...requested].sort((a, b) => a.start - b.start)) {
    const start = Math.max(0, scene.start)
    const end = Math.min(trackEnd, scene.end)
    if (end <= start) continue

    const startKey = (await sink.getKeyPacket(start)) ?? (await sink.getFirstKeyPacket())
    if (!startKey) continue

    // The first keyframe at or after `end`: the last one at or before it, or
    // the one following that when it falls short.
    let endKey = await sink.getKeyPacket(end)
    while (endKey && endKey.timestamp < end) {
      endKey = await sink.getNextKeyPacket(endKey)
    }

    const segmentEnd = endKey ? endKey.timestamp : trackEnd
    if (segmentEnd > startKey.timestamp) {
      widened.push({ start: startKey.timestamp, end: segmentEnd })
    }
  }

  const merged: Scene[] = []
  for (const segment of widened) {
    const last = merged[merged.length - 1]
    if (last && segment.start <= last.end) last.end = Math.max(last.end, segment.end)
    else merged.push({ ...segment })
  }
  return merged
}

async function copyVideo(
  track: InputVideoTrack,
  sink: EncodedPacketSink,
  out: EncodedVideoPacketSource,
  segments: Scene[],
  onCopied: (seconds: number) => void,
) {
  const decoderConfig = (await track.getDecoderConfig()) ?? undefined
  let first = true
  let offset = 0

  for (const segment of segments) {
    const startKey = await sink.getKeyPacket(segment.start)
    if (!startKey) continue

    // A keyframe sitting exactly on the segment end is where iteration stops;
    // at the end of the track there is none, and iteration runs to the last
    // packet.
    const endKey = segment.end < Infinity ? await keyAt(sink, segment.end) : null

    for await (const packet of sink.packets(startKey, endKey ?? undefined)) {
      // Leading B-frames of an open GOP display before the keyframe and depend
      // on the previous GOP, which is not in the promo. They would show as
      // garbage, so they are dropped.
      if (packet.timestamp < segment.start || packet.timestamp >= segment.end) continue

      await out.add(
        shift(packet, offset - segment.start),
        first ? { decoderConfig } : undefined,
      )
      first = false
    }

    offset += segment.end - segment.start
    onCopied(offset)
  }
}

async function copyAudio(
  track: InputAudioTrack,
  out: EncodedAudioPacketSource,
  segments: Scene[],
) {
  const sink = new EncodedPacketSink(track)
  const decoderConfig = (await track.getDecoderConfig()) ?? undefined
  let first = true
  let offset = 0

  for (const segment of segments) {
    const startPacket = await sink.getPacket(segment.start)
    if (startPacket) {
      for await (const packet of sink.packets(startPacket)) {
        if (packet.timestamp >= segment.end) break
        // A frame straddling the start would overlap the previous scene.
        if (packet.timestamp < segment.start) continue

        await out.add(
          shift(packet, offset - segment.start),
          first ? { decoderConfig } : undefined,
        )
        first = false
      }
    }
    offset += segment.end - segment.start
  }
}

/** The keyframe whose timestamp is exactly `timestamp`, if there is one. */
async function keyAt(sink: EncodedPacketSink, timestamp: number) {
  const key = await sink.getKeyPacket(timestamp)
  return key && Math.abs(key.timestamp - timestamp) < 1e-6 ? key : null
}

function shift(packet: EncodedPacket, by: number): EncodedPacket {
  return packet.clone({ timestamp: Math.max(0, packet.timestamp + by) })
}

/**
 * Where a moment of the source lands in the promo, or null when it was not
 * kept. Used to carry the chosen cover frame across the cut.
 */
export function mapToCut(time: number, segments: Scene[]): number | null {
  let offset = 0
  for (const segment of segments) {
    if (time >= segment.start && time < segment.end) return offset + (time - segment.start)
    offset += segment.end - segment.start
  }
  return null
}
