import { requireAdmin } from '@/lib/auth/guards'
import { createClient } from '@/lib/supabase/server'
import { NewModelForm, ModelRow } from './ModelForms'

export const metadata = { title: 'Models' }

export default async function AdminModelsPage() {
  await requireAdmin('/admin/models')
  const supabase = await createClient()

  // Unreviewed first: those were created automatically when an uploader typed
  // a new name, so they have no photo yet and look bare on the home page.
  const { data: models } = await supabase
    .from('models')
    .select('*')
    .order('is_approved')
    .order('video_count', { ascending: false })

  const rows = models ?? []
  const unreviewed = rows.filter((m) => !m.is_approved).length

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <h2 className="text-lg font-bold">Models</h2>
        <p className="mt-0.5 text-xs leading-relaxed text-muted">
          These appear on the home page and in the upload form&apos;s
          suggestions. Visitors can click one to see only their videos.
        </p>
      </div>

      {unreviewed > 0 && (
        <p className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs leading-relaxed text-warning">
          {unreviewed} model{unreviewed === 1 ? ' was' : 's were'} created
          automatically when an uploader typed a new name. Add a photo so they
          display properly on the home page.
        </p>
      )}

      <section>
        <h3 className="mb-2 text-sm font-semibold">Add a model</h3>
        <NewModelForm />
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold">Existing ({rows.length})</h3>
        {rows.length === 0 ? (
          <p className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-muted">
            None yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {rows.map((model) => (
              <li key={model.id}>
                <ModelRow model={model} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
