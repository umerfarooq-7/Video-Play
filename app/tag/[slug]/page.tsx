import { notFound } from 'next/navigation'
import { headers } from 'next/headers'
import { Hash } from 'lucide-react'
import { listVideosByTag } from '@/lib/queries'
import { BrowseResults } from '@/components/BrowseResults'
import { COUNTRY_HEADER } from '@/lib/constants'

export async function generateMetadata({ params }: PageProps<'/tag/[slug]'>) {
  const { slug } = await params
  const { tag } = await listVideosByTag(slug, { perPage: 1 })

  if (!tag) return { title: 'Tag not found' }

  return {
    title: tag.name,
    description: `Videos tagged ${tag.name}.`,
  }
}

export default async function TagPage({
  params,
  searchParams,
}: PageProps<'/tag/[slug]'>) {
  const [{ slug }, query] = await Promise.all([params, searchParams])
  const page = Number(query.page) > 0 ? Number(query.page) : 1

  const headerList = await headers()
  const country = headerList.get(COUNTRY_HEADER) || null

  const { tag, videos, total, perPage } = await listVideosByTag(slug, {
    page,
    country,
  })

  if (!tag) notFound()

  return (
    <div className="space-y-5">
      <header>
        <h1 className="inline-flex items-center gap-1.5 text-lg font-bold">
          <Hash size={17} className="text-accent" aria-hidden />
          {tag.name}
        </h1>
        <p className="mt-0.5 text-xs text-muted">
          {total} video{total === 1 ? '' : 's'}
        </p>
      </header>

      <BrowseResults
        videos={videos}
        total={total}
        page={page}
        perPage={perPage}
        basePath={`/tag/${slug}`}
        emptyMessage={`Nothing published tagged ${tag.name} yet.`}
      />
    </div>
  )
}
