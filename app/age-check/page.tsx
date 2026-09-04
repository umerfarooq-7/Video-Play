import { redirect } from 'next/navigation'
import { cookies, headers } from 'next/headers'
import Link from 'next/link'
import { AGE_COOKIE, AGE_COOKIE_MAX_AGE, REGION_HEADER } from '@/lib/constants'
import { REGION_CONFIG, isRegion } from '@/lib/geo'

export const metadata = {
  title: 'Age verification',
  robots: { index: false, follow: false },
}

/**
 * Self-declared 18+ interstitial.
 *
 * IMPORTANT: a self-declaration is not "highly effective age assurance" under
 * the UK Online Safety Act, the German JMStV, or the age-verification statutes
 * in Texas, Louisiana, Utah, Virginia and others. This satisfies none of them.
 * The client accepted that exposure knowingly; docs/COMPLIANCE.md records the
 * decision and what swapping in a real provider involves.
 *
 * The seam is already here: replace the confirm action below with a redirect
 * into a provider's flow and this page needs no other change.
 */
export default async function AgeCheckPage({ searchParams }: PageProps<'/age-check'>) {
  const params = await searchParams
  const nextParam = typeof params.next === 'string' ? params.next : '/'

  const cookieStore = await cookies()
  if (cookieStore.get(AGE_COOKIE)?.value === '1') {
    redirect(safeNext(nextParam))
  }

  const headerList = await headers()
  const regionHeader = headerList.get(REGION_HEADER)
  const region = isRegion(regionHeader) ? regionHeader : 'INT'
  const regionConfig = REGION_CONFIG[region]

  async function confirm(formData: FormData) {
    'use server'

    const destination = safeNext(String(formData.get('next') ?? '/'))
    const store = await cookies()

    store.set(AGE_COOKIE, '1', {
      path: '/',
      maxAge: AGE_COOKIE_MAX_AGE,
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    })

    redirect(destination)
  }

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-lg flex-col justify-center">
      <div className="rounded-xl border border-border bg-surface p-6 sm:p-8">
        <h1 className="text-xl font-bold">This site contains adult content</h1>

        <p className="mt-3 text-sm leading-relaxed text-muted">
          You must be at least 18 years old — or the age of majority where you
          live, whichever is higher — to continue. By entering you confirm that
          you are of legal age and that adult material is lawful to view in your
          location.
        </p>

        {regionConfig.ageWallMandatory && (
          <p className="mt-3 rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs leading-relaxed text-warning">
            Age verification is legally required in {regionConfig.label}.
          </p>
        )}

        <form action={confirm} className="mt-6 space-y-2.5">
          <input type="hidden" name="next" value={nextParam} />
          <button
            type="submit"
            className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-contrast hover:bg-accent-hover"
          >
            I am 18 or older — enter
          </button>
          <a
            href="https://www.google.com"
            className="block w-full rounded-lg border border-border px-4 py-2.5 text-center text-sm font-medium text-muted hover:bg-surface-raised"
          >
            I am under 18 — leave
          </a>
        </form>

        <p className="mt-5 text-xs leading-relaxed text-muted">
          Parents: you can restrict access to adult material using tools such as{' '}
          <span className="text-foreground">Net Nanny</span>,{' '}
          <span className="text-foreground">CyberPatrol</span> or your operating
          system&apos;s parental controls. This site is labelled{' '}
          <abbr title="Restricted To Adults">RTA</abbr> so filters can detect it.
        </p>

        <p className="mt-3 text-xs text-muted">
          <Link href="/legal/terms" className="hover:text-accent">
            Terms
          </Link>
          {' · '}
          <Link href="/legal/privacy" className="hover:text-accent">
            Privacy
          </Link>
        </p>
      </div>
    </div>
  )
}

/**
 * Only ever redirect to a path on this site. Without this an attacker can
 * craft /age-check?next=https://evil.example and use our domain as the
 * launching point for a phishing redirect.
 */
function safeNext(value: string): string {
  if (!value.startsWith('/') || value.startsWith('//')) return '/'
  return value
}
