'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'
import {
  publishVideo,
  rejectVideo,
  removeVideo,
  type ActionState,
} from '@/lib/admin/actions'
import { FormMessage, SubmitButton } from '@/components/form'

type Mode = 'idle' | 'reject' | 'remove'

/**
 * Decision controls for one video.
 *
 * Which actions are offered depends on current status: a published video can
 * only be taken down, an unreviewed one can be published or rejected. Showing
 * every button always would mean most of them fail server-side.
 */
export function ModerationDecision({
  videoId,
  slug,
  status,
  hasMedia,
}: {
  videoId: string
  slug: string
  status: string
  hasMedia: boolean
}) {
  const [mode, setMode] = useState<Mode>('idle')

  const [publishState, publishAction] = useActionState<ActionState, FormData>(
    publishVideo,
    null,
  )
  const [rejectState, rejectAction] = useActionState<ActionState, FormData>(
    rejectVideo,
    null,
  )
  const [removeState, removeAction] = useActionState<ActionState, FormData>(
    removeVideo,
    null,
  )

  const result = publishState ?? rejectState ?? removeState

  if (result?.success) {
    return (
      <div className="mt-3">
        <FormMessage success={result.success} />
      </div>
    )
  }

  const canPublish = status === 'pending_review' || status === 'rejected'
  const canReject = status === 'pending_review'
  const canRemove = status === 'published'

  return (
    <div className="mt-3 space-y-2 border-t border-border pt-3">
      <FormMessage error={result?.error} />

      {mode === 'idle' && (
        <div className="flex flex-wrap items-center gap-2">
          {canPublish && (
            <form action={publishAction}>
              <input type="hidden" name="videoId" value={videoId} />
              <SubmitButton pendingLabel="Publishing…">
                {hasMedia ? 'Publish' : 'Publish (no media)'}
              </SubmitButton>
            </form>
          )}

          {canReject && (
            <button
              type="button"
              onClick={() => setMode('reject')}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted hover:bg-surface-raised"
            >
              Reject
            </button>
          )}

          {canRemove && (
            <button
              type="button"
              onClick={() => setMode('remove')}
              className="rounded-lg bg-danger px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
            >
              Take down
            </button>
          )}

          <Link
            href={`/watch/${slug}`}
            className="text-xs font-medium text-accent hover:underline"
          >
            Preview
          </Link>
        </div>
      )}

      {(mode === 'reject' || mode === 'remove') && (
        <form
          action={mode === 'reject' ? rejectAction : removeAction}
          className="space-y-2"
        >
          <input type="hidden" name="videoId" value={videoId} />

          <label
            htmlFor={`note-${videoId}`}
            className="block text-xs font-medium"
          >
            {mode === 'reject'
              ? 'Reason for rejection'
              : 'Reason for takedown (kept as the audit trail)'}
            <span className="ml-0.5 text-danger">*</span>
          </label>
          <textarea
            id={`note-${videoId}`}
            name="note"
            rows={3}
            required
            maxLength={1000}
            placeholder={
              mode === 'reject'
                ? 'The uploader will see this.'
                : 'e.g. DMCA notice from rightsholder, ref #1234'
            }
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs focus:border-accent focus:outline-none"
          />

          <div className="flex gap-2">
            <SubmitButton variant="danger" pendingLabel="Saving…">
              {mode === 'reject' ? 'Confirm rejection' : 'Confirm takedown'}
            </SubmitButton>
            <button
              type="button"
              onClick={() => setMode('idle')}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted hover:bg-surface-raised"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
