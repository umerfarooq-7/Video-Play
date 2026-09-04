import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { detectCountry, isRegion, toRegion } from '@/lib/geo'
import {
  AGE_COOKIE,
  COUNTRY_HEADER,
  REGION_COOKIE,
  REGION_HEADER,
} from '@/lib/constants'

/**
 * Next 16 renamed Middleware to Proxy. Same execution model: runs before every
 * matched request.
 *
 * Three jobs, in order:
 *   1. Refresh the Supabase session so server components see a live JWT.
 *   2. Resolve the visitor's region and pin it to a cookie + request header.
 *   3. Enforce the age wall before any content route renders.
 *
 * Deliberately does no database work beyond the token refresh — proxy runs on
 * every request including asset-adjacent ones, so anything slow here is paid
 * site-wide.
 */




/** Routes reachable without acknowledging the age wall. */
const AGE_EXEMPT_PREFIXES = [
  '/age-check',
  '/legal',
  '/api/health',
  '/api/worker',
  // Provider callbacks. Bunny posts here as a server, with no cookies — the
  // age wall would bounce it to /age-check and the encode would never be
  // recorded.
  '/api/webhooks',
  // Media and upload endpoints are called by an already-authenticated client;
  // redirecting them to an interstitial breaks the transfer.
  '/api/upload',
  '/media',
  '/_next',
  '/favicon',
  '/robots.txt',
  '/sitemap.xml',
]

function isAgeExempt(pathname: string): boolean {
  return AGE_EXEMPT_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })

  // --- 1. Session refresh -------------------------------------------------
  // setAll must write to BOTH the request (so this same pass sees the new
  // token) and the response (so the browser stores it). The second `headers`
  // argument carries no-store directives; without them a CDN can cache one
  // visitor's Set-Cookie and serve their session to somebody else.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet, headers) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value)
          }
          response = NextResponse.next({ request })
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options)
          }
          for (const [key, value] of Object.entries(headers ?? {})) {
            response.headers.set(key, value)
          }
        },
      },
    },
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  // --- 2. Region ----------------------------------------------------------
  // A visitor's explicit choice always beats geo-IP; only fall back to the
  // edge headers when they have not picked one.
  const existing = request.cookies.get(REGION_COOKIE)?.value
  const region = isRegion(existing)
    ? existing
    : toRegion(detectCountry(request.headers))

  const detectedCountry = detectCountry(request.headers) ?? ''

  response.headers.set(REGION_HEADER, region)
  response.headers.set(COUNTRY_HEADER, detectedCountry)

  if (existing !== region) {
    response.cookies.set(REGION_COOKIE, region, {
      path: '/',
      maxAge: 60 * 60 * 24 * 180,
      sameSite: 'lax',
    })
  }

  // --- 3. Age wall --------------------------------------------------------
  const { pathname } = request.nextUrl
  const acknowledged = request.cookies.get(AGE_COOKIE)?.value === '1'

  if (!acknowledged && !isAgeExempt(pathname)) {
    const url = request.nextUrl.clone()
    url.pathname = '/age-check'
    // Preserve where they were heading so the wall can bounce them back.
    url.search = `?next=${encodeURIComponent(pathname + request.nextUrl.search)}`

    const redirect = NextResponse.redirect(url)
    // Carry over any refreshed auth cookies, or the redirect drops the session.
    for (const cookie of response.cookies.getAll()) {
      redirect.cookies.set(cookie)
    }
    return redirect
  }

  // Signed-in but banned users get pushed out of everything but the notice.
  if (user && pathname.startsWith('/studio')) {
    response.headers.set('x-has-session', '1')
  }

  return response
}

export const config = {
  matcher: [
    /*
     * Everything except Next internals and static assets. Keeping images and
     * fonts out of the matcher matters: the session refresh above is an async
     * call, and paying it per asset would be a real latency tax.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|woff2?|mp4|m3u8|ts)$).*)',
  ],
}
