import { requireUploader } from '@/lib/auth/guards'
import { getCategories, getModels, getPaysites } from '@/lib/queries'
import { ImportForm } from './ImportForm'

export const metadata = { title: 'Import from a link' }

export default async function ImportPage() {
  await requireUploader('/studio/import')

  const [categories, paysites, models] = await Promise.all([
    getCategories(),
    getPaysites(),
    getModels(),
  ])

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h2 className="text-lg font-bold">Import from a link</h2>
        <p className="mt-0.5 text-xs leading-relaxed text-muted">
          Paste a direct link to a video file and we will fetch it for you.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-surface p-3 text-xs leading-relaxed text-muted">
        <strong className="text-foreground">Importing a full-length movie?</strong>{' '}
        Tick <span className="text-foreground">&ldquo;full-length source&rdquo;</span> at
        the bottom, then use the{' '}
        <a href="/studio/clips" className="text-accent hover:underline">
          clip tool
        </a>{' '}
        to cut a 5–7 minute promo from it. Only the promo gets published — the
        full movie stays private as a source.
      </div>

      <div className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-xs leading-relaxed text-warning">
        Import only material you hold the rights to. Links are fetched by our
        servers and every import is logged against your account and reviewed by
        a moderator before publication.
      </div>

      <ImportForm categories={categories} paysites={paysites} models={models} />
    </div>
  )
}
