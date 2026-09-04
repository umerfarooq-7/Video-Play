'use client'

import { useActionState, useState } from 'react'
import { resolveReport, removeVideo, type ActionState } from '@/lib/admin/actions'
import { FormMessage, SubmitButton } from '@/components/form'

/**
 * Actions on a single report.
 *
 * Taking the video down and closing the report are separate operations on
 * purpose: a report can be dismissed without touching the video, and a video
 * can be removed while the report stays open pending a reply to the reporter.
 */
export function ReportActions({
  reportId,
  videoId,
  videoStatus,
  urgent,
}: {
  reportId: string
  videoId: string | null
  videoStatus: string | null
  urgent: boolean
}) {
  const [mode, setMode] = useState<'idle' | 'resolve' | 'takedown'>('idle')

  const [resolveState, resolveAction] = useActionState<ActionState, FormData>(
    resolveReport,
    null,
  )
  const [removeState, removeAction] = useActionState<ActionState, FormData>(
    removeVideo,
    null,
  )

  const result = resolveState ?? removeState

  if (result?.success) {
    return (
      <div className="mt-3">
        <FormMessage success={result.success} />
      </div>
    )
  }

  const canTakeDown = !!videoId && videoStatus === 'published'

  return (
    <div className="mt-3 space-y-2 border-t border-border pt-3">
      <FormMessage error={result?.error} />

      {mode === 'idle' && (
        <div className="flex flex-wrap gap-2">
          {canTakeDown && (
            <button
              type="button"
              onClick={() => setMode('takedown')}
              className={`rounded-lg px-4 py-2 text-sm font-semibold ${
                urgent
                  ? 'bg-danger text-white hover:opacity-90'
                  : 'border border-border text-muted hover:bg-surface-raised'
              }`}
            >
              Take video down
            </button>
          )}

          <button
            type="button"
            onClick={() => setMode('resolve')}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted hover:bg-surface-raised"
          >
            Close report
          </button>
        </div>
      )}

      {mode === 'takedown' && videoId && (
        <form action={removeAction} className="space-y-2">
          <input type="hidden" name="videoId" value={videoId} />
          <label htmlFor={`tk-${reportId}`} className="block text-xs font-medium">
            Reason for takedown <span className="text-danger">*</span>
          </label>
          <textarea
            id={`tk-${reportId}`}
            name="note"
            rows={2}
            required
            maxLength={1000}
            defaultValue={`Actioned from report ${reportId.slice(0, 8)}`}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs focus:border-accent focus:outline-none"
          />
          <div className="flex gap-2">
            <SubmitButton variant="danger" pendingLabel="Removing…">
              Confirm takedown
            </SubmitButton>
            <CancelButton onClick={() => setMode('idle')} />
          </div>
        </form>
      )}

      {mode === 'resolve' && (
        <form action={resolveAction} className="space-y-2">
          <input type="hidden" name="reportId" value={reportId} />

          <label htmlFor={`res-${reportId}`} className="block text-xs font-medium">
            Resolution note
          </label>
          <textarea
            id={`res-${reportId}`}
            name="resolution"
            rows={2}
            maxLength={1000}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs focus:border-accent focus:outline-none"
          />

          <fieldset className="flex flex-wrap gap-3">
            <legend className="sr-only">Outcome</legend>
            {[
              { value: 'actioned', label: 'Actioned' },
              { value: 'dismissed', label: 'Dismissed' },
              { value: 'triaged', label: 'Needs more work' },
            ].map((option) => (
              <label
                key={option.value}
                className="flex cursor-pointer items-center gap-1.5 text-xs text-muted"
              >
                <input
                  type="radio"
                  name="outcome"
                  value={option.value}
                  required
                  className="accent-[var(--accent)]"
                />
                {option.label}
              </label>
            ))}
          </fieldset>

          <div className="flex gap-2">
            <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
            <CancelButton onClick={() => setMode('idle')} />
          </div>
        </form>
      )}
    </div>
  )
}

function CancelButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted hover:bg-surface-raised"
    >
      Cancel
    </button>
  )
}
