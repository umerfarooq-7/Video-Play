'use client'

import { useActionState } from 'react'
import { updatePassword, type AuthState } from '@/lib/auth/actions'
import { Field, FormMessage, SubmitButton } from '@/components/form'

export function PasswordForm() {
  const [state, formAction] = useActionState<AuthState, FormData>(
    updatePassword,
    null,
  )

  return (
    <form
      action={formAction}
      className="space-y-4 rounded-xl border border-border bg-surface p-4"
    >
      <FormMessage error={state?.error} success={state?.success} />

      <Field
        label="New password"
        name="password"
        type="password"
        required
        autoComplete="new-password"
        hint="At least 10 characters."
        errors={state?.fieldErrors?.password}
      />

      <Field
        label="Confirm new password"
        name="confirm"
        type="password"
        required
        autoComplete="new-password"
        errors={state?.fieldErrors?.confirm}
      />

      <SubmitButton pendingLabel="Updating…">Update password</SubmitButton>
    </form>
  )
}
