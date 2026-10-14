import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import { SiteHeader } from '@/components/SiteHeader'
import { SiteFooter } from '@/components/SiteFooter'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

/**
 * AdSense publisher ID. Public by definition — it ships in the page source of
 * every site that runs ads — so it is a default here rather than a secret, and
 * the environment variable exists only so a staging copy can run without ads.
 */
const ADSENSE_CLIENT =
  process.env.NEXT_PUBLIC_ADSENSE_CLIENT ?? 'ca-pub-8057123821810130'

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
  ),
  title: {
    default: 'X PORN HOUSE — Video streaming',
    template: '%s · X PORN HOUSE',
  },
  description: 'Browse, search and watch video. Adults only.',
  robots: {
    // Adult sites must self-label. `RTA-5042-1996-1400-1577-RTA` is the
    // long-standing Restricted To Adults label that filtering software reads;
    // it is emitted as a meta tag below.
    index: true,
    follow: true,
  },
  other: {
    rating: 'RTA-5042-1996-1400-1577-RTA',
  },
}

export const viewport: Viewport = {
  themeColor: '#10375c',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col font-sans">
        {/* React hoists a plain async <script> out of the tree and into the
            <head> of the server-rendered HTML, which is what AdSense needs: it
            verifies a site by reading the markup, so a loader injected after
            hydration is one it never sees. It has to sit inside <body> for
            that — between <html> and <body> it survives only in the RSC
            payload. next/script's beforeInteractive emits a preload here, not
            the tag itself, so it is not a substitute. */}
        {ADSENSE_CLIENT && (
          <script
            async
            src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`}
            crossOrigin="anonymous"
          />
        )}

        {/* Keyboard and screen-reader users land on a grid of hundreds of
            links; without this they must tab past the whole category rail. */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded focus:bg-accent focus:px-3 focus:py-2 focus:text-sm focus:text-accent-contrast"
        >
          Skip to content
        </a>

        <SiteHeader />

        <main id="main" className="mx-auto w-full max-w-[1800px] flex-1 px-3 py-5 sm:px-4">
          {children}
        </main>

        <SiteFooter />
      </body>
    </html>
  )
}
