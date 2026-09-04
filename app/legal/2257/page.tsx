export const metadata = { title: '18 U.S.C. 2257 statement' }

export default function RecordsPage() {
  return (
    <div className="space-y-4 text-sm leading-relaxed text-muted">
      <h1 className="text-lg font-bold text-foreground">
        18 U.S.C. &sect; 2257 record-keeping statement
      </h1>

      <p>
        All performers appearing in content on this site were at least 18 years
        old at the time of production.
      </p>

      <Section title="Platform role">
        This site hosts material uploaded by approved third-party contributors.
        Every uploader must attest, at account level and again for each
        submission, that they hold distribution rights and that all performers
        were of legal age and consented to distribution.
      </Section>

      <Section title="Custodian of records">
        <em className="text-warning">
          To be completed: the custodian&apos;s name and the physical address
          where records are maintained. This must be a real, monitored address.
        </em>
      </Section>

      <Section title="Open question for counsel">
        <em className="text-warning">
          Whether the operator is a primary producer, a secondary producer, or
          solely a hosting platform under &sect; 2257 and 28 C.F.R. Part 75
          determines what records must be held and by whom. That classification
          depends on the business model and is a legal determination, not a
          technical one. It must be settled before public uploads open, because
          it decides whether an identity-document custody process is required.
        </em>
      </Section>

      <Section title="Reporting">
        To report content you believe involves a minor or a non-consenting
        person, use the content removal route. Such reports are prioritised
        above all other queues.
      </Section>
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
