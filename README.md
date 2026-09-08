# X PORN HOUSE — video platform

Next.js 16 (App Router) + Supabase (Postgres, Auth, RLS). Adult video tube
site with uploader approval, moderation, clip cutting, remote-URL import and a
VR/360 player.

> Read [`docs/COMPLIANCE.md`](docs/COMPLIANCE.md) before deploying. It lists
> the legal and infrastructure risks on this project, including two the client
> has knowingly accepted, and the blockers that must close before public launch.

---

## Setup

### 1. Supabase

Create a project at [supabase.com](https://supabase.com), then run the
migrations in order from the SQL Editor:

```
supabase/migrations/0001_init.sql
supabase/migrations/0002_pipeline_and_moderation.sql
supabase/migrations/0003_rls.sql
supabase/migrations/0004_seed.sql
```

Or with the CLI:

```bash
npx supabase db push
```

### 2. Environment

```bash
cp .env.example .env.local
```

Fill in the Supabase URL, anon key and service-role key from
**Project Settings → API**. Generate the secrets with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

`.env.local` currently holds non-functional placeholders so the build runs —
replace them before starting the app.

### 3. First admin

Supabase cannot safely create an auth user from SQL, so sign up through the app
first, then promote that account:

```sql
update profiles set role = 'admin', uploader_status = 'approved'
where id = (select id from auth.users where email = 'you@example.com');
```

### 4. Run

```bash
npm run dev
```

---

## Architecture

| Concern | Location | Notes |
| --- | --- | --- |
| Schema + RLS | `supabase/migrations/` | Deny-by-default; privilege guards are triggers, since RLS cannot pin columns |
| Session / geo / age wall | `proxy.ts` | Next 16 renamed Middleware to Proxy |
| Supabase clients | `lib/supabase/` | `server` (RLS as caller), `client` (browser), `admin` (service role, bypasses RLS) |
| Storage / CDN | `lib/video/provider.ts` | Swappable driver; video bytes never touch Supabase Storage |
| Remote import guard | `lib/video/remote-url.ts` | SSRF defence for "paste a download link" |
| Region policy | `lib/geo.ts` | UK / USA / Germany + international fallback |
| Read queries | `lib/queries.ts` | Geo filtering happens in SQL, not after paging |

### Roles

`viewer` → `uploader` (admin-approved) → `moderator` → `admin`.

A user applies via `uploader_applications`; an admin approves, which sets
`profiles.uploader_status = 'approved'`. Only then does RLS permit inserting
into `videos`. Uploaders cannot self-publish — new rows are forced to `draft`,
and only a moderator can move a video to `published`.

### Video lifecycle

```
draft → uploading → processing → pending_review → published
                                       ↓              ↓
                                   rejected        removed
```

Three ingest paths feed the same `ingest_jobs` queue: direct upload, remote
URL, and clip cut. Workers claim jobs with `claim_ingest_job()`, which uses
`FOR UPDATE SKIP LOCKED` so several workers can run without duplicating work.
`reclaim_stalled_ingest_jobs()` returns jobs from dead workers.

---

## Status

### Built

- Full schema: profiles, roles, uploader applications, videos, categories,
  tags, renditions, ingest jobs, clips, votes, favourites, views, reports,
  audit log
- Row-level security across every table, with privilege-escalation guards
- Full-text search (`tsvector` + trigram) spanning title, tags, categories,
  description
- Geo-availability model (allow/block lists per video) and UK/US/DE regions
- Session refresh, region detection and age wall in `proxy.ts`
- Video provider abstraction with local / Bunny / S3 drivers
- SSRF-guarded remote URL validation
- App shell: header with search + category rail, mobile drawer, footer with
  legal routes, responsive video grid, home page, age wall

- Auth: signup, login, password reset, email-confirmation callback
- Uploader application flow + admin approval queue (grants the privilege)
- Admin/moderation shell: overview counters, video moderation queue with
  publish / reject / take-down, all writing to the audit log
- Creator studio shell with approval-aware navigation

Verified end to end against a live Supabase project: migrations applied, seed
data present, age wall → home page renders, region detection working.

- Watch page with HLS player (hls.js, native HLS on Safari) and a three.js
  VR/360/180 player, plus voting, favourites and anonymous reporting
- Direct upload (browser → provider, with progress), URL import behind the SSRF
  guard, and the clip/promo cutting tool
- Studio: video list with live processing state, account settings
- Admin: reports queue (safety reports prioritised) and category management
- Transcode worker (`npm run worker`): HLS ladder, thumbnails, sprite sheets

33 routes. The build is clean (`npm run build`) and typechecks
(`npm run typecheck`).

### The transcode worker

```bash
npm run worker
```

Requires **ffmpeg and ffprobe on PATH** — it refuses to start without them:

```
winget install Gyan.FFmpeg     # Windows
brew install ffmpeg            # macOS
sudo apt install ffmpeg        # Ubuntu
```

Claims jobs with `claim_ingest_job()` (`FOR UPDATE SKIP LOCKED`), so you can
run several in parallel. It builds a 360p–1080p HLS ladder, never upscaling
past the source, then moves the video to `pending_review` — never straight to
`published`, because approval is a human decision the worker must not be able
to make.

### Not yet built

- CSAM detection on ingest and the NCMEC/IWF pipeline — **launch blocker**,
  see `docs/COMPLIANCE.md` §5
- Signed/expiring playback URLs (currently unsigned, so streams can be
  hotlinked)
- Rate limiting, Content Security Policy
- `sitemap.xml`, `robots.txt`, JSON-LD
- Real legal copy (the pages are developer scaffolding, clearly marked)
- Tests, Docker/deployment config

---

## Commands

```bash
npm run dev      # dev server
npm run build    # production build
npm run lint     # eslint
npx tsc --noEmit # typecheck
```
