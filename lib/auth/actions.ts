'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { env } from '@/lib/env'

/**
 * Auth server actions.
 *
 * Every one of these returns a plain `{ error }` object rather than throwing,
 * so `useActionState` can render the message inline. Errors are deliberately
 * vague about *which* half of a credential pair was wrong — saying "no account
 * with that email" turns the login form into an account-enumeration oracle.
 */

export type AuthState = {
  error?: string
  fieldErrors?: Record<string, string[]>
  success?: string
} | null

const signupSchema = z.object({
  email: z.email({ error: 'Enter a valid email address.' }).trim(),
  password: z
    .string()
    .min(10, { error: 'Use at least 10 characters.' })
    .max(200, { error: 'That password is too long.' }),
  username: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9_]{3,30}$/, {
      error: '3–30 characters, letters, numbers and underscores only.',
    }),
  ageConfirmed: z.literal('on', {
    error: 'You must confirm you are 18 or older.',
  }),
  termsAccepted: z.literal('on', {
    error: 'You must accept the terms to create an account.',
  }),
})

export async function signUp(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = signupSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    username: formData.get('username'),
    ageConfirmed: formData.get('ageConfirmed'),
    termsAccepted: formData.get('termsAccepted'),
  })

  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors }
  }

  const { email, password, username } = parsed.data
  const supabase = await createClient()

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // handle_new_user() reads this to seed profiles.username.
      data: { username },
      emailRedirectTo: `${env.NEXT_PUBLIC_SITE_URL}/auth/callback`,
    },
  })

  if (error) {
    return { error: friendlySignupError(error.code, error.message) }
  }

  // When "Confirm email" is switched off in the Supabase dashboard, signUp
  // returns a live session and the account is usable immediately. Telling that
  // person to go and check their inbox would strand them on a dead end.
  if (data.session) {
    revalidatePath('/', 'layout')
    redirect('/')
  }

  // Supabase returns success whether or not the address was already taken, to
  // avoid leaking which emails are registered. Mirror that in the copy.
  return {
    success:
      'Check your email for a confirmation link. If an account already exists ' +
      'for that address, you will get a sign-in link instead.',
  }
}

/**
 * Supabase's raw auth errors are aimed at developers. Translate the ones a
 * real person can actually hit, and keep the rest generic so an internal
 * message never lands in the UI.
 */
function friendlySignupError(code: string | undefined, message: string): string {
  switch (code) {
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
      return (
        'Too many sign-up emails have been sent recently. Wait an hour and try ' +
        'again — or, if you are the site operator, configure custom SMTP in the ' +
        'Supabase dashboard (the built-in mailer is rate limited and is not ' +
        'intended for production).'
      )
    case 'weak_password':
      return 'That password is too weak. Try a longer one.'
    case 'email_address_invalid':
      return 'That email address was rejected. Check it and try again.'
    case 'signup_disabled':
      return 'New sign-ups are currently disabled.'
    default:
      // Surface the message in development, where it is useful; in production
      // it may leak configuration detail.
      return process.env.NODE_ENV === 'production'
        ? 'Could not create your account. Please try again.'
        : message
  }
}

const loginSchema = z.object({
  email: z.email({ error: 'Enter a valid email address.' }).trim(),
  password: z.string().min(1, { error: 'Enter your password.' }),
})

export async function logIn(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })

  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword(parsed.data)

  if (error) {
    return { error: 'That email and password combination is not correct.' }
  }

  const redirectTo = safeNext(String(formData.get('next') ?? '/'))

  revalidatePath('/', 'layout')
  redirect(redirectTo)
}

export async function logOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  revalidatePath('/', 'layout')
  redirect('/')
}

const resetSchema = z.object({
  email: z.email({ error: 'Enter a valid email address.' }).trim(),
})

export async function requestPasswordReset(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = resetSchema.safeParse({ email: formData.get('email') })

  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors }
  }

  const supabase = await createClient()
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${env.NEXT_PUBLIC_SITE_URL}/auth/callback?next=/account/password`,
  })

  // Always report success: a differing response would reveal which addresses
  // have accounts.
  return {
    success: 'If an account exists for that address, a reset link is on its way.',
  }
}

const passwordSchema = z
  .object({
    password: z.string().min(10, { error: 'Use at least 10 characters.' }),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    error: 'Those passwords do not match.',
    path: ['confirm'],
  })

export async function updatePassword(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = passwordSchema.safeParse({
    password: formData.get('password'),
    confirm: formData.get('confirm'),
  })

  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  })

  if (error) return { error: error.message }

  return { success: 'Password updated.' }
}

/** Never redirect off-site: a `?next=` that accepts absolute URLs is an
 *  open redirect, and login pages are the classic place to abuse one. */
function safeNext(value: string): string {
  if (!value.startsWith('/') || value.startsWith('//')) return '/'
  return value
}
