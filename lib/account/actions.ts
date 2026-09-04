'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { requireProfile } from '@/lib/auth/guards'

export type AccountState = {
  error?: string
  fieldErrors?: Record<string, string[]>
  success?: string
} | null

const profileSchema = z.object({
  displayName: z.string().trim().max(60).optional(),
  bio: z.string().trim().max(1000).optional(),
  country: z
    .union([z.string().trim().length(2), z.literal('')])
    .optional(),
  username: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9_]{3,30}$/, {
      error: '3–30 characters, letters, numbers and underscores only.',
    }),
})

/**
 * Update the caller's own profile.
 *
 * Note what is absent: role, uploader_status and is_banned. Those are refused
 * by the guard_profile_privilege_columns trigger regardless of what is posted
 * here, so there is no way for this action to escalate anything even if it is
 * later edited carelessly.
 */
export async function updateProfile(
  _prev: AccountState,
  formData: FormData,
): Promise<AccountState> {
  const profile = await requireProfile('/account')

  const parsed = profileSchema.safeParse({
    displayName: formData.get('displayName') || undefined,
    bio: formData.get('bio') || undefined,
    country: formData.get('country') || undefined,
    username: formData.get('username'),
  })

  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors }
  }

  const supabase = await createClient()
  const nextUsername = parsed.data.username

  // Changing username breaks existing profile links, so only touch it when it
  // actually differs, and check availability first for a clear error message.
  if (nextUsername.toLowerCase() !== profile.username.toLowerCase()) {
    const { data: taken } = await supabase
      .from('profiles')
      .select('id')
      .eq('username', nextUsername)
      .maybeSingle()

    if (taken) {
      return { fieldErrors: { username: ['That username is already taken.'] } }
    }
  }

  const { error } = await supabase
    .from('profiles')
    .update({
      username: nextUsername,
      display_name: parsed.data.displayName || null,
      bio: parsed.data.bio || null,
      country: parsed.data.country ? parsed.data.country.toUpperCase() : null,
    })
    .eq('id', profile.id)

  if (error) {
    // 23505 = unique_violation, i.e. the name was claimed between the check
    // above and this write.
    if (error.code === '23505') {
      return { fieldErrors: { username: ['That username is already taken.'] } }
    }
    return { error: error.message }
  }

  revalidatePath('/account')
  revalidatePath(`/u/${nextUsername}`)
  revalidatePath('/', 'layout')

  return { success: 'Profile updated.' }
}
