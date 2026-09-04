'use client'

import { useActionState, useState } from 'react'
import { ThumbsUp, ThumbsDown, Bookmark, Flag, X } from 'lucide-react'
import {
  voteOnVideo,
  toggleFavorite,
  reportVideo,
  type WatchState,
} from '@/lib/watch/actions'
import { formatCount } from '@/lib/format'
import { FormMessage, SubmitButton } from '@/components/form'

const REASONS = [
  { value: 'csam', label: 'Involves a minor', urgent: true },
  { value: 'underage', label: 'Performer appears underage', urgent: true },
  { value: 'non_consensual', label: 'Published without consent', urgent: true },
  { value: 'copyright', label: 'Copyright infringement', urgent: false },
  { value: 'violence', label: 'Violent or extreme content', urgent: false },
  { value: 'spam', label: 'Spam or misleading', urgent: false },
  { value: 'wrong_category', label: 'Wrong category or tags', urgent: false },
  { value: 'broken', label: 'Video does not play', urgent: false },
  { value: 'other', label: 'Something else', urgent: false },
]

export function WatchActions({
  videoId,
  likeCount,
  dislikeCount,
  signedIn,
}: {
  videoId: string
  likeCount: number
  dislikeCount: number
  signedIn: boolean
}) {
  const [reporting, setReporting] = useState(false)

  const [voteState, voteAction] = useActionState<WatchState, FormData>(
    voteOnVideo,
    null,
  )
  const [favState, favAction] = useActionState<WatchState, FormData>(
    toggleFavorite,
    null,
  )

  const feedback = voteState ?? favState

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <form action={voteAction} className="flex items-center gap-1">
          <input type="hidden" name="videoId" value={videoId} />
          <button
            type="submit"
            name="value"
            value="1"
            aria-label="Like"
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3.5 py-1.5 text-xs font-medium hover:border-accent hover:text-accent"
          >
            <ThumbsUp size={14} aria-hidden />
            {formatCount(likeCount)}
          </button>
          <button
            type="submit"
            name="value"
            value="-1"
            aria-label="Dislike"
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3.5 py-1.5 text-xs font-medium hover:border-danger hover:text-danger"
          >
            <ThumbsDown size={14} aria-hidden />
            {formatCount(dislikeCount)}
          </button>
        </form>

        <form action={favAction}>
          <input type="hidden" name="videoId" value={videoId} />
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3.5 py-1.5 text-xs font-medium hover:border-accent hover:text-accent"
          >
            <Bookmark size={14} aria-hidden />
            Save
          </button>
        </form>

        <button
          type="button"
          onClick={() => setReporting(true)}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3.5 py-1.5 text-xs font-medium text-muted hover:border-danger hover:text-danger"
        >
          <Flag size={14} aria-hidden />
          Report
        </button>
      </div>

      {feedback?.error && (
        <p className="text-xs text-danger">
          {feedback.error}
          {!signedIn && ' '}
          {!signedIn && (
            <a href="/login" className="underline">
              Log in
            </a>
          )}
        </p>
      )}
      {feedback?.success && <p className="text-xs text-success">{feedback.success}</p>}

      {reporting && (
        <ReportDialog videoId={videoId} onClose={() => setReporting(false)} />
      )}
    </div>
  )
}

function ReportDialog({
  videoId,
  onClose,
}: {
  videoId: string
  onClose: () => void
}) {
  const [state, formAction] = useActionState<WatchState, FormData>(
    reportVideo,
    null,
  )

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/70"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-title"
        className="relative w-full max-w-md rounded-xl border border-border bg-surface p-5"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="report-title" className="text-sm font-bold">
            Report this video
          </h2>
          <button type="button" onClick={onClose} aria-label="Close">
            <X size={17} className="text-muted hover:text-foreground" aria-hidden />
          </button>
        </div>

        {state?.success ? (
          <div className="mt-4">
            <FormMessage success={state.success} />
            <button
              type="button"
              onClick={onClose}
              className="mt-3 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-surface-raised"
            >
              Close
            </button>
          </div>
        ) : (
          <form action={formAction} className="mt-4 space-y-3">
            <input type="hidden" name="videoId" value={videoId} />

            <FormMessage error={state?.error} />

            <fieldset>
              <legend className="text-xs font-medium">Reason</legend>
              <div className="mt-1.5 space-y-1">
                {REASONS.map((reason) => (
                  <label
                    key={reason.value}
                    className="flex cursor-pointer items-center gap-2 text-xs text-muted"
                  >
                    <input
                      type="radio"
                      name="reason"
                      value={reason.value}
                      required
                      className="accent-[var(--accent)]"
                    />
                    <span className={reason.urgent ? 'text-danger' : undefined}>
                      {reason.label}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div>
              <label htmlFor="detail" className="block text-xs font-medium">
                Details <span className="text-muted">(optional)</span>
              </label>
              <textarea
                id="detail"
                name="detail"
                rows={3}
                maxLength={2000}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-xs focus:border-accent focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="email" className="block text-xs font-medium">
                Your email <span className="text-muted">(optional)</span>
              </label>
              <input
                id="email"
                name="email"
                type="email"
                className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-3 text-xs focus:border-accent focus:outline-none"
              />
              <p className="mt-1 text-[11px] leading-relaxed text-muted">
                Only if you want an update. You do not need an account to report
                a video.
              </p>
            </div>

            <div className="flex gap-2">
              <SubmitButton variant="danger" pendingLabel="Sending…">
                Submit report
              </SubmitButton>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted hover:bg-surface-raised"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
