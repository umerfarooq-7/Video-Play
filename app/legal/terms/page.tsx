export const metadata = { title: 'Terms of service' }

export default function TermsPage() {
  return (
    <div className="space-y-4 text-sm leading-relaxed text-muted">
      <h1 className="text-lg font-bold text-foreground">Terms of service</h1>

      <p>
        These terms govern use of this site. By creating an account or viewing
        content you agree to them.
      </p>

      <Section title="1. Eligibility">
        You must be at least 18 years old, or the age of majority where you
        live, whichever is higher. Accounts found to belong to minors are
        terminated without notice.
      </Section>

      <Section title="2. Accounts">
        You are responsible for activity under your account and for keeping your
        credentials secure. One person per account.
      </Section>

      <Section title="3. Uploading">
        Uploading requires approval. By uploading you warrant that you hold all
        distribution rights, that every performer was at least 18 at the time of
        production, and that every performer gave informed consent to
        distribution. You agree to provide records substantiating this on
        request.
      </Section>

      <Section title="4. Prohibited content">
        Content depicting minors, non-consenting people, or unlawful acts is
        forbidden. So is content you do not hold the rights to. Violations are
        removed, accounts terminated, and unlawful material reported to the
        relevant authorities.
      </Section>

      <Section title="5. Moderation">
        Submissions are reviewed before publication. We may refuse, remove or
        restrict any content at our discretion, including after publication.
      </Section>

      <Section title="6. Termination">
        We may suspend or terminate access for breach of these terms. Repeat
        copyright infringers are terminated.
      </Section>

      <Section title="7. Liability and governing law">
        <em className="text-warning">
          To be completed by counsel: limitation of liability, warranty
          disclaimers, indemnity, governing law and jurisdiction, and the
          consumer rights that cannot be excluded in the UK, EU/Germany and the
          relevant US states.
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
