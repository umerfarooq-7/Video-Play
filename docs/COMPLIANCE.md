# Compliance & risk register

This file records decisions that carry legal or operational risk, who made
them, and what closing each gap involves. Hand it to the client with the code.

It is written by a developer, not a lawyer. Before launch the client should
have a lawyer qualified in each target market review the site. Adult content
distribution into the UK, Germany and the USA is one of the more heavily
regulated things a website can do, and the rules changed materially in
2024–2025.

---

## 1. Age verification — OPEN RISK, accepted by client

**Decision taken:** self-declared "I am 18+" interstitial only
(`app/age-check/page.tsx`), chosen by the client over an integrated
age-assurance provider.

**What this does not satisfy:**

| Market | Requirement | Self-declaration sufficient? |
| --- | --- | --- |
| UK | Online Safety Act 2023 — "highly effective age assurance" for pornographic content, enforced by Ofcom since July 2025 | **No** |
| Germany | JMStV — closed-user-group / verified-age systems (AVS) | **No** |
| USA (TX, LA, UT, VA, AR, MS, MT, NC, ID, IN, KY, AL, GA, FL, SC, TN and others) | State age-verification statutes, commercially reasonable methods | **No** |

**Exposure:** Ofcom can fine up to £18m or 10% of qualifying worldwide revenue
and can seek business-disruption measures (ISP blocking, payment withdrawal).
US state statutes are generally enforced by private right of action or state
AG, with per-violation damages. German enforcement can result in blocking
orders.

**How to close it:** the code is already structured for it. Replace the
`confirm` server action in `app/age-check/page.tsx` with a redirect into a
provider's hosted flow and store only the returned pass/fail token — never the
document or biometric. Candidate vendors: Yoti, VerifyMy, AgeChecked, k-ID.
Typical integration is 1–3 days. `lib/geo.ts` already flags which visitors are
in a mandatory market (`REGION_CONFIG[region].ageWallMandatory`), so the wall
can be made strict per-region rather than globally.

**Recommendation:** close this before serving a single request from GB, DE, or
any listed US state. Geo-blocking those markets entirely is a valid interim
alternative and is cheaper than a provider.

---

## 2. Hosting acceptable-use — OPEN RISK, accepted by client

**Decision taken:** deploy the Next.js app to Vercel, with a separate worker
for transcoding.

**The problem:** Vercel's Acceptable Use Policy restricts adult / sexually
explicit content. Supabase's AUP has comparable restrictions. Neither is a
technical limit — the site will work — but an account can be suspended without
much notice, and a suspension takes the production site down immediately with
no self-service appeal.

**Also relevant:** Cloudflare Stream and Mux both restrict adult content, which
is why the video pipeline (§3) does not depend on either.

**How to close it:** either
(a) get written confirmation from Vercel and Supabase sales that this specific
use case is permitted on the client's account, in advance and in writing; or
(b) deploy to an adult-tolerant host. The app is built host-agnostic — standard
Node output, env-driven config, no Vercel-only APIs — so moving it is a
deployment change, not a rewrite. Hetzner, OVH or a similar VPS running the
Node server behind a CDN works without code changes.

**Note on the database:** Supabase is used only for Postgres, Auth and RLS.
No video bytes are stored there. Migrating Postgres to any other provider is
comparatively easy (the schema is plain SQL in `supabase/migrations/`); the
Auth dependency is the harder part to move.

---

## 3. Video storage & delivery

Media never touches Supabase Storage. The `VideoProvider` interface in
`lib/video/provider.ts` isolates the vendor behind five methods, and the video
row stores a `provider` name plus an opaque `provider_asset_id`.

Drivers: `local` (dev, ffmpeg on disk), `bunny` (Bunny Stream — permits adult
content; partially implemented, token-auth signing still TODO), `s3` (stub).

**Before launch:** implement signed/expiring playback URLs in whichever driver
is chosen. Unsigned HLS manifests can be hotlinked by any other site, which
means paying the bandwidth bill for someone else's traffic.

---

## 4. Record-keeping (18 U.S.C. §2257)

US law requires producers of sexually explicit content to keep age and identity
records for every performer, and to publish a custodian-of-records statement.

**What the code does:** `videos.rights_attested` and `videos.consent_attested`
capture uploader attestations at submit time, and
`uploader_applications.rights_attested` captures it at account level. The
footer links a `/legal/2257` page.

**What the code does not do:** it does not store performer identity documents,
and deliberately so — holding government ID scans creates a serious data-breach
liability and triggers GDPR Article 9 (biometric/special category) obligations.

**Decision needed from the client:** whether they are a "producer" or a
"platform" under §2257, which depends on their business model and is a legal
question. If they are a secondary producer, they must build a records custody
process — that is an operational and legal workstream, not only a code one.

---

## 5. CSAM detection — NOT YET IMPLEMENTED

Any platform accepting user-uploaded adult video must have a detection and
reporting path. This is the single highest-severity risk on the project: it is
criminal rather than civil exposure.

**Required before accepting public uploads:**

- Hash-matching against a known-CSAM database on ingest. Options: PhotoDNA
  (Microsoft, free for qualifying platforms), Thorn Safer, or Cloudflare's CSAM
  Scanning Tool.
- A reporting pipeline to NCMEC (US, legally mandatory under 18 U.S.C. §2258A)
  and IWF (UK).
- Preservation obligations: reported content must be preserved for 90 days, not
  deleted.

**Where it goes:** the ingest worker, before a video ever reaches
`pending_review`. `reports.reason` already includes `csam` and `underage` so the
moderation queue can prioritise, and `audit_log` provides the trail.

**Do not launch public uploads without this.**

---

## 6. DMCA / copyright

`reports` accepts anonymous submissions (no account required — a takedown route
behind a login is not a usable one), with `reason = 'copyright'`.

**Still needed:** register a DMCA agent with the US Copyright Office (~$6,
required for safe-harbour protection), publish the agent's details at
`/legal/dmca`, and define a repeat-infringer termination policy. Safe harbour
is lost without these.

**Note on the brief:** the "import by pasting a download link" feature is, in
practice, how tube sites accumulate infringing content. It is built with an
SSRF guard (§7) but it cannot tell whether the uploader holds rights to what
they are importing. Restricting it to approved uploaders (already enforced) and
keeping the moderation queue staffed is the mitigation.

---

## 7. Application security

Implemented:

- **Row-level security on every table** (`supabase/migrations/0003_rls.sql`),
  deny-by-default. A bug in a page cannot leak an unpublished video.
- **Privilege-escalation guards** as triggers, because RLS cannot pin
  individual columns: users cannot self-assign `role`, `uploader_status` or
  `is_banned`, and uploaders cannot self-publish or edit moderation fields.
- **SSRF protection** on remote-URL import (`lib/video/remote-url.ts`): scheme
  and port allowlists, plus DNS resolution with a private-address check, since
  `http://attacker.com` can resolve to `127.0.0.1` or to the cloud metadata
  endpoint at `169.254.169.254`.
- **Open-redirect protection** on the age wall's `?next=` parameter.
- **View-count integrity**: `viewer_hash` is a salted hash of IP+UA, never the
  address, and `record_video_view()` rate-limits to one count per viewer per
  video per hour.
- **Session handling** via `getUser()` (revalidates the JWT) rather than
  `getSession()` (trusts the cookie).

Still outstanding:

- **DNS rebinding** on remote import. The validated address must be pinned at
  fetch time by the worker, or the worker must run egress-firewalled. The
  hostname can resolve differently between validation and fetch.
- **Rate limiting** on auth, upload and report endpoints.
- **Content Security Policy.** Next 16 documents a nonce-based CSP in
  `app/guides/content-security-policy`.
- **Virus/malware scanning** on uploaded files.

---

## 8. Privacy / GDPR

Serving the UK and Germany means UK GDPR and EU GDPR both apply, and adult
browsing history is special-category data under Article 9 — a higher bar than
ordinary analytics.

Implemented: view records store a salted hash rather than an IP address.

Outstanding: a cookie consent mechanism (the region cookie is arguably
strictly-necessary; anything analytics-related is not), a data subject access
and erasure flow, a data processing agreement with each processor, a retention
policy, and a records-of-processing document.

---

## Summary: blockers before public launch

1. CSAM detection and NCMEC/IWF reporting — **criminal exposure**
2. Age assurance for GB / DE / listed US states, or geo-block them
3. Hosting AUP confirmation in writing, or migration off Vercel/Supabase
4. DMCA agent registration
5. Signed playback URLs
6. Rate limiting and CSP
7. GDPR consent + data subject rights flows
