import { notFound } from 'next/navigation'
import { requireUploader } from '@/lib/auth/guards'
import { getCategories, getModels, getPaysites } from '@/lib/queries'
import { loadVideoForEdit } from '@/lib/studio/video-edit'
import { VideoEditForm } from '@/components/studio/VideoEditForm'

export const metadata = { title: 'Edit video' }

export default async function StudioVideoEditPage({
  params,
}: PageProps<'/studio/videos/[id]/edit'>) {
  const profile = await requireUploader('/studio/videos')
  const { id } = await params

  const video = await loadVideoForEdit(id)

  // Staff reach other people's videos through the admin area; here, seeing
  // someone else's row at all would be a leak.
  if (!video || video.ownerId !== profile.id) notFound()

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
          Changing the title does not change the video&rsquo;s web address, so
          existing links keep working. The video file, its cover and its promo
          are not affected.
        </p>
      </div>

      <VideoEditForm
        videoId={video.id}
        backHref="/studio/videos"
        categories={categories}
        paysites={paysites}
        models={models}
        initial={video.initial}
      />
    </div>
  )
}
