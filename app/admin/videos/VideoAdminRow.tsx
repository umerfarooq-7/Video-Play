'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'
import { deleteVideoPermanently, type ActionState } from '@/lib/admin/actions'
import { FormMessage, SubmitButton } from '@/components/form'

/**
 * Delete control for one video.
 *
 * Two-step by design. This removes the database row *and* the file on the CDN,
 * and neither comes back — so a single misplaced click on a list of a hundred
 * rows must not be able to destroy a video. The confirm step also states what
 * will happen, because "delete" alone does not convey that the media goes too.
 */
export function VideoAdminRow({
  videoId,
  title,
  slug,
  hasMedia,
}: {
  videoId: string
  title: string
  slug: string
  hasMedia: boolean
}) {
  const [confirming, setConfirming] = useState(false)
  const [state, formAction] = useActionState<ActionState, FormData>(
    deleteVideoPermanently,
    null,
  )

  if (state?.success) {
    return (
      <div className="mt-2">
        <FormMessage success={state.success} />
      </div>
    )
  }

  return (
    <div className="mt-2 space-y-2">
      {state?.error && <FormMessage error={state.error} />}

      {confirming ? (
        <form action={formAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="videoId" value={videoId} />
          <span className="text-xs text-danger">
            Delete <strong>{title}</strong> and its file from the CDN? This
            cannot be undone.
          </span>
          <SubmitButton variant="danger" pendingLabel="Deleting…" className="!py-1.5 !text-xs">
            Yes, delete
          </SubmitButton>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted hover:bg-surface-raised"
          >
            Cancel
          </button>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {hasMedia && (
            <Link
              href={`/watch/${slug}`}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted hover:bg-surface-raised"
            >
              View
            </Link>
          )}
          <Link
            href="/admin/moderation"
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted hover:bg-surface-raised"
          >
            Moderate
          </Link>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-muted hover:text-danger"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  )
}
