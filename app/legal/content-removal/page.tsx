export const metadata = { title: 'Content removal' }

export default function ContentRemovalPage() {
  return (
    <div className="space-y-4 text-sm leading-relaxed text-muted">
      <h1 className="text-lg font-bold text-foreground">Content removal</h1>

      <div className="rounded-lg border border-accent/40 bg-accent/10 p-3 text-xs leading-relaxed">
        <strong className="text-foreground">
          If you appear in content published without your consent, or you
          believe content involves a minor, report it immediately.
        </strong>{' '}
        These reports are handled before every other queue. You do not need an
        account to file one.
      </div>

      <Section title="Who can request removal">
        Anyone appearing in a video, anyone acting on their behalf, and anyone
        who believes content depicts a minor or a non-consenting person.
      </Section>

      <Section title="What happens">
        Reports of this kind are prioritised. Content is taken down while it is
        assessed rather than after — the video comes down first and the review
        happens second.
      </Section>

      <Section title="Reporting to authorities">
        Material depicting the sexual abuse of a minor is reported to the
        National Center for Missing &amp; Exploited Children (NCMEC) in the
        United States and the Internet Watch Foundation (IWF) in the United
        Kingdom, and is preserved rather than deleted where the law requires it.
      </Section>

      <Section title="How to file">
        <em className="text-warning">
          To be completed: a monitored reporting address and an in-page form.
          The database already accepts reports without an account
          (reports.reason includes csam, underage and non_consensual) — the
          submission form and the staffed inbox behind it are outstanding.
        </em>
      </Section>

      <div className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-xs leading-relaxed text-danger">
        <strong>Not yet operational.</strong> Automated CSAM detection on
        ingest, and the NCMEC/IWF reporting pipeline, are not built. Public
        uploads must not open until they are. See{' '}
        <code>docs/COMPLIANCE.md</code> section 5.
      </div>
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
