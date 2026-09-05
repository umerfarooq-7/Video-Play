import Link from 'next/link'
import { headers } from 'next/headers'
import { ChevronRight } from 'lucide-react'
import {
  listVideos,
  getCategories,
  getFeaturedModels,
  getFeaturedPaysites,
  getPopularTags,
} from '@/lib/queries'
import { VideoGrid } from '@/components/VideoCard'
import { EntityAvatar } from '@/components/BrowseResults'
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

  const [trending, latest, categories, models, paysites, tags] = await Promise.all([
    listVideos({ sort: 'views', perPage: 12, country }),
    listVideos({ sort: 'new', perPage: 24, country }),
    getCategories(),
    getFeaturedModels(18),
    getFeaturedPaysites(18),
    getPopularTags(40),
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

      {/* Discovery rails. These only appear once there is something behind
          them — an empty "Models" strip on a new site looks broken rather than
          new. */}
      {models.length > 0 && (
        <section>
          <SectionHeading title="Models" href="/models" />
          <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-none">
            {models.map((model) => (
              <Link
                key={model.id}
                href={`/model/${model.slug}`}
                className="group flex w-20 shrink-0 flex-col items-center gap-1.5 text-center"
              >
                <EntityAvatar src={model.avatar_url} name={model.name} size="md" />
                <span className="line-clamp-2 text-xs font-medium leading-tight text-muted group-hover:text-accent">
                  {model.name}
                </span>
                <span className="text-[10px] text-muted">
                  {model.video_count}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {paysites.length > 0 && (
        <section>
          <SectionHeading title="Networks" href="/networks" />
          <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-none">
            {paysites.map((paysite) => (
              <Link
                key={paysite.id}
                href={`/paysite/${paysite.domain}`}
                className="group flex w-36 shrink-0 items-center gap-2 rounded-lg border border-border bg-surface p-2.5 hover:border-accent"
              >
                <EntityAvatar src={paysite.logo_url} name={paysite.name} size="sm" />
                <span className="min-w-0">
                  <span className="block truncate text-xs font-semibold group-hover:text-accent">
                    {paysite.name}
                  </span>
                  <span className="text-[10px] text-muted">
                    {paysite.video_count} video{paysite.video_count === 1 ? '' : 's'}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {tags.length > 0 && (
        <section>
          <SectionHeading title="Popular tags" href="/tags" />
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => (
              <Link
                key={tag.id}
                href={`/tag/${tag.slug}`}
                className="rounded-full border border-border bg-surface px-3.5 py-1.5 text-xs font-medium text-muted transition-colors hover:border-accent hover:text-accent"
              >
                {tag.name}
                {tag.usage_count > 0 && (
                  <span className="ml-1.5 text-[10px] opacity-70">
                    {tag.usage_count}
                  </span>
                )}
              </Link>
            ))}
          </div>
        </section>
      )}

      {categories.length > 0 && (
        <section>
          <SectionHeading title="Categories" href="/categories" />
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

      <section>
        <SectionHeading title="Recently added" href="/search?sort=new" />
        <VideoGrid videos={latest.videos} emptyMessage="No videos yet." />
      </section>
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
