'use client'

import { useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { CheckboxField, Field, TextareaField } from '@/components/form'
import { MultiSelectField } from '@/components/MultiSelectField'
import { MAX_CATEGORIES_PER_VIDEO } from '@/lib/constants'
import type { Category, Model, Paysite } from '@/types/database'

/**
 * Guided tag questions.
 *
 * Uploaders left to free-type tags produce inconsistent vocabulary, which
 * quietly wrecks search and filtering. Walking them through a few fixed
 * questions gets a consistent baseline set, and they can still type anything
 * else they want afterwards.
 */
const TAG_QUESTIONS: { question: string; options: { label: string; tag: string }[] }[] = [
  {
    question: 'How many people are in the scene?',
    options: [
      { label: 'One', tag: 'solo' },
      { label: 'Two', tag: 'couple' },
      { label: 'Three', tag: 'threesome' },
      { label: 'Four or more', tag: 'group' },
    ],
  },
  {
    question: 'Where does it take place?',
    options: [
      { label: 'Indoor', tag: 'indoor' },
      { label: 'Outdoor', tag: 'outdoor' },
      { label: 'Studio set', tag: 'studio' },
      { label: 'Public place', tag: 'public' },
    ],
  },
  {
    question: 'How was it shot?',
    options: [
      { label: 'POV', tag: 'pov' },
      { label: 'Fixed camera', tag: 'fixed-cam' },
      { label: 'Handheld', tag: 'handheld' },
      { label: 'Multi-angle', tag: 'multi-angle' },
    ],
  },
  {
    question: 'What is the picture quality?',
    options: [
      { label: 'HD (720p–1080p)', tag: 'hd' },
      { label: '4K', tag: '4k' },
      { label: 'Vertical / mobile', tag: 'vertical' },
      { label: 'Standard', tag: 'sd' },
    ],
  },
  {
    question: 'What language is spoken?',
    options: [
      { label: 'English', tag: 'english' },
      { label: 'German', tag: 'german' },
      { label: 'Other', tag: 'foreign-language' },
      { label: 'None / music only', tag: 'no-dialogue' },
    ],
  },
]

const PROJECTIONS = [
  { value: 'flat', label: 'Standard (flat)' },
  { value: 'eq360_mono', label: '360° mono' },
  { value: 'eq360_stereo_tb', label: '360° stereo (top/bottom)' },
  { value: 'eq180_mono', label: '180° mono' },
  { value: 'eq180_stereo_sbs', label: '180° stereo (side by side)' },
]

const ORIENTATIONS = [
  { value: 'straight', label: 'Straight' },
  { value: 'gay', label: 'Gay' },
  { value: 'shemale', label: 'Shemale' },
]

const HEAT = [
  { value: 'hardcore', label: 'Hardcore' },
  { value: 'softcore', label: 'Softcore' },
]

/**
 * Everything the form needs to reopen an existing video for editing. Absent
 * on upload, where every field starts empty.
 */
export interface VideoMetadataInitial {
  title: string
  description: string | null
  paysiteDomain: string
  models: string[]
  tags: string
  categoryIds: string[]
  fullDurationSeconds: number | null
  contentOrientation: string
  contentHeat: string
  producedOn: string | null
  projection: string
  isExclusive: boolean
  isSourceOnly: boolean
}

export function VideoMetadataFields({
  categories,
  paysites = [],
  models = [],
  fieldErrors,
  showSourceOnly = false,
  initial,
}: {
  categories: Category[]
  paysites?: Paysite[]
  models?: Model[]
  fieldErrors?: Record<string, string[]>
  /** Offer the "full-length source, not for publication" flag. */
  showSourceOnly?: boolean
  /** Current values, when editing rather than uploading. */
  initial?: VideoMetadataInitial
}) {
  const [tags, setTags] = useState(initial?.tags ?? '')

  // On an edit the uploader already attested at upload; the boxes come back
  // ticked so saving re-affirms rather than re-interrogates.
  const editing = initial !== undefined

  return (
    <>
      <TagsAssistant tags={tags} onTagsChange={setTags} />

      <Field
        label="Title"
        name="title"
        required
        defaultValue={initial?.title}
        placeholder="5–10 words"
        errors={fieldErrors?.title}
      />

      <TextareaField
        label="Description"
        name="description"
        rows={4}
        maxLength={5000}
        defaultValue={initial?.description ?? undefined}
        hint="200–300 characters, 2–4 sentences. Searchable."
        errors={fieldErrors?.description}
      />

      {/* Paysite is required: attribution is what distinguishes promoting a
          network's content from reposting it. */}
      <div>
        <Field
          label="Paysite domain"
          name="paysiteDomain"
          required
          defaultValue={initial?.paysiteDomain}
          placeholder="example.com"
          list="paysite-options"
          hint="Without www. Start typing for suggestions."
          errors={fieldErrors?.paysiteDomain}
        />
        <datalist id="paysite-options">
          {paysites.map((paysite) => (
            <option key={paysite.id} value={paysite.domain}>
              {paysite.name}
            </option>
          ))}
        </datalist>
      </div>

      <MultiSelectField
        label="Models"
        name="models"
        options={models.map((model) => ({ id: model.id, name: model.name }))}
        initialValues={initial?.models}
        placeholder="Start typing a name…"
        hint="Pick as many as appear in the video. A name that is not on the list yet is added automatically."
        errors={fieldErrors?.models}
      />

      <Field
        label="Full movie duration"
        name="fullDurationSeconds"
        type="number"
        defaultValue={initial?.fullDurationSeconds?.toString()}
        placeholder="0"
        hint="Length of the ORIGINAL movie in seconds, if you know it. 1 min = 60, 1 hour = 3600. Leave blank if unsure."
        errors={fieldErrors?.fullDurationSeconds}
      />

      <RadioRow
        legend="Content type"
        name="contentOrientation"
        options={ORIENTATIONS}
        defaultValue={initial?.contentOrientation ?? 'straight'}
        errors={fieldErrors?.contentOrientation}
      />

      <RadioRow
        legend="Explicitness"
        name="contentHeat"
        options={HEAT}
        defaultValue={initial?.contentHeat ?? 'hardcore'}
        errors={fieldErrors?.contentHeat}
      />

      <Field
        label="Day of production"
        name="producedOn"
        type="date"
        defaultValue={initial?.producedOn ?? undefined}
        hint="Optional. An approximate date is fine."
        errors={fieldErrors?.producedOn}
      />

      <div>
        <label htmlFor="projection" className="block text-xs font-medium">
          Video format
        </label>
        <select
          id="projection"
          name="projection"
          defaultValue={initial?.projection ?? 'flat'}
          className="mt-1 h-9 w-full rounded-lg border border-border bg-surface px-2 text-sm focus:border-accent focus:outline-none"
        >
          {PROJECTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-muted">
          Pick a 360°/180° option only for footage actually shot that way — it
          changes which player is used.
        </p>
      </div>

      {categories.length > 0 && (
        <CategoryPicker
          categories={categories}
          errors={fieldErrors?.categoryIds}
          initialSelected={initial?.categoryIds}
        />
      )}

      <Field
        label="Tags"
        name="tags"
        value={tags}
        onChange={setTags}
        placeholder="hd, outdoor, german"
        hint="Comma separated. New tags are created automatically."
        errors={fieldErrors?.tags}
      />

      <CheckboxField name="isExclusive" defaultChecked={initial?.isExclusive}>
        This content is exclusive to us.
      </CheckboxField>

      {showSourceOnly && (
        <CheckboxField name="isSourceOnly" defaultChecked={initial?.isSourceOnly}>
          This is a full-length source, uploaded only so promos can be cut from
          it. It will never be published — only the promos you cut will be.
        </CheckboxField>
      )}

      <div className="space-y-2 rounded-lg border border-border bg-background p-3">
        <p className="text-xs font-semibold">Required confirmations</p>

        <CheckboxField
          name="rightsAttested"
          defaultChecked={editing}
          errors={fieldErrors?.rightsAttested}
        >
          I hold the distribution rights to this video.
        </CheckboxField>

        <CheckboxField
          name="consentAttested"
          defaultChecked={editing}
          errors={fieldErrors?.consentAttested}
        >
          Every performer was at least 18 years old at the time of production and
          consented to this being published.
        </CheckboxField>
      </div>
    </>
  )
}

/** Steps through TAG_QUESTIONS, appending the chosen tag to the tags field. */
function TagsAssistant({
  tags,
  onTagsChange,
}: {
  tags: string
  onTagsChange: (value: string) => void
}) {
  const [step, setStep] = useState(0)
  const done = step >= TAG_QUESTIONS.length

  function addTag(tag: string) {
    const current = tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)

    if (!current.includes(tag)) current.push(tag)
    onTagsChange(current.join(', '))
    setStep((s) => s + 1)
  }

  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold">Tags assistant</p>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => {
              setStep(0)
              onTagsChange('')
            }}
            className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-[11px] font-medium text-muted hover:text-foreground"
          >
            <RotateCcw size={10} aria-hidden />
            Reset
          </button>
          {!done && (
            <button
              type="button"
              onClick={() => setStep((s) => s + 1)}
              className="rounded bg-accent px-2 py-0.5 text-[11px] font-semibold text-accent-contrast hover:bg-accent-hover"
            >
              Skip
            </button>
          )}
        </div>
      </div>

      {done ? (
        <p className="mt-1.5 text-xs text-muted">
          All done. Edit the tags field below to add anything else.
        </p>
      ) : (
        <>
          <p className="mt-1.5 text-xs text-muted">
            {step + 1} of {TAG_QUESTIONS.length}. {TAG_QUESTIONS[step].question}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {TAG_QUESTIONS[step].options.map((option) => (
              <button
                key={option.tag}
                type="button"
                onClick={() => addTag(option.tag)}
                className="rounded-full border border-border px-2.5 py-1 text-[11px] font-medium text-muted hover:border-accent hover:text-accent"
              >
                {option.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function RadioRow({
  legend,
  name,
  options,
  defaultValue,
  errors,
}: {
  legend: string
  name: string
  options: { value: string; label: string }[]
  defaultValue: string
  errors?: string[]
}) {
  return (
    <fieldset>
      <legend className="text-xs font-medium">{legend}</legend>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5">
        {options.map((option) => (
          <label
            key={option.value}
            className="flex cursor-pointer items-center gap-1.5 text-xs text-muted"
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              defaultChecked={option.value === defaultValue}
              className="accent-[var(--accent)]"
            />
            {option.label}
          </label>
        ))}
      </div>
      {errors?.[0] && <p className="mt-1 text-xs text-danger">{errors[0]}</p>}
    </fieldset>
  )
}

/**
 * Category checkboxes with a live count.
 *
 * The limit is enforced here as well as in the schema. Letting someone tick
 * eight boxes and only telling them after they press submit is the worst of
 * both worlds — especially since the error renders at the top of a long form,
 * off screen from the button they just pressed.
 */
function CategoryPicker({
  categories,
  errors,
  initialSelected = [],
}: {
  categories: Category[]
  errors?: string[]
  initialSelected?: string[]
}) {
  const [selected, setSelected] = useState<string[]>(initialSelected)
  const atLimit = selected.length >= MAX_CATEGORIES_PER_VIDEO
  const hasError = !!errors?.length

  return (
    <fieldset>
      <legend className="text-xs font-medium">
        Categories{' '}
        <span className={atLimit ? 'text-accent' : 'text-muted'}>
          ({selected.length} of {MAX_CATEGORIES_PER_VIDEO})
        </span>
      </legend>

      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5">
        {categories.map((category) => {
          const checked = selected.includes(category.id)
          const disabled = !checked && atLimit

          return (
            <label
              key={category.id}
              className={`flex items-center gap-1.5 text-xs ${
                disabled ? 'cursor-not-allowed text-muted/40' : 'cursor-pointer text-muted'
              }`}
            >
              <input
                type="checkbox"
                name="categoryIds"
                value={category.id}
                checked={checked}
                disabled={disabled}
                onChange={(e) =>
                  setSelected((prev) =>
                    e.target.checked
                      ? [...prev, category.id]
                      : prev.filter((id) => id !== category.id),
                  )
                }
                className="size-3.5 accent-[var(--accent)]"
              />
              {category.name}
            </label>
          )
        })}
      </div>

      {atLimit && !hasError && (
        <p className="mt-1 text-xs text-accent">
          Limit reached. Untick one to choose a different category.
        </p>
      )}

      {hasError && <p className="mt-1 text-xs text-danger">{errors[0]}</p>}
    </fieldset>
  )
}
