import Link from 'next/link'

export const metadata = { title: 'DMCA / copyright' }

export default function DmcaPage() {
  return (
    <div className="space-y-4 text-sm leading-relaxed text-muted">
      <h1 className="text-lg font-bold text-foreground">
        Copyright and takedown
      </h1>

      <p>
        If you own the rights to material published here without your
        permission, tell us and we will act on it.
      </p>

      <div className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-xs text-danger">
        <strong>Registration outstanding.</strong> Safe-harbour protection under
        the DMCA requires a designated agent registered with the US Copyright
        Office. Until that registration exists and the agent&apos;s details
        appear below, this site does not have safe harbour.
      </div>

      <Section title="How to file a notice">
        Send a notice including: identification of the work, the URL of the
        material on this site, your contact details, a statement that you
        believe in good faith the use is unauthorised, a statement that the
        information is accurate and that you are authorised to act for the owner,
        and your signature.
      </Section>

      <Section title="Designated agent">
        <em className="text-warning">
          To be completed: agent name, postal address, telephone and email, as
          registered with the US Copyright Office.
        </em>
      </Section>

      <Section title="Counter-notice">
        If your content was removed and you believe that was a mistake, you may
        file a counter-notice. It must identify the material, state under
        penalty of perjury that you believe it was removed in error, and consent
        to jurisdiction.
      </Section>

      <Section title="Repeat infringers">
        Accounts that repeatedly infringe are terminated.
      </Section>

      <p className="pt-2">
        For anything urgent — material depicting a minor, or anyone appearing
        without consent — use{' '}
        <Link href="/legal/content-removal" className="text-accent hover:underline">
          content removal
        </Link>
        , which is prioritised above copyright claims.
      </p>
    </div>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section>
      <h2 className="mt-4 text-sm font-semibold text-foreground">{title}</h2>
      <p className="mt-1">{children}</p>
    </section>
  )
}
