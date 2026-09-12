'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { updateVideoDetails, type StudioState } from '@/lib/studio/video-actions'
import { VideoMetadataFields, type VideoMetadataInitial } from './VideoMetadataFields'
import { FormMessage, SubmitButton } from '@/components/form'
import type { Category, Model, Paysite } from '@/types/database'

/**
 * Edit the details of a video that already exists.
 *
 * Shared by the studio and the admin area: the action decides what the caller
 * is allowed to touch, so the only difference between the two is where Cancel
 * goes back to.
 *
 * The media itself is not editable here. Re-cutting a promo is the clip tool's
 * job, and the cover is chosen at upload because the provider can only be told
 * which frame to use when the video is created.
 */
export function VideoEditForm({
  videoId,
  backHref,
  categories,
  paysites,
  models,
  initial,
}: {
  videoId: string
  backHref: string
  categories: Category[]
  paysites: Paysite[]
  models: Model[]
  initial: VideoMetadataInitial
}) {
  const [state, action] = useActionState<StudioState, FormData>(
    updateVideoDetails,
    null,
  )

  return (
    <form
      action={action}
      className="space-y-4 rounded-xl border border-border bg-surface p-4"
    >
      {state?.error && <FormMessage error={state.error} />}
      {state?.success && <FormMessage success={state.success} />}

      <input type="hidden" name="videoId" value={videoId} />

      <VideoMetadataFields
        categories={categories}
        paysites={paysites}
        models={models}
        fieldErrors={state?.fieldErrors}
        showSourceOnly
        initial={initial}
      />

      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>
        <Link
          href={backHref}
          className="rounded-lg border border-border px-3.5 py-2 text-xs font-medium text-muted hover:bg-surface-raised"
        >
          Cancel
        </Link>
      </div>
    </form>
  )
}
