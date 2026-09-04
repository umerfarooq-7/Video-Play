import Link from 'next/link'
import { headers } from 'next/headers'
import { ChevronRight } from 'lucide-react'
import { listVideos, getCategories } from '@/lib/queries'
import { VideoGrid } from '@/components/VideoCard'
import { REGION_CONFIG, isRegion } from '@/lib/geo'
import { COUNTRY_HEADER, REGION_HEADER } from '@/lib/constants'

export const metadata = {
  title: 'VTube — Video streaming',
}

export default async function HomePage() {
  // proxy.ts resolves these once per request and forwards them as headers, so
  // the page does not repeat the geo lookup.
  const headerList = await headers()
  const country = headerList.get(COUNTRY_HEADER) || null
  const regionHeader = headerList.get(REGION_HEADER)
  const region = isRegion(regionHeader) ? regionHeader : 'INT'
  const regionConfig = REGION_CONFIG[region]

  const [latest, trending, categories] = await Promise.all([
    listVideos({ sort: 'new', perPage: 24, country }),
    listVideos({ sort: 'views', perPage: 12, country }),
    getCategories(),
  ])

  return (
    <div className="space-y-10">
      <section>
        <SectionHeading
          title="Trending now"
          href="/search?sort=views"
          subtitle={
            regionConfig.region === 'INT'
              ? undefined
              : `Popular in ${regionConfig.label}`
          }
        />
        <VideoGrid
          videos={trending.videos}
          emptyMessage="Nothing published yet. Approve an uploader and publish a video to fill this grid."
        />
      </section>

      <section>
        <SectionHeading title="Recently added" href="/search?sort=new" />
        <VideoGrid videos={latest.videos} emptyMessage="No videos yet." />
      </section>

      {categories.length > 0 && (
        <section>
          <h2 className="mb-3 text-base font-semibold">Browse by category</h2>
          <div className="flex flex-wrap gap-2">
            {categories.map((category) => (
              <Link
                key={category.id}
                href={`/category/${category.slug}`}
                className="rounded-full border border-border bg-surface px-3.5 py-1.5 text-xs font-medium text-muted transition-colors hover:border-accent hover:text-accent"
              >
                {category.name}
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function SectionHeading({
  title,
  subtitle,
  href,
}: {
  title: string
  subtitle?: string
  href: string
}) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
      </div>
      <Link
        href={href}
        className="inline-flex shrink-0 items-center gap-0.5 text-xs font-medium text-accent hover:underline"
      >
        See all
        <ChevronRight size={13} aria-hidden />
      </Link>
    </div>
  )
}
