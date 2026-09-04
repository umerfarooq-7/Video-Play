'use client'

import { useActionState, useState } from 'react'
import {
  approveUploader,
  rejectUploader,
  type ActionState,
} from '@/lib/admin/actions'
import { FormMessage, SubmitButton } from '@/components/form'

/**
 * Approve / reject controls for one application.
 *
 * Rejection opens a note field first, because rejectUploader() requires a
 * reason — the applicant sees it, and a bare refusal just produces a repeat
 * application. Approval needs no note, so it stays one click.
 */
export function UploaderDecision({ applicationId }: { applicationId: string }) {
  const [rejecting, setRejecting] = useState(false)

  const [approveState, approveAction] = useActionState<ActionState, FormData>(
    approveUploader,
    null,
  )
  const [rejectState, rejectAction] = useActionState<ActionState, FormData>(
    rejectUploader,
    null,
  )

  const message = approveState ?? rejectState

  if (message?.success) {
    return (
      <div className="mt-3">
        <FormMessage success={message.success} />
      </div>
    )
  }

  return (
    <div className="mt-3 space-y-2 border-t border-border pt-3">
      <FormMessage error={approveState?.error ?? rejectState?.error} />

      {rejecting ? (
        <form action={rejectAction} className="space-y-2">
          <input type="hidden" name="applicationId" value={applicationId} />

          <label
            htmlFor={`note-${applicationId}`}
            className="block text-xs font-medium"
          >
            Reason for rejection
            <span className="ml-0.5 text-danger">*</span>
          </label>
          <textarea
            id={`note-${applicationId}`}
            name="note"
            rows={3}
            required
            maxLength={1000}
            placeholder="The applicant will see this."
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs focus:border-accent focus:outline-none"
          />

          <div className="flex gap-2">
            <SubmitButton variant="danger" pendingLabel="Rejecting…">
              Confirm rejection
            </SubmitButton>
            <button
              type="button"
              onClick={() => setRejecting(false)}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted hover:bg-surface-raised"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <form action={approveAction}>
            <input type="hidden" name="applicationId" value={applicationId} />
            <SubmitButton pendingLabel="Approving…">Approve</SubmitButton>
          </form>

          <button
            type="button"
            onClick={() => setRejecting(true)}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted hover:bg-surface-raised"
          >
            Reject
          </button>
        </div>
      )}
    </div>
  )
}
