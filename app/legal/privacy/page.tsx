export const metadata = { title: 'Privacy policy' }

export default function PrivacyPage() {
  return (
    <div className="space-y-4 text-sm leading-relaxed text-muted">
      <h1 className="text-lg font-bold text-foreground">Privacy policy</h1>

      <p>
        This explains what we collect and why. Adult browsing history is
        special-category data under UK and EU GDPR, so it is held to a higher
        standard than ordinary analytics.
      </p>

      <Section title="What we collect">
        Account data (email, username, and anything you add to your profile).
        Uploaded content and its metadata. View records, which store a{' '}
        <strong className="text-foreground">salted hash</strong> of IP address
        and browser string rather than the address itself, plus a country code.
        Moderation decisions and their reasons.
      </Section>

      <Section title="What we do not do">
        We do not store your IP address against your viewing history, and we do
        not sell personal data.
      </Section>

      <Section title="Cookies">
        A session cookie keeps you signed in. A region cookie remembers your
        country selection. An age-acknowledgement cookie records that you passed
        the age gate. These are necessary for the site to function.
      </Section>

      <Section title="Your rights">
        Under UK/EU GDPR you may request access to, correction of, or erasure of
        your personal data, and object to processing.{' '}
        <em className="text-warning">
          To be completed by counsel: the contact route and response process for
          these requests, plus the lawful basis relied on for each purpose, the
          retention schedule, international transfer mechanism, and the
          supervisory authority for complaints.
        </em>
      </Section>

      <Section title="Data controller">
        <em className="text-warning">
          To be completed: the operating entity&apos;s legal name, registered
          address and contact address, plus a Data Protection Officer or EU/UK
          representative where required.
        </em>
      </Section>

      <p className="pt-2 text-xs">Last updated: not yet published.</p>
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
