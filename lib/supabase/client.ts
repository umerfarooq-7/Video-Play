'use client'

import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/types/database'

/**
 * Browser-side Supabase client, for interactive auth flows and realtime
 * subscriptions (upload progress, moderation queue updates).
 *
 * This deliberately reads process.env directly rather than importing lib/env,
 * to keep the validation schema out of the client bundle. Both values are
 * public by design — the anon key is safe to ship because RLS is what actually
 * protects the data.
 */
let browserClient: ReturnType<typeof createBrowserClient<Database>> | undefined

export function createClient() {
  if (!browserClient) {
    browserClient = createBrowserClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    )
  }
  return browserClient
}
