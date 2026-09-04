'use client'

import { useActionState } from 'react'
import { updateProfile, type AccountState } from '@/lib/account/actions'
import { Field, FormMessage, SubmitButton, TextareaField } from '@/components/form'
import type { Profile } from '@/types/database'

const COUNTRIES = [
  { value: '', label: 'Not set' },
  { value: 'GB', label: 'United Kingdom' },
  { value: 'US', label: 'United States' },
  { value: 'DE', label: 'Germany' },
]

export function AccountForm({ profile }: { profile: Profile }) {
  const [state, formAction] = useActionState<AccountState, FormData>(
    updateProfile,
    null,
  )

  return (
    <form
      action={formAction}
      className="space-y-4 rounded-xl border border-border bg-surface p-4"
    >
      <FormMessage error={state?.error} success={state?.success} />

      <Field
        label="Username"
        name="username"
        required
        defaultValue={profile.username}
        hint="Changing this changes your profile URL, and old links will stop working."
        errors={state?.fieldErrors?.username}
      />

      <Field
        label="Display name"
        name="displayName"
        defaultValue={profile.display_name ?? ''}
        hint="Shown instead of your username. Optional."
        errors={state?.fieldErrors?.displayName}
      />

      <TextareaField
        label="Bio"
        name="bio"
        rows={4}
        maxLength={1000}
        defaultValue={profile.bio ?? ''}
        errors={state?.fieldErrors?.bio}
      />

      <div>
        <label htmlFor="country" className="block text-xs font-medium">
          Country
        </label>
        <select
          id="country"
          name="country"
          defaultValue={profile.country ?? ''}
          className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-2 text-sm focus:border-accent focus:outline-none"
        >
          {COUNTRIES.map((country) => (
            <option key={country.value} value={country.value}>
              {country.label}
            </option>
          ))}
        </select>
      </div>

      <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>
    </form>
  )
}
