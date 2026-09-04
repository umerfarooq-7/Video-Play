import { redirect } from 'next/navigation'
import { requireProfile } from '@/lib/auth/guards'
import { createClient } from '@/lib/supabase/server'
import { ApplyForm } from './ApplyForm'

export const metadata = { title: 'Apply for upload access' }

export default async function ApplyPage() {
  const profile = await requireProfile('/studio/apply')

  if (profile.uploader_status === 'approved') {
    redirect('/studio')
  }

  const supabase = await createClient()
  const { data: latest } = await supabase
    .from('uploader_applications')
    .select('status, review_note, created_at, reviewed_at')
    .eq('user_id', profile.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const pending = latest?.status === 'pending'

  return (
    <div className="max-w-xl space-y-4">
      <div>
        <h2 className="text-lg font-bold">Apply for upload access</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          Uploading is approval-only. We review every applicant to keep
          unlicensed and non-consensual material off the platform.
        </p>
      </div>

      {latest?.status === 'rejected' && latest.review_note && (
        <div className="rounded-xl border border-danger/30 bg-danger/10 p-4">
          <h3 className="text-xs font-semibold text-danger">
            Your last application was not approved
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            {latest.review_note}
          </p>
        </div>
      )}

      {pending ? (
        <div className="rounded-xl border border-warning/30 bg-warning/10 p-4">
          <h3 className="text-sm font-semibold text-warning">
            Application received
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            A moderator is reviewing it. You will see the outcome on this page.
          </p>
        </div>
      ) : (
        <ApplyForm />
      )}
    </div>
  )
}
