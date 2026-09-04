'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { importFromUrl, type StudioState } from '@/lib/studio/video-actions'
import { VideoMetadataFields } from '@/components/studio/VideoMetadataFields'
import { Field, FormMessage, SubmitButton } from '@/components/form'
import type { Category, Model, Paysite } from '@/types/database'

export function ImportForm({
  categories,
  paysites,
  models,
}: {
  categories: Category[]
  paysites: Paysite[]
  models: Model[]
}) {
  const [state, formAction] = useActionState<StudioState, FormData>(
    importFromUrl,
    null,
  )

  if (state?.success) {
    return (
      <div className="rounded-xl border border-success/30 bg-success/10 p-5">
        <h3 className="text-sm font-semibold text-success">Import queued</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted">{state.success}</p>
        <Link
          href="/studio/videos"
          className="mt-3 inline-block rounded-lg bg-accent px-3.5 py-2 text-xs font-semibold text-accent-contrast hover:bg-accent-hover"
        >
          View my videos
        </Link>
      </div>
    )
  }

  return (
    <form
      action={formAction}
      className="space-y-4 rounded-xl border border-border bg-surface p-4"
    >
      <FormMessage error={state?.error} />

      <Field
        label="Video URL"
        name="sourceUrl"
        type="url"
        required
        placeholder="https://example.com/video.mp4"
        hint="Must be a direct link to the file itself, not a page it is embedded in."
        errors={state?.fieldErrors?.sourceUrl}
      />

      <VideoMetadataFields
        categories={categories}
        paysites={paysites}
        models={models}
        fieldErrors={state?.fieldErrors}
        showSourceOnly
      />

      <SubmitButton className="w-full" pendingLabel="Checking the link…">
        Import video
      </SubmitButton>
    </form>
  )
}
