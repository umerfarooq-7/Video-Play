import Link from 'next/link'
import { Search, Upload, Shield, User as UserIcon } from 'lucide-react'
import { getCurrentProfile } from '@/lib/supabase/server'
import { getCategories } from '@/lib/queries'
import { MobileNav } from '@/components/MobileNav'

/**
 * Server component: reads the session directly rather than fetching auth state
 * on the client, so the header renders correct on first paint instead of
 * flashing a logged-out state.
 */
export async function SiteHeader() {
  const [profile, categories] = await Promise.all([
    getCurrentProfile(),
    getCategories(),
  ])

  const isStaff = profile?.role === 'admin' || profile?.role === 'moderator'
  const canUpload = profile?.uploader_status === 'approved'

  const navCategories = categories.slice(0, 8)

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1800px] items-center gap-3 px-3 sm:px-4">
        <MobileNav categories={categories} />

        <Link
          href="/"
          className="shrink-0 text-lg font-extrabold tracking-tight text-foreground"
        >
          <span className="text-accent">V</span>Tube
        </Link>

        {/* Search is a plain GET form so it works without JavaScript and the
            result page stays linkable and crawlable. */}
        <form action="/search" method="get" className="relative flex-1 max-w-2xl">
          <label htmlFor="site-search" className="sr-only">
            Search videos
          </label>
          <input
            id="site-search"
            type="search"
            name="q"
            placeholder="Search videos, categories, tags…"
            autoComplete="off"
            className="h-9 w-full rounded-full border border-border bg-surface pl-9 pr-3 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none"
          />
          <Search
            size={15}
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
          />
        </form>

        <nav className="flex shrink-0 items-center gap-1.5">
          {canUpload && (
            <Link
              href="/studio/upload"
              className="hidden items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-accent-contrast hover:bg-accent-hover sm:inline-flex"
            >
              <Upload size={14} aria-hidden />
              Upload
            </Link>
          )}

          {isStaff && (
            <Link
              href="/admin"
              // Labelled rather than an icon alone: moderators live in this
              // dashboard, and a bare shield next to the avatar reads as
              // decoration. The label collapses on narrow screens where the
              // search field needs the room.
              className="inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent/20"
            >
              <Shield size={14} aria-hidden />
              <span className="hidden sm:inline">
                {profile?.role === 'admin' ? 'Admin' : 'Moderate'}
              </span>
              <span className="sr-only">Admin dashboard</span>
            </Link>
          )}

          {profile ? (
            <Link
              href={`/u/${profile.username}`}
              className="flex items-center gap-2 rounded-full py-1 pl-1 pr-3 text-sm hover:bg-surface"
            >
              <span className="grid size-7 place-items-center rounded-full bg-surface-raised text-xs font-semibold uppercase">
                {(profile.display_name ?? profile.username).charAt(0)}
              </span>
              <span className="hidden max-w-28 truncate sm:inline">
                {profile.display_name ?? profile.username}
              </span>
            </Link>
          ) : (
            <>
              <Link
                href="/login"
                className="rounded-full px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-surface"
              >
                Log in
              </Link>
              <Link
                href="/signup"
                className="hidden rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-accent-contrast hover:bg-accent-hover sm:inline-flex"
              >
                <UserIcon size={14} className="mr-1" aria-hidden />
                Sign up
              </Link>
            </>
          )}
        </nav>
      </div>

      {/* Category rail. Horizontally scrollable rather than wrapped, so it
          stays one row on a phone. */}
      <div className="border-t border-border">
        <div className="mx-auto flex max-w-[1800px] gap-1 overflow-x-auto px-3 py-1.5 scrollbar-none sm:px-4">
          <Link
            href="/"
            className="shrink-0 rounded-full px-3 py-1 text-xs font-medium text-muted hover:bg-surface hover:text-foreground"
          >
            Home
          </Link>
          {navCategories.map((category) => (
            <Link
              key={category.id}
              href={`/category/${category.slug}`}
              className="shrink-0 rounded-full px-3 py-1 text-xs font-medium text-muted hover:bg-surface hover:text-foreground"
            >
              {category.name}
            </Link>
          ))}
          <Link
            href="/categories"
            className="shrink-0 rounded-full px-3 py-1 text-xs font-medium text-accent hover:bg-surface"
          >
            All categories
          </Link>
        </div>
      </div>
    </header>
  )
}
