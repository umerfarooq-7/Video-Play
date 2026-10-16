import { requireAdmin } from '@/lib/auth/guards'
import { createClient } from '@/lib/supabase/server'
import type { Ad, AdPlacement } from '@/types/database'
import { NewAdForm, AdRow, AdSettingsForm } from './AdForms'

export const metadata = { title: 'Ads' }

const SECTIONS: { placement: AdPlacement; title: string; blurb: string }[] = [
  {
    placement: 'home_grid',
    title: 'Home page banners',
    blurb:
      'Shown under the category row and above the video listings. Set them to repeat between the videos instead with the option above.',
  },
  {
    placement: 'sidebar',
    title: 'Beside the video',
    blurb:
      'In the "Up next" column on a watch page, level with the player. This is the 300×250 slot ad networks sell for a video page.',
  },
  {
    placement: 'under_player',
    title: 'Under the video',
    blurb: 'A banner directly beneath the player on every watch page.',
  },
  {
    placement: 'preroll',
    title: 'Before the video',
    blurb:
      'A clip that plays when the visitor presses play, before the video itself. They can skip it after the number of seconds you set.',
  },
]

export default async function AdminAdsPage() {
  await requireAdmin('/admin/ads')
  const supabase = await createClient()

  // Staff read every ad, live or not — that is what RLS allows here and what
  // this page is for. The public queries filter separately.
  const [{ data: ads }, { data: settings }] = await Promise.all([
    supabase.from('ads').select('*').order('placement').order('sort_order'),
    supabase
      .from('ad_settings')
      .select('home_grid_interval, home_banner_position')
      .limit(1)
      .maybeSingle(),
  ])

  const rows = (ads ?? []) as Ad[]
  const interval = settings?.home_grid_interval ?? 15
  const position = settings?.home_banner_position === 'interval' ? 'interval' : 'top'

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-lg font-bold">Ads</h2>
        <p className="mt-0.5 text-xs leading-relaxed text-muted">
          Banners and pre-roll clips. Paste the code your ad network gave you,
          or link an image of your own. Nothing shows anywhere until an ad here
          is live.
        </p>
      </div>

      <section>
        <h3 className="mb-2 text-sm font-semibold">Home page banner</h3>
        <AdSettingsForm interval={interval} position={position} />
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold">Add an ad</h3>
        <NewAdForm />
      </section>

      {SECTIONS.map(({ placement, title, blurb }) => {
        const inSlot = rows.filter((ad) => ad.placement === placement)

        return (
          <section key={placement}>
            <h3 className="text-sm font-semibold">
              {title} ({inSlot.length})
            </h3>
            <p className="mb-2 mt-0.5 text-xs leading-relaxed text-muted">{blurb}</p>

            {inSlot.length === 0 ? (
              <p className="rounded-xl border border-border bg-surface p-6 text-center text-sm text-muted">
                None yet.
              </p>
            ) : (
              <ul className="space-y-2">
                {inSlot.map((ad) => (
                  <li key={ad.id}>
                    <AdRow ad={ad} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        )
      })}
    </div>
  )
}
