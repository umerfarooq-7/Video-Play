'use client'

import { useActionState, useState } from 'react'
import {
  saveModel,
  deleteModel,
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
import type { Model } from '@/types/database'

function ModelFields({
  model,
  fieldErrors,
}: {
  model?: Model
  fieldErrors?: Record<string, string[]>
}) {
  return (
    <>
      <Field
        label="Name"
        name="name"
        required
        defaultValue={model?.name}
        placeholder="Jane Doe"
        errors={fieldErrors?.name}
      />

      <Field
        label="Slug"
        name="slug"
        defaultValue={model?.slug}
        placeholder="jane-doe"
        hint="Leave blank to generate from the name. This is the page URL."
        errors={fieldErrors?.slug}
      />

      <Field
        label="Photo URL"
        name="avatarUrl"
        type="url"
        defaultValue={model?.avatar_url ?? ''}
        placeholder="https://example.com/photo.jpg"
        hint="Shown on the home page and the model's page."
        errors={fieldErrors?.avatarUrl}
      />

      <TextareaField
        label="Bio"
        name="bio"
        rows={3}
        maxLength={1000}
        defaultValue={model?.bio ?? ''}
        errors={fieldErrors?.bio}
      />

      <CheckboxField name="isFeatured" defaultChecked={model?.is_featured}>
        Feature on the home page (shown before non-featured models).
      </CheckboxField>
    </>
  )
}

export function NewModelForm() {
  const [state, formAction] = useActionState<CatalogState, FormData>(saveModel, null)

  return (
    <form
      action={formAction}
      className="space-y-3 rounded-xl border border-border bg-surface p-4"
    >
      <FormMessage error={state?.error} success={state?.success} />
      <ModelFields fieldErrors={state?.fieldErrors} />
      <SubmitButton pendingLabel="Saving…">Add model</SubmitButton>
    </form>
  )
}

export function ModelRow({ model }: { model: Model }) {
  const [editing, setEditing] = useState(false)

  const [saveState, saveAction] = useActionState<CatalogState, FormData>(saveModel, null)
  const [deleteState, deleteAction] = useActionState<CatalogState, FormData>(
    deleteModel,
    null,
  )

  const result = saveState ?? deleteState

  if (editing) {
    return (
      <form
        action={saveAction}
        className="space-y-3 rounded-xl border border-accent bg-surface p-4"
      >
        <input type="hidden" name="id" value={model.id} />
        <FormMessage error={saveState?.error} />
        <ModelFields model={model} fieldErrors={saveState?.fieldErrors} />
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
        <EntityAvatar src={model.avatar_url} name={model.name} size="sm" />
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-medium">
            {model.name}
            {model.is_featured && (
              <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                Featured
              </span>
            )}
            {!model.is_approved && (
              <span className="rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-semibold text-warning">
                Unreviewed
              </span>
            )}
          </p>
          <p className="truncate text-xs text-muted">
            /{model.slug} · {model.video_count} video
            {model.video_count === 1 ? '' : 's'}
          </p>
          {result?.error && <p className="mt-1 text-xs text-danger">{result.error}</p>}
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
          <input type="hidden" name="id" value={model.id} />
          <SubmitButton variant="secondary" pendingLabel="…" className="!py-1.5 !text-xs">
            Delete
          </SubmitButton>
        </form>
      </div>
    </div>
  )
}
