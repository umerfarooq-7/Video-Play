import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Landing point for every emailed auth link: signup confirmation, magic link
 * and password reset.
 *
 * Supabase sends either a PKCE `code` (newer flow) or a `token_hash` + `type`
 * pair (email OTP links). Handle both, because which one arrives depends on
 * project settings that can be changed in the dashboard without a code change.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl

  const code = searchParams.get('code')
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type')
  const next = safeNext(searchParams.get('next') ?? '/')

  const supabase = await createClient()

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      // The `type` values Supabase sends (signup, recovery, email_change,
      // invite, magiclink) all match this union at runtime.
      type: type as 'signup' | 'recovery' | 'email_change' | 'invite' | 'magiclink',
    })
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  // Expired or already-used links land here. Send them somewhere they can
  // recover from rather than showing a raw error.
  return NextResponse.redirect(
    `${origin}/login?error=${encodeURIComponent(
      'That link is invalid or has expired. Request a new one.',
    )}`,
  )
}

function safeNext(value: string): string {
  if (!value.startsWith('/') || value.startsWith('//')) return '/'
  return value
}
