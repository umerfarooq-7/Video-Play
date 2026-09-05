import { notFound } from 'next/navigation'
import { headers } from 'next/headers'
import { ExternalLink, Video as VideoIcon } from 'lucide-react'
import { listVideosByPaysite } from '@/lib/queries'
import { BrowseResults, EntityAvatar } from '@/components/BrowseResults'
import { COUNTRY_HEADER } from '@/lib/constants'

export async function generateMetadata({ params }: PageProps<'/paysite/[domain]'>) {
  const { domain } = await params
  const { paysite } = await listVideosByPaysite(domain, { perPage: 1 })

  if (!paysite) return { title: 'Network not found' }

  return {
    title: paysite.name,
    description: paysite.description ?? `Videos from ${paysite.name}.`,
  }
}

export default async function PaysitePage({
  params,
  searchParams,
}: PageProps<'/paysite/[domain]'>) {
  const [{ domain }, query] = await Promise.all([params, searchParams])
  const page = Number(query.page) > 0 ? Number(query.page) : 1

  const headerList = await headers()
  const country = headerList.get(COUNTRY_HEADER) || null

  const { paysite, videos, total, perPage } = await listVideosByPaysite(domain, {
    page,
    country,
  })

  if (!paysite) notFound()

  const outboundUrl = paysite.site_url ?? `https://${paysite.domain}`

  return (
    <div className="space-y-5">
      <header className="flex items-start gap-4 rounded-xl border border-border bg-surface p-4">
        <EntityAvatar src={paysite.logo_url} name={paysite.name} size="lg" />

        <div className="min-w-0">
          <h1 className="text-lg font-bold">{paysite.name}</h1>

          <p className="mt-0.5 inline-flex items-center gap-1.5 text-xs text-muted">
            <VideoIcon size={13} aria-hidden />
            {total} video{total === 1 ? '' : 's'}
          </p>

          {paysite.description && (
            <p className="mt-2 max-w-prose text-xs leading-relaxed text-muted">
              {paysite.description}
            </p>
          )}

          {/* Outbound link to the rightsholder. nofollow because this is an
              attribution credit, not an endorsement we want to pass rank to,
              and the destination is data an uploader typed. */}
          <a
            href={outboundUrl}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
          >
            {paysite.domain}
            <ExternalLink size={11} aria-hidden />
          </a>
        </div>
      </header>

      <BrowseResults
        videos={videos}
        total={total}
        page={page}
        perPage={perPage}
        basePath={`/paysite/${domain}`}
        emptyMessage={`Nothing published from ${paysite.name} yet.`}
      />
    </div>
  )
}
