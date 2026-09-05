import { notFound } from 'next/navigation'
import { headers } from 'next/headers'
import { Video as VideoIcon } from 'lucide-react'
import { listVideosByModel } from '@/lib/queries'
import { BrowseResults, EntityAvatar } from '@/components/BrowseResults'
import { COUNTRY_HEADER } from '@/lib/constants'

export async function generateMetadata({ params }: PageProps<'/model/[slug]'>) {
  const { slug } = await params
  const { model } = await listVideosByModel(slug, { perPage: 1 })

  if (!model) return { title: 'Model not found' }

  return {
    title: model.name,
    description: model.bio ?? `Videos featuring ${model.name}.`,
  }
}

export default async function ModelPage({
  params,
  searchParams,
}: PageProps<'/model/[slug]'>) {
  const [{ slug }, query] = await Promise.all([params, searchParams])
  const page = Number(query.page) > 0 ? Number(query.page) : 1

  const headerList = await headers()
  const country = headerList.get(COUNTRY_HEADER) || null

  const { model, videos, total, perPage } = await listVideosByModel(slug, {
    page,
    country,
  })

  if (!model) notFound()

  return (
    <div className="space-y-5">
      <header className="flex items-start gap-4 rounded-xl border border-border bg-surface p-4">
        <EntityAvatar src={model.avatar_url} name={model.name} size="lg" />

        <div className="min-w-0">
          <h1 className="text-lg font-bold">{model.name}</h1>
          <p className="mt-0.5 inline-flex items-center gap-1.5 text-xs text-muted">
            <VideoIcon size={13} aria-hidden />
            {total} video{total === 1 ? '' : 's'}
          </p>
          {model.bio && (
            <p className="mt-2 max-w-prose text-xs leading-relaxed text-muted">
              {model.bio}
            </p>
          )}
        </div>
      </header>

      <BrowseResults
        videos={videos}
        total={total}
        page={page}
        perPage={perPage}
        basePath={`/model/${slug}`}
        emptyMessage={`Nothing published featuring ${model.name} yet.`}
      />
    </div>
  )
}
