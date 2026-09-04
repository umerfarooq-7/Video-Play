import Link from 'next/link'

const PAGES = [
  { href: '/legal/terms', label: 'Terms of service' },
  { href: '/legal/privacy', label: 'Privacy policy' },
  { href: '/legal/dmca', label: 'DMCA / copyright' },
  { href: '/legal/2257', label: '18 U.S.C. 2257' },
  { href: '/legal/content-removal', label: 'Content removal' },
]

export default function LegalLayout({ children }: LayoutProps<'/legal'>) {
  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <aside className="lg:w-56 lg:shrink-0">
        <h2 className="mb-3 text-sm font-bold">Legal</h2>
        <nav className="flex gap-1 overflow-x-auto scrollbar-none lg:flex-col lg:overflow-visible">
          {PAGES.map((page) => (
            <Link
              key={page.href}
              href={page.href}
              className="shrink-0 rounded-lg px-3 py-2 text-xs font-medium text-muted hover:bg-surface hover:text-foreground"
            >
              {page.label}
            </Link>
          ))}
        </nav>
      </aside>

      <article className="min-w-0 max-w-prose flex-1">
        {/* These pages are developer-written scaffolding, not legal advice.
            The banner is deliberately loud so nobody ships them unreviewed. */}
        <p className="mb-5 rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs leading-relaxed text-warning">
          <strong>Draft — not yet reviewed by a lawyer.</strong> This page is
          structural scaffolding showing what must be covered. It must be
          replaced with text from a lawyer qualified in each market you serve
          (UK, USA, Germany) before launch. See <code>docs/COMPLIANCE.md</code>.
        </p>
        {children}
      </article>
    </div>
  )
}
