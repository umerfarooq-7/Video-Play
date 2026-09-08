import Link from 'next/link'
import { headers } from 'next/headers'
import { ChevronRight } from 'lucide-react'
import {
  listVideos,
  getCategories,
  getFeaturedModels,
  getFeaturedPaysites,
} from '@/lib/queries'
import { VideoGrid } from '@/components/VideoCard'
import { EntityAvatar } from '@/components/BrowseResults'
import { REGION_CONFIG, isRegion } from '@/lib/geo'
import { COUNTRY_HEADER, REGION_HEADER } from '@/lib/constants'

export const metadata = {
  title: 'X PORN HOUSE — Video streaming',
}

export default async function HomePage() {
  // proxy.ts resolves these once per request and forwards them as headers, so
  // the page does not repeat the geo lookup.
  const headerList = await headers()
  const country = headerList.get(COUNTRY_HEADER) || null
  const regionHeader = headerList.get(REGION_HEADER)
  const region = isRegion(regionHeader) ? regionHeader : 'INT'
  const regionConfig = REGION_CONFIG[region]

  const [trending, latest, models, paysites, categories] = await Promise.all([
    listVideos({ sort: 'views', perPage: 12, country }),
    listVideos({ sort: 'new', perPage: 24, country }),
    getFeaturedModels(24),
    getFeaturedPaysites(24),
    getCategories(),
  ])

  return (
    <div className="space-y-6">
      {/*
        Discovery strips: models, networks, categories.

        Deliberately compact and unlabelled. Each is visually self-explanatory
        — faces, logos, short words — and a heading above each one pushed the
        first video card most of a screen further down.
      */}
      {models.length > 0 && (
        <Rail seeAllHref="/models" seeAllLabel="All models" label="Models">
          {models.map((model) => (
            <Link
              key={model.id}
              href={`/model/${model.slug}`}
              className="group flex w-16 shrink-0 flex-col items-center gap-1 text-center"
            >
              <EntityAvatar src={model.avatar_url} name={model.name} size="sm" />
              <span className="line-clamp-1 w-full text-[11px] font-medium leading-tight text-muted group-hover:text-accent">
                {model.name}
              </span>
            </Link>
          ))}
        </Rail>
      )}

      {paysites.length > 0 && (
        <Rail seeAllHref="/networks" seeAllLabel="All networks" label="Networks">
          {paysites.map((paysite) => (
            <Link
              key={paysite.id}
              href={`/paysite/${paysite.domain}`}
              className="group flex shrink-0 items-center gap-2 rounded-full border border-border bg-surface py-1 pl-1 pr-3 hover:border-accent"
            >
              <EntityAvatar src={paysite.logo_url} name={paysite.name} size="xs" />
              <span className="whitespace-nowrap text-xs font-medium group-hover:text-accent">
                {paysite.name}
              </span>
            </Link>
          ))}
        </Rail>
      )}

      {/* Categories, in the slot tags used to occupy. Tags were dropped from
          the home page: they overlapped heavily with categories and gave
          visitors two competing ways to browse the same thing. Tag pages still
          exist and are still linked from each watch page. */}
      {categories.length > 0 && (
        <Rail seeAllHref="/categories" seeAllLabel="All categories" label="Categories">
          {categories.map((category) => (
            <Link
              key={category.id}
              href={`/category/${category.slug}`}
              className="shrink-0 whitespace-nowrap rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-muted hover:border-accent hover:text-accent"
            >
              {category.name}
            </Link>
          ))}
        </Rail>
      )}

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
    </div>
  )
}

/**
 * One horizontally scrolling strip.
 *
 * `label` is not rendered visually — it exists so screen readers still get a
 * name for the region, which a row of bare links would otherwise lack.
 */
function Rail({
  label,
  seeAllHref,
  seeAllLabel,
  children,
}: {
  label: string
  seeAllHref: string
  seeAllLabel: string
  children: React.ReactNode
}) {
  return (
    <nav aria-label={label} className="flex items-center">
      {/* The "see all" link is the last item inside the scroller, not pinned
          beside it. Pinned, it sat where the strip visually ended and read as
          though the list stopped there — so people never scrolled past the
          first few. Now the strip runs through everything and the link is what
          you reach at the end of it. */}
      <div className="flex flex-1 items-center gap-2.5 overflow-x-auto pb-1 scrollbar-none">
        {children}
        <Link
          href={seeAllHref}
          className="shrink-0 whitespace-nowrap rounded-full border border-accent px-3 py-1 text-xs font-semibold text-accent hover:bg-accent hover:text-accent-contrast"
        >
          {seeAllLabel}
        </Link>
      </div>
    </nav>
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
    <div className="mb-2.5 flex items-baseline justify-between gap-3">
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
