'use client'

import { useActionState, useState } from 'react'
import { MousePointerClick } from 'lucide-react'
import {
  saveAd,
  deleteAd,
  saveAdSettings,
  type CatalogState,
} from '@/lib/admin/ad-actions'
import {
  CheckboxField,
  Field,
  FormMessage,
  SubmitButton,
  TextareaField,
} from '@/components/form'
import type { Ad, AdKind, AdPlacement } from '@/types/database'

const PLACEMENT_LABELS: Record<AdPlacement, string> = {
  home_grid: 'Home page — between the videos',
  under_player: 'Watch page — under the video',
  preroll: 'Watch page — before the video plays',
}

function Select({
  label,
  name,
  value,
  onChange,
  options,
  hint,
  errors,
}: {
  label: string
  name: string
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
  hint?: string
  errors?: string[]
}) {
  const hasError = !!errors?.length

  return (
    <div>
      <label htmlFor={name} className="block text-xs font-medium text-foreground">
        {label}
      </label>
      <select
        id={name}
        name={name}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`mt-1 h-9 w-full rounded-lg border bg-surface px-2 text-sm text-foreground focus:outline-none ${
          hasError ? 'border-danger' : 'border-border focus:border-accent'
        }`}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint && !hasError && <p className="mt-1 text-xs text-muted">{hint}</p>}
      {hasError && <p className="mt-1 text-xs text-danger">{errors[0]}</p>}
    </div>
  )
}

/** A timestamptz as the value a datetime-local input expects. */
function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`
}

function AdFields({ ad, fieldErrors }: { ad?: Ad; fieldErrors?: Record<string, string[]> }) {
  // Placement and kind drive which fields matter, so they are the one piece of
  // this form that has to be stateful — a pre-roll asking for a banner image
  // is how an admin ends up saving something that renders nothing.
  const [placement, setPlacement] = useState<AdPlacement>(ad?.placement ?? 'home_grid')
  const [kind, setKind] = useState<AdKind>(ad?.kind ?? 'image')

  const isPreroll = placement === 'preroll'
  const effectiveKind: AdKind = isPreroll ? 'video' : kind === 'video' ? 'image' : kind

  return (
    <>
      <Field
        label="Name"
        name="name"
        required
        defaultValue={ad?.name}
        placeholder="ExoClick — home banner"
        hint="For your own reference. Visitors never see it."
        errors={fieldErrors?.name}
      />

      <Select
        label="Where it shows"
        name="placement"
        value={placement}
        onChange={(value) => setPlacement(value as AdPlacement)}
        options={(Object.keys(PLACEMENT_LABELS) as AdPlacement[]).map((value) => ({
          value,
          label: PLACEMENT_LABELS[value],
        }))}
        errors={fieldErrors?.placement}
      />

      {isPreroll ? (
        // The database refuses any other combination, so there is nothing to
        // choose here — saying so beats a disabled dropdown.
        <input type="hidden" name="kind" value="video" />
      ) : (
        <Select
          label="What it is"
          name="kind"
          value={effectiveKind}
          onChange={(value) => setKind(value as AdKind)}
          options={[
            { value: 'image', label: 'An image I link somewhere' },
            { value: 'html', label: 'Code from an ad network' },
          ]}
          hint="Networks like ExoClick or JuicyAds give you a block of code — paste it below."
          errors={fieldErrors?.kind}
        />
      )}

      {effectiveKind === 'image' && (
        <Field
          label="Image link"
          name="imageUrl"
          type="url"
          defaultValue={ad?.image_url ?? ''}
          placeholder="https://example.com/banner.jpg"
          errors={fieldErrors?.imageUrl}
        />
      )}

      {effectiveKind === 'html' && (
        <TextareaField
          label="Ad network code"
          name="htmlCode"
          rows={5}
          maxLength={10000}
          defaultValue={ad?.html_code ?? ''}
          hint="Runs in a sandboxed frame, so it cannot touch the rest of the page."
          errors={fieldErrors?.htmlCode}
        />
      )}

      {effectiveKind === 'video' && (
        <>
          <Field
            label="Video file link"
            name="videoUrl"
            type="url"
            defaultValue={ad?.video_url ?? ''}
            placeholder="https://example.com/ad.mp4"
            hint="A direct .mp4 link. The viewer presses play once and the ad runs first."
            errors={fieldErrors?.videoUrl}
          />
          <Field
            label="Skip button appears after"
            name="skipAfterSeconds"
            type="number"
            defaultValue={String(ad?.skip_after_seconds ?? 5)}
            hint="Seconds. 0 lets them skip straight away."
            errors={fieldErrors?.skipAfterSeconds}
          />
        </>
      )}

      {effectiveKind !== 'html' && (
        <Field
          label="Click goes to"
          name="targetUrl"
          type="url"
          defaultValue={ad?.target_url ?? ''}
          placeholder="https://advertiser.example.com"
          hint="Leave blank for an ad that is not clickable. Clicks are counted."
          errors={fieldErrors?.targetUrl}
        />
      )}

      {effectiveKind !== 'video' && (
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Width (px)"
            name="width"
            type="number"
            defaultValue={ad?.width ? String(ad.width) : ''}
            placeholder="300"
            errors={fieldErrors?.width}
          />
          <Field
            label="Height (px)"
            name="height"
            type="number"
            defaultValue={ad?.height ? String(ad.height) : ''}
            placeholder="250"
            hint={
              effectiveKind === 'html'
                ? 'Required — a frame with no height shows nothing.'
                : 'Optional. Stops the page jumping as the image loads.'
            }
            errors={fieldErrors?.height}
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field
          label="Starts (optional)"
          name="startsAt"
          type="datetime-local"
          defaultValue={toLocalInput(ad?.starts_at ?? null)}
          errors={fieldErrors?.startsAt}
        />
        <Field
          label="Ends (optional)"
          name="endsAt"
          type="datetime-local"
          defaultValue={toLocalInput(ad?.ends_at ?? null)}
          errors={fieldErrors?.endsAt}
        />
      </div>

      <Field
        label="Order"
        name="sortOrder"
        type="number"
        defaultValue={String(ad?.sort_order ?? 0)}
        hint="With several ads in one spot they take turns. Lowest number goes first."
        errors={fieldErrors?.sortOrder}
      />

      <CheckboxField name="isActive" defaultChecked={ad?.is_active ?? true}>
        Live. Untick to pause without deleting.
      </CheckboxField>
    </>
  )
}

export function NewAdForm() {
  const [state, formAction] = useActionState<CatalogState, FormData>(saveAd, null)

  return (
    <form action={formAction} className="space-y-3 rounded-xl border border-border bg-surface p-4">
      <FormMessage error={state?.error} success={state?.success} />
      <AdFields fieldErrors={state?.fieldErrors} />
      <SubmitButton pendingLabel="Saving…">Add ad</SubmitButton>
    </form>
  )
}

export function AdRow({ ad }: { ad: Ad }) {
  const [editing, setEditing] = useState(false)
  const [saveState, saveAction] = useActionState<CatalogState, FormData>(saveAd, null)
  const [deleteState, deleteAction] = useActionState<CatalogState, FormData>(deleteAd, null)

  const result = saveState ?? deleteState

  if (editing) {
    return (
      <form action={saveAction} className="space-y-3 rounded-xl border border-accent bg-surface p-4">
        <input type="hidden" name="id" value={ad.id} />
        <FormMessage error={saveState?.error} />
        <AdFields ad={ad} fieldErrors={saveState?.fieldErrors} />
        <div className="flex gap-2">
          <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted hover:bg-surface-raised"
          >
            Cancel
          </button>
        </div>
      </form>
    )
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface p-3">
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-sm font-medium">
          {ad.name}
          {!ad.is_active && (
            <span className="rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-semibold text-warning">
              Paused
            </span>
          )}
        </p>
        <p className="truncate text-xs text-muted">
          {PLACEMENT_LABELS[ad.placement]} · {ad.kind}
        </p>
        <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted">
          <MousePointerClick size={12} aria-hidden />
          {ad.click_count} click{ad.click_count === 1 ? '' : 's'}
        </p>
        {result?.error && <p className="mt-1 text-xs text-danger">{result.error}</p>}
        {result?.success && <p className="mt-1 text-xs text-success">{result.success}</p>}
      </div>

      <div className="flex shrink-0 gap-2">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-surface-raised"
        >
          Edit
        </button>
        <form action={deleteAction}>
          <input type="hidden" name="id" value={ad.id} />
          <SubmitButton pendingLabel="Deleting…" variant="danger">
            Delete
          </SubmitButton>
        </form>
      </div>
    </div>
  )
}

export function AdSettingsForm({ interval }: { interval: number }) {
  const [state, formAction] = useActionState<CatalogState, FormData>(saveAdSettings, null)

  return (
    <form
      action={formAction}
      className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-surface p-4"
    >
      <div className="w-40">
        <Field
          label="Videos between banners"
          name="homeGridInterval"
          type="number"
          defaultValue={String(interval)}
          errors={state?.fieldErrors?.homeGridInterval}
        />
      </div>
      <SubmitButton pendingLabel="Saving…">Save spacing</SubmitButton>
      {state?.success && <p className="text-xs text-success">{state.success}</p>}
      {state?.error && <p className="text-xs text-danger">{state.error}</p>}
    </form>
  )
}
