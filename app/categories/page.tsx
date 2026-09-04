import Link from 'next/link'
import { getCategories } from '@/lib/queries'

export const metadata = {
  title: 'All categories',
  description: 'Browse every category on the site.',
}

export default async function CategoriesPage() {
  const categories = await getCategories()

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-bold">All categories</h1>
        <p className="mt-0.5 text-xs text-muted">
          {categories.length} categor{categories.length === 1 ? 'y' : 'ies'}.
        </p>
      </div>

      {categories.length === 0 ? (
        <p className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-muted">
          No categories yet.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {categories.map((category) => (
            <Link
              key={category.id}
              href={`/category/${category.slug}`}
              className="group rounded-xl border border-border bg-surface p-4 transition-colors hover:border-accent"
            >
              <h2 className="text-sm font-semibold group-hover:text-accent">
                {category.name}
              </h2>
              {category.description && (
                <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted">
                  {category.description}
                </p>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
