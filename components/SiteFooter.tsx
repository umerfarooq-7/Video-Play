import Link from 'next/link'

/**
 * The legal links here are not decoration: a takedown route, a 2257
 * statement and a content-removal path are the pages regulators and payment
 * processors look for first. Keep them reachable from every page.
 */
const LINK_GROUPS = [
  {
    heading: 'Browse',
    links: [
      { href: '/', label: 'Home' },
      { href: '/categories', label: 'Categories' },
      { href: '/tags', label: 'Tags' },
      { href: '/search?sort=views', label: 'Most viewed' },
      { href: '/search?projection=immersive', label: 'VR & 360' },
    ],
  },
  {
    heading: 'Creators',
    links: [
      { href: '/studio', label: 'Creator studio' },
      { href: '/studio/apply', label: 'Become an uploader' },
      { href: '/studio/upload', label: 'Upload' },
    ],
  },
  {
    heading: 'Legal',
    links: [
      { href: '/legal/terms', label: 'Terms of service' },
      { href: '/legal/privacy', label: 'Privacy policy' },
      { href: '/legal/dmca', label: 'DMCA / copyright' },
      { href: '/legal/2257', label: '18 U.S.C. 2257 statement' },
      { href: '/legal/content-removal', label: 'Content removal' },
    ],
  },
]

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-border bg-surface">
      <div className="mx-auto grid max-w-[1800px] gap-8 px-4 py-10 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <span className="text-lg font-extrabold tracking-tight">
            <span className="text-accent">V</span>Tube
          </span>
          <p className="mt-2 max-w-xs text-xs leading-relaxed text-muted">
            All performers appearing on this site were 18 years or older at the
            time of production. Access is restricted to adults.
          </p>
        </div>

        {LINK_GROUPS.map((group) => (
          <nav key={group.heading} aria-label={group.heading}>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-foreground">
              {group.heading}
            </h2>
            <ul className="mt-3 space-y-1.5">
              {group.links.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-xs text-muted hover:text-accent"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>

      <div className="border-t border-border px-4 py-4">
        <p className="mx-auto max-w-[1800px] text-xs text-muted">
          &copy; {new Date().getFullYear()} VTube. 18+ only.
        </p>
      </div>
    </footer>
  )
}
