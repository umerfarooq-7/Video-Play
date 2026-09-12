import { notFound } from 'next/navigation'
import Link from 'next/link'
import { requireStaff } from '@/lib/auth/guards'
import { getCategories, getModels, getPaysites } from '@/lib/queries'
import { loadVideoForEdit } from '@/lib/studio/video-edit'
import { VideoEditForm } from '@/components/studio/VideoEditForm'

export const metadata = { title: 'Edit video' }

export default async function AdminVideoEditPage({
  params,
}: PageProps<'/admin/videos/[id]/edit'>) {
  await requireStaff('/admin/videos')
  const { id } = await params

  const video = await loadVideoForEdit(id)
  if (!video) notFound()

  const [categories, paysites, models] = await Promise.all([
    getCategories(),
    getPaysites(),
    getModels(),
  ])

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h2 className="text-lg font-bold">Edit details</h2>
        <p className="mt-0.5 text-xs leading-relaxed text-muted">
          Editing does not change the video&rsquo;s status or its web address.
          To publish, reject or take it down, use{' '}
          <Link href="/admin/moderation" className="text-accent hover:underline">
            moderation
          </Link>
          .
        </p>
      </div>

      <VideoEditForm
        videoId={video.id}
        backHref="/admin/videos"
        categories={categories}
        paysites={paysites}
        models={models}
        initial={video.initial}
      />
    </div>
  )
}
