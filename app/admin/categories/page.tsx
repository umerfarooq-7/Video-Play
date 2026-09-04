import { requireAdmin } from '@/lib/auth/guards'
import { createClient } from '@/lib/supabase/server'
import { CategoryEditor, NewCategoryForm } from './CategoryForms'

export const metadata = { title: 'Categories' }

export default async function AdminCategoriesPage() {
  await requireAdmin('/admin/categories')
  const supabase = await createClient()

  // Staff see inactive categories too, via the categories_public_read policy.
  const { data: categories } = await supabase
    .from('categories')
    .select('*')
    .order('sort_order')

  const rows = categories ?? []

  // How many videos sit in each category, so an admin can see what hiding one
  // would affect before doing it.
  const { data: links } = await supabase
    .from('video_categories')
    .select('category_id')

  const counts = new Map<string, number>()
  for (const link of links ?? []) {
    counts.set(link.category_id, (counts.get(link.category_id) ?? 0) + 1)
  }

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <h2 className="text-lg font-bold">Categories</h2>
        <p className="mt-0.5 text-xs leading-relaxed text-muted">
          Slugs appear in public URLs and get indexed by search engines. Change
          one and the old link stops working, so settle them before launch.
        </p>
      </div>

      <section>
        <h3 className="mb-2 text-sm font-semibold">Add a category</h3>
        <NewCategoryForm />
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold">
          Existing ({rows.length})
        </h3>
        <ul className="space-y-2">
          {rows.map((category) => (
            <li key={category.id}>
              <CategoryEditor
                category={category}
                videoCount={counts.get(category.id) ?? 0}
              />
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
