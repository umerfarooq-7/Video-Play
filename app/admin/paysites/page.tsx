import { requireAdmin } from '@/lib/auth/guards'
import { createClient } from '@/lib/supabase/server'
import { NewPaysiteForm, PaysiteRow } from './PaysiteForms'

export const metadata = { title: 'Networks' }

export default async function AdminPaysitesPage() {
  await requireAdmin('/admin/paysites')
  const supabase = await createClient()

  // Unreviewed ones first: those were created automatically by an uploader
  // typing a new domain, and are the ones that need a name and logo.
  const { data: paysites } = await supabase
    .from('paysites')
    .select('*')
    .order('is_approved')
    .order('video_count', { ascending: false })

  const rows = paysites ?? []
  const unreviewed = rows.filter((p) => !p.is_approved).length

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <h2 className="text-lg font-bold">Networks &amp; paysites</h2>
        <p className="mt-0.5 text-xs leading-relaxed text-muted">
          These appear on the home page and in the upload form&apos;s
          suggestions. Visitors can click one to see only its videos.
        </p>
      </div>

      {unreviewed > 0 && (
        <p className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs leading-relaxed text-warning">
          {unreviewed} network{unreviewed === 1 ? ' was' : 's were'} created
          automatically when an uploader typed a new domain. Give them a proper
          name and logo so they look right on the home page.
        </p>
      )}

      <section>
        <h3 className="mb-2 text-sm font-semibold">Add a network</h3>
        <NewPaysiteForm />
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold">Existing ({rows.length})</h3>
        {rows.length === 0 ? (
          <p className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-muted">
            None yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {rows.map((paysite) => (
              <li key={paysite.id}>
                <PaysiteRow paysite={paysite} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
