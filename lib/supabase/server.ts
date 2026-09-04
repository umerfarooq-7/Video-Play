import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import type { Database } from '@/types/database'
import { env } from '@/lib/env'

/**
 * Request-scoped Supabase client for Server Components, Server Actions and
 * Route Handlers. Runs as the calling user, so every query is still subject to
 * row-level security.
 *
 * Create a new one per render — never hoist this into a module-level constant,
 * or one request's session leaks into another's.
 */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options)
            }
          } catch {
            // Server Components cannot write cookies. That is fine: proxy.ts
            // refreshes the session on every request, so the write here is
            // only ever a redundant top-up.
          }
        },
      },
    },
  )
}

/**
 * The signed-in user, or null. Uses `getUser()` rather than `getSession()`
 * because only `getUser()` revalidates the JWT against the auth server —
 * `getSession()` trusts the cookie, which the client can forge.
 */
export async function getCurrentUser() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user
}

/** The signed-in user's profile row, or null when logged out. */
export async function getCurrentProfile() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  return data
}
