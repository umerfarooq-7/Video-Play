'use client'

import { useActionState, useState } from 'react'
import {
  createCategory,
  updateCategory,
  deactivateCategory,
  type CategoryState,
} from '@/lib/admin/category-actions'
import { Field, FormMessage, SubmitButton, TextareaField } from '@/components/form'
import type { Category } from '@/types/database'

export function NewCategoryForm() {
  const [state, formAction] = useActionState<CategoryState, FormData>(
    createCategory,
    null,
  )

  return (
    <form
      action={formAction}
      className="space-y-3 rounded-xl border border-border bg-surface p-4"
    >
      <FormMessage error={state?.error} success={state?.success} />

      <Field
        label="Name"
        name="name"
        required
        placeholder="Behind the scenes"
        errors={state?.fieldErrors?.name}
      />

      <Field
        label="Slug"
        name="slug"
        placeholder="behind-the-scenes"
        hint="Leave blank to generate it from the name."
        errors={state?.fieldErrors?.slug}
      />

      <TextareaField
        label="Description"
        name="description"
        rows={2}
        maxLength={500}
        errors={state?.fieldErrors?.description}
      />

      <Field
        label="Sort order"
        name="sortOrder"
        type="number"
        defaultValue="0"
        hint="Lower numbers appear first."
        errors={state?.fieldErrors?.sortOrder}
      />

      <SubmitButton pendingLabel="Creating…">Add category</SubmitButton>
    </form>
  )
}

export function CategoryEditor({
  category,
  videoCount,
}: {
  category: Category
  videoCount: number
}) {
  const [editing, setEditing] = useState(false)

  const [updateState, updateAction] = useActionState<CategoryState, FormData>(
    updateCategory,
    null,
  )
  const [hideState, hideAction] = useActionState<CategoryState, FormData>(
    deactivateCategory,
    null,
  )

  const result = updateState ?? hideState

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-surface px-4 py-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-medium">
            {category.name}
            {!category.is_active && (
              <span className="rounded bg-surface-raised px-1.5 py-0.5 text-[10px] text-muted">
                Hidden
              </span>
            )}
          </p>
          <p className="text-xs text-muted">
            /{category.slug} · {videoCount} video{videoCount === 1 ? '' : 's'} ·
            order {category.sort_order}
          </p>
          {result?.success && (
            <p className="mt-1 text-xs text-success">{result.success}</p>
          )}
        </div>

        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted hover:bg-surface-raised"
          >
            Edit
          </button>
          {category.is_active && (
            <form action={hideAction}>
              <input type="hidden" name="id" value={category.id} />
              <SubmitButton
                variant="secondary"
                pendingLabel="Hiding…"
                className="!py-1.5 !text-xs"
              >
                Hide
              </SubmitButton>
            </form>
          )}
        </div>
      </div>
    )
  }

  return (
    <form
      action={updateAction}
      className="space-y-3 rounded-xl border border-accent bg-surface p-4"
    >
      <input type="hidden" name="id" value={category.id} />

      <FormMessage error={result?.error} />

      <Field
        label="Name"
        name="name"
        required
        defaultValue={category.name}
        errors={updateState?.fieldErrors?.name}
      />

      <Field
        label="Slug"
        name="slug"
        defaultValue={category.slug}
        hint="Changing this breaks existing links to this category."
        errors={updateState?.fieldErrors?.slug}
      />

      <TextareaField
        label="Description"
        name="description"
        rows={2}
        maxLength={500}
        defaultValue={category.description ?? ''}
        errors={updateState?.fieldErrors?.description}
      />

      <Field
        label="Sort order"
        name="sortOrder"
        type="number"
        defaultValue={String(category.sort_order)}
        errors={updateState?.fieldErrors?.sortOrder}
      />

      <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
        <input
          type="checkbox"
          name="isActive"
          defaultChecked={category.is_active}
          className="size-4 accent-[var(--accent)]"
        />
        Visible to the public
      </label>

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
