'use client'

import { useActionState } from 'react'
import { logIn, type AuthState } from '@/lib/auth/actions'
import { Field, FormMessage, SubmitButton } from '@/components/form'

export function LoginForm({ next }: { next: string }) {
  const [state, formAction] = useActionState<AuthState, FormData>(logIn, null)

  return (
    <form action={formAction} className="mt-5 space-y-4">
      <input type="hidden" name="next" value={next} />

      <FormMessage error={state?.error} success={state?.success} />

      <Field
        label="Email"
        name="email"
        type="email"
        required
        autoComplete="email"
        errors={state?.fieldErrors?.email}
      />

      <Field
        label="Password"
        name="password"
        type="password"
        required
        autoComplete="current-password"
        errors={state?.fieldErrors?.password}
      />

      <SubmitButton className="w-full" pendingLabel="Logging in…">
        Log in
      </SubmitButton>
    </form>
  )
}
