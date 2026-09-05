'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/guards'
import { slugify } from '@/lib/format'

export type CatalogState = {
  error?: string
  fieldErrors?: Record<string, string[]>
  success?: string
} | null

/**
 * Image URLs are stored as-is rather than uploaded, so a paysite logo or model
 * photo is a paste-a-link job. Only http(s) is accepted: a `javascript:` or
 * `data:` URL rendered into an <img src> is an injection vector.
 */
const imageUrl = z
  .union([z.url(), z.literal('')])
  .optional()
  .refine((v) => !v || /^https?:\/\//.test(v), {
    error: 'Image links must start with http:// or https://',
  })

// ---------------------------------------------------------------------------
// Paysites
// ---------------------------------------------------------------------------

const paysiteSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(2, { error: 'Name is required.' }).max(80),
  domain: z
    .string()
    .trim()
    .min(3, { error: 'Domain is required.' })
    .transform((v) =>
      v.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, ''),
    )
    .refine((v) => /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(v), {
      error: 'Enter a bare domain, for example: example.com',
    }),
  siteUrl: z.union([z.url(), z.literal('')]).optional(),
  description: z.string().trim().max(500).optional(),
  logoUrl: imageUrl,
  isFeatured: z.boolean().optional(),
})

function readPaysite(formData: FormData) {
  return paysiteSchema.safeParse({
    id: formData.get('id') || undefined,
    name: formData.get('name'),
    domain: formData.get('domain'),
    siteUrl: formData.get('siteUrl') || undefined,
    description: formData.get('description') || undefined,
    logoUrl: formData.get('logoUrl') || undefined,
    isFeatured: formData.get('isFeatured') === 'on',
  })
}

export async function savePaysite(
  _prev: CatalogState,
  formData: FormData,
): Promise<CatalogState> {
  await requireAdmin('/admin/paysites')

  const parsed = readPaysite(formData)
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors }
  }

  const supabase = await createClient()
  const { id, name, domain, siteUrl, description, logoUrl, isFeatured } = parsed.data

  const values = {
    name,
    domain,
    site_url: siteUrl || null,
    description: description || null,
    logo_url: logoUrl || null,
    is_featured: isFeatured ?? false,
    // Anything an admin touches is, by definition, reviewed.
    is_approved: true,
  }

  const { error } = id
    ? await supabase.from('paysites').update(values).eq('id', id)
    : await supabase.from('paysites').insert(values)

  if (error) {
    if (error.code === '23505') {
      return { fieldErrors: { domain: ['That domain already exists.'] } }
    }
    return { error: error.message }
  }

  revalidatePath('/admin/paysites')
  revalidatePath('/networks')
  revalidatePath('/')

  return { success: id ? 'Network updated.' : `Added ${name}.` }
}

export async function deletePaysite(
  _prev: CatalogState,
  formData: FormData,
): Promise<CatalogState> {
  await requireAdmin('/admin/paysites')

  const id = String(formData.get('id') ?? '')
  if (!z.uuid().safeParse(id).success) return { error: 'Invalid network.' }

  const supabase = await createClient()

  // videos.paysite_id is ON DELETE SET NULL, so removing a network orphans its
  // videos rather than deleting them — but they lose their attribution, which
  // matters for takedown disputes. Warn instead of silently unlinking.
  const { count } = await supabase
    .from('videos')
    .select('id', { count: 'exact', head: true })
    .eq('paysite_id', id)

  if ((count ?? 0) > 0) {
    return {
      error:
        `${count} video${count === 1 ? ' is' : 's are'} attributed to this network. ` +
        'Reassign them first — deleting would strip their source attribution.',
    }
  }

  const { error } = await supabase.from('paysites').delete().eq('id', id)
  if (error) return { error: error.message }

  revalidatePath('/admin/paysites')
  revalidatePath('/networks')
  revalidatePath('/')

  return { success: 'Network deleted.' }
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

const modelSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(2, { error: 'Name is required.' }).max(80),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
      error: 'Lowercase letters, numbers and single hyphens only.',
    })
    .max(80)
    .optional()
    .or(z.literal('')),
  bio: z.string().trim().max(1000).optional(),
  avatarUrl: imageUrl,
  isFeatured: z.boolean().optional(),
})

export async function saveModel(
  _prev: CatalogState,
  formData: FormData,
): Promise<CatalogState> {
  await requireAdmin('/admin/models')

  const parsed = modelSchema.safeParse({
    id: formData.get('id') || undefined,
    name: formData.get('name'),
    slug: formData.get('slug') || undefined,
    bio: formData.get('bio') || undefined,
    avatarUrl: formData.get('avatarUrl') || undefined,
    isFeatured: formData.get('isFeatured') === 'on',
  })

  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors }
  }

  const { id, name, bio, avatarUrl, isFeatured } = parsed.data
  const slug = parsed.data.slug || slugify(name)

  if (!slug) {
    return { fieldErrors: { slug: ['Could not build a slug from that name.'] } }
  }

  const supabase = await createClient()

  const values = {
    name,
    slug,
    bio: bio || null,
    avatar_url: avatarUrl || null,
    is_featured: isFeatured ?? false,
    is_approved: true,
  }

  const { error } = id
    ? await supabase.from('models').update(values).eq('id', id)
    : await supabase.from('models').insert(values)

  if (error) {
    if (error.code === '23505') {
      return { fieldErrors: { slug: ['That slug is already in use.'] } }
    }
    return { error: error.message }
  }

  revalidatePath('/admin/models')
  revalidatePath('/models')
  revalidatePath('/')

  return { success: id ? 'Model updated.' : `Added ${name}.` }
}

export async function deleteModel(
  _prev: CatalogState,
  formData: FormData,
): Promise<CatalogState> {
  await requireAdmin('/admin/models')

  const id = String(formData.get('id') ?? '')
  if (!z.uuid().safeParse(id).success) return { error: 'Invalid model.' }

  const supabase = await createClient()

  // video_models cascades, so deleting would silently strip this performer
  // from every video they appear in.
  const { count } = await supabase
    .from('video_models')
    .select('video_id', { count: 'exact', head: true })
    .eq('model_id', id)

  if ((count ?? 0) > 0) {
    return {
      error:
        `This model is linked to ${count} video${count === 1 ? '' : 's'}. ` +
        'Unlink them first — deleting removes the credit from all of them.',
    }
  }

  const { error } = await supabase.from('models').delete().eq('id', id)
  if (error) return { error: error.message }

  revalidatePath('/admin/models')
  revalidatePath('/models')
  revalidatePath('/')

  return { success: 'Model deleted.' }
}
