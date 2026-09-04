import 'server-only'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { Profile } from '@/types/database'

/**
 * Authorisation guards for pages and server actions.
 *
 * These are a usability layer, not the security boundary — RLS in the database
 * is what actually stops a request. Their job is to send someone to the right
 * place instead of letting a page render empty because every query was
 * filtered away.
 *
 * Every server action that mutates must still call one of these: RLS protects
 * the rows, but an action that skips the check will surface a confusing
 * database error instead of a sensible redirect.
 */

export async function requireUser(returnTo = '/') {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(returnTo)}`)
  }

  return user
}

/** The caller's profile, guaranteed non-null. Redirects to login otherwise. */
export async function requireProfile(returnTo = '/'): Promise<Profile> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(returnTo)}`)
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!profile) {
    // The handle_new_user() trigger should make this unreachable; if it fires,
    // the trigger is missing or failed and signing out is the honest response.
    redirect('/login?error=profile-missing')
  }

  if (profile.is_banned) {
    redirect('/suspended')
  }

  return profile
}

/** Approved uploaders only. Sends everyone else to the application flow. */
export async function requireUploader(returnTo = '/studio'): Promise<Profile> {
  const profile = await requireProfile(returnTo)

  if (profile.uploader_status !== 'approved') {
    redirect('/studio/apply')
  }

  return profile
}

/** Moderators and admins. */
export async function requireStaff(returnTo = '/admin'): Promise<Profile> {
  const profile = await requireProfile(returnTo)

  if (profile.role !== 'moderator' && profile.role !== 'admin') {
    redirect('/')
  }

  return profile
}

/** Admins only — role changes, category edits, destructive operations. */
export async function requireAdmin(returnTo = '/admin'): Promise<Profile> {
  const profile = await requireProfile(returnTo)

  if (profile.role !== 'admin') {
    redirect('/admin')
  }

  return profile
}
