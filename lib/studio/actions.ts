'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { requireProfile } from '@/lib/auth/guards'

export type ActionState = {
  error?: string
  fieldErrors?: Record<string, string[]>
  success?: string
} | null

const applicationSchema = z.object({
  statement: z
    .string()
    .trim()
    .min(80, {
      error:
        'Tell us a bit more — at least 80 characters. Who are you and what will you upload?',
    })
    .max(2000, { error: 'Please keep this under 2000 characters.' }),
  siteUrl: z
    .union([z.url({ error: 'Enter a full URL including https://' }), z.literal('')])
    .optional(),
  rightsAttested: z.literal('on', {
    error: 'You must confirm you hold the rights and consent for what you upload.',
  }),
})

/**
 * Apply for upload privileges.
 *
 * Deliberately does not grant anything — it only files a `pending` row. The
 * partial unique index on uploader_applications enforces one open application
 * per user at the database level, so a double-submit cannot create two.
 */
export async function applyForUploader(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const profile = await requireProfile('/studio/apply')

  if (profile.uploader_status === 'approved') {
    return { error: 'You are already an approved uploader.' }
  }

  if (profile.uploader_status === 'suspended') {
    return {
      error:
        'Your uploader access is suspended. Contact support rather than reapplying.',
    }
  }

  const parsed = applicationSchema.safeParse({
    statement: formData.get('statement'),
    siteUrl: formData.get('siteUrl'),
    rightsAttested: formData.get('rightsAttested'),
  })

  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors }
  }

  const supabase = await createClient()

  const { error } = await supabase.from('uploader_applications').insert({
    user_id: profile.id,
    statement: parsed.data.statement,
    site_url: parsed.data.siteUrl || null,
    rights_attested: true,
    status: 'pending',
  })

  if (error) {
    // 23505 = unique_violation, i.e. the partial index caught a second open
    // application. That is a duplicate submit, not a failure worth alarming
    // the user about.
    if (error.code === '23505') {
      return { error: 'You already have an application awaiting review.' }
    }
    return { error: `Could not submit your application: ${error.message}` }
  }

  // Reflect 'pending' on the profile so the studio shell can show status
  // without joining the applications table on every render.
  await supabase
    .from('profiles')
    .update({ uploader_status: 'pending' })
    .eq('id', profile.id)

  revalidatePath('/studio', 'layout')

  return {
    success:
      'Application submitted. A moderator will review it — you will see the ' +
      'result here.',
  }
}
