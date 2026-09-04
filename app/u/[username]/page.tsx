import { notFound } from 'next/navigation'
import Link from 'next/link'
import { headers } from 'next/headers'
import { CalendarDays, Video as VideoIcon, Eye, BadgeCheck } from 'lucide-react'
import { createClient, getCurrentUser } from '@/lib/supabase/server'
import { listVideos } from '@/lib/queries'
import { VideoGrid } from '@/components/VideoCard'
import { formatCount } from '@/lib/format'
import { COUNTRY_HEADER } from '@/lib/constants'
import { logOut } from '@/lib/auth/actions'
import { SubmitButton } from '@/components/form'

export async function generateMetadata({ params }: PageProps<'/u/[username]'>) {
  const { username } = await params
  return {
    title: `${username}`,
    description: `Videos published by ${username}.`,
  }
}

export default async function ProfilePage({ params }: PageProps<'/u/[username]'>) {
  const { username } = await params

  const supabase = await createClient()

  // citext column, so this match is already case-insensitive.
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, username, display_name, bio, avatar_url, role, uploader_status, created_at')
    .eq('username', username)
    .maybeSingle()

  if (!profile) notFound()

  const [user, headerList] = await Promise.all([getCurrentUser(), headers()])
  const isOwnProfile = user?.id === profile.id
  const country = headerList.get(COUNTRY_HEADER) || null

  // Only published videos are returned — RLS would hide the rest from a
  // visitor anyway, and the owner has the studio for works in progress.
  const { videos, total } = await listVideos({
    ownerId: profile.id,
    perPage: 24,
    country,
    sort: 'new',
  })

  const totalViews = videos.reduce((sum, v) => sum + v.viewCount, 0)
  const isApprovedUploader = profile.uploader_status === 'approved'
  const joined = new Date(profile.created_at).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
  })

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5 sm:flex-row sm:items-start">
        <div className="grid size-16 shrink-0 place-items-center rounded-full bg-surface-raised text-xl font-bold uppercase">
          {(profile.display_name ?? profile.username).charAt(0)}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-bold">
              {profile.display_name ?? profile.username}
            </h1>
            {isApprovedUploader && (
              <span
                title="Approved uploader"
                className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold text-accent"
              >
                <BadgeCheck size={11} aria-hidden />
                Verified uploader
              </span>
            )}
          </div>

          <p className="text-xs text-muted">@{profile.username}</p>

          {profile.bio && (
            <p className="mt-2 max-w-prose whitespace-pre-wrap text-xs leading-relaxed text-muted">
              {profile.bio}
            </p>
          )}

          <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
            <div className="flex items-center gap-1.5">
              <VideoIcon size={13} aria-hidden />
              <dt className="sr-only">Videos</dt>
              <dd>{total} video{total === 1 ? '' : 's'}</dd>
            </div>
            <div className="flex items-center gap-1.5">
              <Eye size={13} aria-hidden />
              <dt className="sr-only">Views</dt>
              <dd>{formatCount(totalViews)} views</dd>
            </div>
            <div className="flex items-center gap-1.5">
              <CalendarDays size={13} aria-hidden />
              <dt className="sr-only">Joined</dt>
              <dd>Joined {joined}</dd>
            </div>
          </dl>

          {isOwnProfile && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Link
                href="/studio"
                className="rounded-lg bg-accent px-3.5 py-2 text-xs font-semibold text-accent-contrast hover:bg-accent-hover"
              >
                Creator studio
              </Link>
              <Link
                href="/account"
                className="rounded-lg border border-border px-3.5 py-2 text-xs font-medium text-muted hover:bg-surface-raised"
              >
                Edit profile
              </Link>
              {/* Sign-out must be a POST, never a GET link: a link can be
                  triggered by a prefetch or an <img> on another site. */}
              <form action={logOut}>
                <SubmitButton variant="secondary" pendingLabel="Signing out…">
                  Log out
                </SubmitButton>
              </form>
            </div>
          )}
        </div>
      </header>

      <section>
        <h2 className="mb-3 text-sm font-semibold">
          {isOwnProfile ? 'Your published videos' : 'Videos'}
        </h2>
        <VideoGrid
          videos={videos}
          emptyMessage={
            isOwnProfile
              ? 'You have no published videos yet. Anything you upload appears here once a moderator approves it.'
              : 'This user has not published any videos yet.'
          }
        />
      </section>
    </div>
  )
}
