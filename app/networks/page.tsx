import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { EntityAvatar } from '@/components/BrowseResults'

export const metadata = {
  title: 'Networks',
  description: 'Browse the studios and networks featured on the site.',
}

export default async function NetworksPage() {
  const supabase = await createClient()

  const { data: paysites } = await supabase
    .from('paysites')
    .select('*')
    .gt('video_count', 0)
    .order('video_count', { ascending: false })
    .limit(500)

  const rows = paysites ?? []

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-bold">Networks</h1>
        <p className="mt-0.5 text-xs text-muted">
          {rows.length} network{rows.length === 1 ? '' : 's'}
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-muted">
          No networks yet. They are added automatically as videos are uploaded.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((paysite) => (
            <Link
              key={paysite.id}
              href={`/paysite/${paysite.domain}`}
              className="group flex items-center gap-3 rounded-xl border border-border bg-surface p-3 hover:border-accent"
            >
              <EntityAvatar src={paysite.logo_url} name={paysite.name} size="sm" />
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold group-hover:text-accent">
                  {paysite.name}
                </span>
                <span className="block truncate text-xs text-muted">
                  {paysite.domain} · {paysite.video_count} video
                  {paysite.video_count === 1 ? '' : 's'}
                </span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
