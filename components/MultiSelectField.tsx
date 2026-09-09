'use client'

import { useId, useRef, useState } from 'react'
import { X } from 'lucide-react'

export interface MultiSelectOption {
  id: string
  name: string
}

/**
 * Pick several values from a list, with suggestions, and submit them as one
 * comma-separated form field.
 *
 * A plain text input with a <datalist> cannot do this: the browser matches a
 * datalist against the whole value, so the moment a first name and a comma are
 * typed nothing matches any more and the suggestions vanish for every name
 * after the first. Committing each choice to a chip keeps the input empty, so
 * suggestions work for the second name exactly as they did for the first.
 *
 * Values are held in a hidden input rather than posted individually, so server
 * code that already parses a comma-separated string needs no changes.
 */
export function MultiSelectField({
  label,
  name,
  options,
  hint,
  errors,
  placeholder,
  max = 20,
  allowNew = true,
}: {
  label: string
  name: string
  options: MultiSelectOption[]
  hint?: string
  errors?: string[]
  placeholder?: string
  max?: number
  /** Accept a typed value that matches nothing in `options`. */
  allowNew?: boolean
}) {
  const [selected, setSelected] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)

  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()
  const errorId = `${name}-error`
  const hintId = `${name}-hint`

  const hasError = !!errors?.length
  const atLimit = selected.length >= max

  const taken = new Set(selected.map((s) => s.toLowerCase()))
  const suggestions = options
    .filter((option) => !taken.has(option.name.toLowerCase()))
    .filter((option) => option.name.toLowerCase().includes(query.trim().toLowerCase()))
    .slice(0, 8)

  // Only offer to create what is not already on the list, and never a
  // duplicate of something already picked.
  const trimmed = query.trim()
  const canCreate =
    allowNew &&
    trimmed.length >= 2 &&
    !taken.has(trimmed.toLowerCase()) &&
    !options.some((o) => o.name.toLowerCase() === trimmed.toLowerCase())

  function add(value: string) {
    // Commas separate the names in the submitted value, so one inside a name
    // would silently split it in two.
    const clean = value.replace(/,/g, ' ').replace(/\s+/g, ' ').trim()
    if (clean.length < 2 || atLimit || taken.has(clean.toLowerCase())) return

    setSelected((prev) => [...prev, clean])
    setQuery('')
    setHighlight(0)
    inputRef.current?.focus()
  }

  function remove(value: string) {
    setSelected((prev) => prev.filter((v) => v !== value))
    inputRef.current?.focus()
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    const choices = canCreate ? suggestions.length + 1 : suggestions.length

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setOpen(true)
      if (choices === 0) return
      setHighlight((current) =>
        event.key === 'ArrowDown'
          ? (current + 1) % choices
          : (current - 1 + choices) % choices,
      )
      return
    }

    // Comma is how people habitually separate names, so honour it as "commit"
    // even though the field no longer works that way.
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault()
      // Only take the highlight when the list is actually showing; otherwise
      // Enter would quietly pick something the uploader cannot see.
      const picked = open ? suggestions[highlight] : undefined
      if (picked) add(picked.name)
      else if (trimmed) add(trimmed)
      return
    }

    if (event.key === 'Escape') {
      setOpen(false)
      return
    }

    // Backspace on an empty box removes the previous chip, which is what every
    // other tag input does.
    if (event.key === 'Backspace' && query === '' && selected.length > 0) {
      remove(selected[selected.length - 1])
    }
  }

  return (
    <div
      onBlur={(event) => {
        // Closing on any blur would fire before a click on a suggestion had a
        // chance to register.
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setOpen(false)
        }
      }}
    >
      <label htmlFor={`${name}-input`} className="block text-xs font-medium text-foreground">
        {label}
      </label>

      <div
        className={`mt-1 flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border bg-surface px-2 py-1.5 ${
          hasError ? 'border-danger' : 'border-border focus-within:border-accent'
        }`}
      >
        {selected.map((value) => (
          <span
            key={value}
            className="flex items-center gap-1 rounded bg-accent/15 py-0.5 pl-2 pr-1 text-xs font-medium text-accent"
          >
            {value}
            <button
              type="button"
              onClick={() => remove(value)}
              aria-label={`Remove ${value}`}
              className="rounded p-0.5 hover:bg-accent/20"
            >
              <X size={11} aria-hidden />
            </button>
          </span>
        ))}

        <input
          id={`${name}-input`}
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          value={query}
          disabled={atLimit}
          placeholder={selected.length === 0 ? placeholder : atLimit ? '' : 'Add another…'}
          onChange={(event) => {
            setQuery(event.target.value)
            setHighlight(0)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          aria-invalid={hasError || undefined}
          aria-describedby={
            [hasError ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') ||
            undefined
          }
          className="h-6 min-w-32 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted focus:outline-none disabled:cursor-not-allowed"
        />
      </div>

      {open && (suggestions.length > 0 || canCreate) && (
        <ul
          id={listId}
          role="listbox"
          className="relative z-10 mt-1 max-h-56 overflow-y-auto rounded-lg border border-border bg-surface py-1 shadow-lg"
        >
          {suggestions.map((option, index) => (
            <li key={option.id}>
              <button
                type="button"
                role="option"
                aria-selected={index === highlight}
                // onMouseDown, not onClick: a click fires after blur, and the
                // list would already be closed.
                onMouseDown={(event) => {
                  event.preventDefault()
                  add(option.name)
                }}
                onMouseEnter={() => setHighlight(index)}
                className={`block w-full px-3 py-1.5 text-left text-sm ${
                  index === highlight ? 'bg-accent/15 text-accent' : 'text-foreground'
                }`}
              >
                {option.name}
              </button>
            </li>
          ))}

          {canCreate && (
            <li>
              <button
                type="button"
                role="option"
                aria-selected={highlight === suggestions.length}
                onMouseDown={(event) => {
                  event.preventDefault()
                  add(trimmed)
                }}
                onMouseEnter={() => setHighlight(suggestions.length)}
                className={`block w-full px-3 py-1.5 text-left text-sm ${
                  highlight === suggestions.length ? 'bg-accent/15 text-accent' : 'text-muted'
                }`}
              >
                Add “{trimmed}” as a new name
              </button>
            </li>
          )}
        </ul>
      )}

      {hint && !hasError && (
        <p id={hintId} className="mt-1 text-xs text-muted">
          {atLimit ? `That is the maximum of ${max}.` : hint}
        </p>
      )}

      {hasError && (
        <p id={errorId} className="mt-1 text-xs text-danger">
          {errors[0]}
        </p>
      )}

      {/* One field, so server code that splits on commas is unchanged. */}
      <input type="hidden" name={name} value={selected.join(', ')} />
    </div>
  )
}
