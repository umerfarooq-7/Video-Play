'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'
import {
  submitForReview,
  deleteVideo,
  type StudioState,
} from '@/lib/studio/video-actions'
import { FormMessage, SubmitButton } from '@/components/form'
import type { VideoStatus } from '@/types/database'

/**
 * Per-video controls in the studio list.
 *
 * Which actions appear follows the status machine enforced by the
 * guard_video_status_transitions trigger, so the UI never offers a move the
 * database will refuse.
 */
export function VideoRowActions({
  videoId,
  slug,
  status,
  hasMedia,
}: {
  videoId: string
  slug: string
  status: VideoStatus
  hasMedia: boolean
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const [submitState, submitAction] = useActionState<StudioState, FormData>(
    submitForReview,
    null,
  )
  const [deleteState, deleteAction] = useActionState<StudioState, FormData>(
    deleteVideo,
    null,
  )

  const result = submitState ?? deleteState

  // An owner may only push draft/rejected into review; everything else is a
  // moderator transition.
  const canSubmit = (status === 'draft' || status === 'rejected') && hasMedia

  return (
    <div className="mt-2.5 space-y-2">
      {result?.error && <FormMessage error={result.error} />}
      {result?.success && <FormMessage success={result.success} />}

      {!confirmingDelete ? (
        <div className="flex flex-wrap items-center gap-2">
          {canSubmit && (
            <form action={submitAction}>
              <input type="hidden" name="videoId" value={videoId} />
              <SubmitButton pendingLabel="Submitting…" className="!py-1.5 !text-xs">
                Submit for review
              </SubmitButton>
            </form>
          )}

          {hasMedia && (
            <Link
              href={`/watch/${slug}`}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted hover:bg-surface-raised"
            >
              {status === 'published' ? 'View' : 'Preview'}
            </Link>
          )}

          {status === 'published' && (
            <Link
              href={`/studio/clips?source=${videoId}`}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted hover:bg-surface-raised"
            >
              Make a clip
            </Link>
          )}

          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-muted hover:text-danger"
          >
            Delete
          </button>
        </div>
      ) : (
        <form action={deleteAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="videoId" value={videoId} />
          <span className="text-xs text-danger">
            Delete permanently? This cannot be undone.
          </span>
          <SubmitButton variant="danger" pendingLabel="Deleting…" className="!py-1.5 !text-xs">
            Delete
          </SubmitButton>
          <button
            type="button"
            onClick={() => setConfirmingDelete(false)}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted hover:bg-surface-raised"
          >
            Cancel
          </button>
        </form>
      )}
    </div>
  )
}
