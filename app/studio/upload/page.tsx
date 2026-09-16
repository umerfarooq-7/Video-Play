import { requireUploader } from '@/lib/auth/guards'
import { getCategories, getModels, getPaysites } from '@/lib/queries'
import { UploadForm } from './UploadForm'

export const metadata = { title: 'Upload a video' }

export default async function UploadPage() {
  await requireUploader('/studio/upload')

  const [categories, paysites, models] = await Promise.all([
    getCategories(),
    getPaysites(),
    getModels(),
  ])

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h2 className="text-lg font-bold">Upload a video</h2>
        <p className="mt-0.5 text-xs leading-relaxed text-muted">
          The file is processed after upload, then reviewed by a moderator
          before it appears publicly.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-surface p-3 text-xs leading-relaxed text-muted">
        <strong className="text-foreground">Promoting a full-length movie?</strong>{' '}
        Choose the movie file, then mark the scenes you want in the promo. Only those
        scenes are cut out and uploaded — the full movie never leaves your computer.
      </div>

      <UploadForm categories={categories} paysites={paysites} models={models} />
    </div>
  )
}
