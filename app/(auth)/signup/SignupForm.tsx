'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { signUp, type AuthState } from '@/lib/auth/actions'
import {
  CheckboxField,
  Field,
  FormMessage,
  SubmitButton,
} from '@/components/form'

export function SignupForm() {
  const [state, formAction] = useActionState<AuthState, FormData>(signUp, null)

  // Once the confirmation email is away there is nothing left to fill in, so
  // swap the form out rather than leaving a resubmittable copy on screen.
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
        label="Username"
        name="username"
        required
        autoComplete="username"
        hint="3–30 characters. Letters, numbers and underscores."
        errors={state?.fieldErrors?.username}
      />

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
        autoComplete="new-password"
        hint="At least 10 characters."
        errors={state?.fieldErrors?.password}
      />

      <CheckboxField name="ageConfirmed" errors={state?.fieldErrors?.ageConfirmed}>
        I confirm I am at least 18 years old, or the age of majority where I
        live, whichever is higher.
      </CheckboxField>

      <CheckboxField
        name="termsAccepted"
        errors={state?.fieldErrors?.termsAccepted}
      >
        I accept the{' '}
        <Link href="/legal/terms" className="text-accent hover:underline">
          terms of service
        </Link>{' '}
        and{' '}
        <Link href="/legal/privacy" className="text-accent hover:underline">
          privacy policy
        </Link>
        .
      </CheckboxField>

      <SubmitButton className="w-full" pendingLabel="Creating account…">
        Create account
      </SubmitButton>
    </form>
  )
}
