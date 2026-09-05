import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { EntityAvatar } from '@/components/BrowseResults'

export const metadata = {
  title: 'Models',
  description: 'Browse every performer on the site.',
}

export default async function ModelsPage() {
  const supabase = await createClient()

  // Only performers with published work: an index full of empty names is
  // noise, and each one is a dead-end click.
  const { data: models } = await supabase
    .from('models')
    .select('*')
    .gt('video_count', 0)
    .order('video_count', { ascending: false })
    .limit(500)

  const rows = models ?? []

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-bold">Models</h1>
        <p className="mt-0.5 text-xs text-muted">
          {rows.length} performer{rows.length === 1 ? '' : 's'}
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-muted">
          No models yet. They are added automatically as videos are uploaded.
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
          {rows.map((model) => (
            <Link
              key={model.id}
              href={`/model/${model.slug}`}
              className="group flex flex-col items-center gap-1.5 text-center"
            >
              <EntityAvatar src={model.avatar_url} name={model.name} size="md" />
              <span className="line-clamp-2 text-xs font-medium leading-tight group-hover:text-accent">
                {model.name}
              </span>
              <span className="text-[10px] text-muted">
                {model.video_count} video{model.video_count === 1 ? '' : 's'}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
