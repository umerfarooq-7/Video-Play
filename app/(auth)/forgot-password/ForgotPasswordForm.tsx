'use client'

import { useActionState } from 'react'
import { requestPasswordReset, type AuthState } from '@/lib/auth/actions'
import { Field, FormMessage, SubmitButton } from '@/components/form'

export function ForgotPasswordForm() {
  const [state, formAction] = useActionState<AuthState, FormData>(
    requestPasswordReset,
    null,
  )

  if (state?.success) {
    return (
      <div className="mt-5">
        <FormMessage success={state.success} />
      </div>
    )
  }

  return (
    <form action={formAction} className="mt-5 space-y-4">
      <FormMessage error={state?.error} />

      <Field
        label="Email"
        name="email"
        type="email"
        required
        autoComplete="email"
        errors={state?.fieldErrors?.email}
      />

      <SubmitButton className="w-full" pendingLabel="Sending…">
        Send reset link
      </SubmitButton>
    </form>
  )
}
