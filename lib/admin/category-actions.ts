'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/guards'
import { slugify } from '@/lib/format'

export type CategoryState = {
  error?: string
  fieldErrors?: Record<string, string[]>
  success?: string
} | null

const categorySchema = z.object({
  name: z.string().trim().min(2, { error: 'Name must be at least 2 characters.' }).max(60),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
      error: 'Lowercase letters, numbers and single hyphens only.',
    })
    .max(60)
    .optional()
    .or(z.literal('')),
  description: z.string().trim().max(500).optional(),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
})

export async function createCategory(
  _prev: CategoryState,
  formData: FormData,
): Promise<CategoryState> {
  await requireAdmin('/admin/categories')

  const parsed = categorySchema.safeParse({
    name: formData.get('name'),
    slug: formData.get('slug') || undefined,
    description: formData.get('description') || undefined,
    sortOrder: formData.get('sortOrder') || undefined,
  })

  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors }
  }

  // Derive the slug from the name when one is not given explicitly.
  const slug = parsed.data.slug || slugify(parsed.data.name)
  if (!slug) {
    return { fieldErrors: { slug: ['Could not build a slug from that name.'] } }
  }

  const supabase = await createClient()

  const { error } = await supabase.from('categories').insert({
    name: parsed.data.name,
    slug,
    description: parsed.data.description || null,
    sort_order: parsed.data.sortOrder ?? 0,
    is_active: true,
  })

  if (error) {
    if (error.code === '23505') {
      return { fieldErrors: { slug: ['That slug is already in use.'] } }
    }
    return { error: error.message }
  }

  revalidatePath('/admin/categories')
  revalidatePath('/categories')
  revalidatePath('/', 'layout')

  return { success: `Created "${parsed.data.name}".` }
}

const updateSchema = categorySchema.extend({
  id: z.uuid(),
  isActive: z.boolean().optional(),
})

export async function updateCategory(
  _prev: CategoryState,
  formData: FormData,
): Promise<CategoryState> {
  await requireAdmin('/admin/categories')

  const parsed = updateSchema.safeParse({
    id: formData.get('id'),
    name: formData.get('name'),
    slug: formData.get('slug') || undefined,
    description: formData.get('description') || undefined,
    sortOrder: formData.get('sortOrder') || undefined,
    isActive: formData.get('isActive') === 'on',
  })

  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors }
  }

  const supabase = await createClient()

  const { error } = await supabase
    .from('categories')
    .update({
      name: parsed.data.name,
      // Slugs are the public URL contract; only change one deliberately.
      ...(parsed.data.slug ? { slug: parsed.data.slug } : {}),
      description: parsed.data.description || null,
      sort_order: parsed.data.sortOrder ?? 0,
      is_active: parsed.data.isActive ?? true,
    })
    .eq('id', parsed.data.id)

  if (error) {
    if (error.code === '23505') {
      return { fieldErrors: { slug: ['That slug is already in use.'] } }
    }
    return { error: error.message }
  }

  revalidatePath('/admin/categories')
  revalidatePath('/categories')
  revalidatePath('/', 'layout')

  return { success: 'Category updated.' }
}

/**
 * Deactivate rather than delete.
 *
 * Deleting cascades to video_categories and silently strips the category from
 * every video that used it — unrecoverable. Hiding it keeps those links intact
 * if it is ever turned back on.
 */
export async function deactivateCategory(
  _prev: CategoryState,
  formData: FormData,
): Promise<CategoryState> {
  await requireAdmin('/admin/categories')

  const id = String(formData.get('id') ?? '')
  if (!z.uuid().safeParse(id).success) return { error: 'Invalid category.' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('categories')
    .update({ is_active: false })
    .eq('id', id)

  if (error) return { error: error.message }

  revalidatePath('/admin/categories')
  revalidatePath('/categories')
  revalidatePath('/', 'layout')

  return { success: 'Category hidden. Videos keep their existing links.' }
}
