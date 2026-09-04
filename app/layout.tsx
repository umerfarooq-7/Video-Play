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

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
  ),
  title: {
    default: 'VTube — Video streaming',
    template: '%s · VTube',
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
  themeColor: '#0b0b0e',
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
