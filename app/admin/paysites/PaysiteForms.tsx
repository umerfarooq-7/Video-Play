'use client'

import { useActionState, useState } from 'react'
import {
  savePaysite,
  deletePaysite,
  type CatalogState,
} from '@/lib/admin/catalog-actions'
import {
  CheckboxField,
  Field,
  FormMessage,
  SubmitButton,
  TextareaField,
} from '@/components/form'
import { EntityAvatar } from '@/components/BrowseResults'
import type { Paysite } from '@/types/database'

/** Shared field set, so the add and edit forms cannot drift apart. */
function PaysiteFields({
  paysite,
  fieldErrors,
}: {
  paysite?: Paysite
  fieldErrors?: Record<string, string[]>
}) {
  return (
    <>
      <Field
        label="Name"
        name="name"
        required
        defaultValue={paysite?.name}
        placeholder="Example Studios"
        errors={fieldErrors?.name}
      />

      <Field
        label="Domain"
        name="domain"
        required
        defaultValue={paysite?.domain}
        placeholder="example.com"
        hint="Without www. This becomes the page URL, so settle it before launch."
        errors={fieldErrors?.domain}
      />

      <Field
        label="Website link"
        name="siteUrl"
        type="url"
        defaultValue={paysite?.site_url ?? ''}
        placeholder="https://example.com"
        hint="Optional. Where the credit link points, if not just the domain."
        errors={fieldErrors?.siteUrl}
      />

      <Field
        label="Logo image URL"
        name="logoUrl"
        type="url"
        defaultValue={paysite?.logo_url ?? ''}
        placeholder="https://example.com/logo.png"
        hint="Shown on the home page and network page."
        errors={fieldErrors?.logoUrl}
      />

      <TextareaField
        label="Description"
        name="description"
        rows={2}
        maxLength={500}
        defaultValue={paysite?.description ?? ''}
        errors={fieldErrors?.description}
      />

      <CheckboxField name="isFeatured" defaultChecked={paysite?.is_featured}>
        Feature on the home page (shown before non-featured networks).
      </CheckboxField>
    </>
  )
}

export function NewPaysiteForm() {
  const [state, formAction] = useActionState<CatalogState, FormData>(savePaysite, null)

  return (
    <form
      action={formAction}
      className="space-y-3 rounded-xl border border-border bg-surface p-4"
    >
      <FormMessage error={state?.error} success={state?.success} />
      <PaysiteFields fieldErrors={state?.fieldErrors} />
      <SubmitButton pendingLabel="Saving…">Add network</SubmitButton>
    </form>
  )
}

export function PaysiteRow({ paysite }: { paysite: Paysite }) {
  const [editing, setEditing] = useState(false)

  const [saveState, saveAction] = useActionState<CatalogState, FormData>(
    savePaysite,
    null,
  )
  const [deleteState, deleteAction] = useActionState<CatalogState, FormData>(
    deletePaysite,
    null,
  )

  const result = saveState ?? deleteState

  if (editing) {
    return (
      <form
        action={saveAction}
        className="space-y-3 rounded-xl border border-accent bg-surface p-4"
      >
        <input type="hidden" name="id" value={paysite.id} />
        <FormMessage error={saveState?.error} />
        <PaysiteFields paysite={paysite} fieldErrors={saveState?.fieldErrors} />
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
      <div className="flex min-w-0 items-center gap-3">
        <EntityAvatar src={paysite.logo_url} name={paysite.name} size="sm" />
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-medium">
            {paysite.name}
            {paysite.is_featured && (
              <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                Featured
              </span>
            )}
            {!paysite.is_approved && (
              <span className="rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-semibold text-warning">
                Unreviewed
              </span>
            )}
          </p>
          <p className="truncate text-xs text-muted">
            {paysite.domain} · {paysite.video_count} video
            {paysite.video_count === 1 ? '' : 's'}
          </p>
          {result?.error && (
            <p className="mt-1 text-xs text-danger">{result.error}</p>
          )}
          {result?.success && (
            <p className="mt-1 text-xs text-success">{result.success}</p>
          )}
        </div>
      </div>

      <div className="flex shrink-0 gap-2">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted hover:bg-surface-raised"
        >
          Edit
        </button>
        <form action={deleteAction}>
          <input type="hidden" name="id" value={paysite.id} />
          <SubmitButton variant="secondary" pendingLabel="…" className="!py-1.5 !text-xs">
            Delete
          </SubmitButton>
        </form>
      </div>
    </div>
  )
}
