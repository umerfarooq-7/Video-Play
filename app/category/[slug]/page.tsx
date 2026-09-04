import { notFound } from 'next/navigation'
import Link from 'next/link'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { listVideosByCategory } from '@/lib/queries'
import { VideoGrid } from '@/components/VideoCard'
import { COUNTRY_HEADER } from '@/lib/constants'

export async function generateMetadata({ params }: PageProps<'/category/[slug]'>) {
  const { slug } = await params
  const supabase = await createClient()

  const { data: category } = await supabase
    .from('categories')
    .select('name, description')
    .eq('slug', slug)
    .maybeSingle()

  if (!category) return { title: 'Category not found' }

  return {
    title: category.name,
    description: category.description ?? `Browse ${category.name} videos.`,
  }
}

export default async function CategoryPage({
  params,
  searchParams,
}: PageProps<'/category/[slug]'>) {
  const [{ slug }, query] = await Promise.all([params, searchParams])
  const page = Number(query.page) > 0 ? Number(query.page) : 1

  const supabase = await createClient()
  const { data: category } = await supabase
    .from('categories')
    .select('id, name, description')
    .eq('slug', slug)
    .maybeSingle()

  if (!category) notFound()

  const headerList = await headers()
  const country = headerList.get(COUNTRY_HEADER) || null

  const perPage = 24
  const { videos, total } = await listVideosByCategory(slug, {
    page,
    perPage,
    country,
  })

  const totalPages = Math.max(1, Math.ceil(total / perPage))

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-bold">{category.name}</h1>
        {category.description && (
          <p className="mt-0.5 max-w-prose text-xs leading-relaxed text-muted">
            {category.description}
          </p>
        )}
        <p className="mt-1 text-xs text-muted">
          {total} video{total === 1 ? '' : 's'}
        </p>
      </div>

      <VideoGrid
        videos={videos}
        emptyMessage={`Nothing published in ${category.name} yet.`}
      />

      {totalPages > 1 && (
        <nav
          aria-label="Pagination"
          className="flex items-center justify-center gap-2 pt-2"
        >
          {page > 1 && (
            <Link
              href={`/category/${slug}?page=${page - 1}`}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-surface"
            >
              Previous
            </Link>
          )}
          <span className="text-xs text-muted">
            Page {page} of {totalPages}
          </span>
          {page < totalPages && (
            <Link
              href={`/category/${slug}?page=${page + 1}`}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-surface"
            >
              Next
            </Link>
          )}
        </nav>
      )}
    </div>
  )
}
