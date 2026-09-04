import 'server-only'

import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { env } from '@/lib/env'

/**
 * Service-role client. **Bypasses row-level security entirely.**
 *
 * Only for work that legitimately has no user context:
 *   - the transcode worker writing back renditions and durations
 *   - queueing ingest_jobs after a server action has already authorised
 *   - admin operations that must read across all users
 *
 * The `server-only` import above turns any accidental import from a client
 * component into a build error rather than a leaked key.
 *
 * Every caller must do its own authorisation check first. There is no RLS
 * safety net behind this client.
 */
export function createAdminClient() {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not set. It is required for the ingest ' +
        'pipeline and admin operations.',
    )
  }

  return createSupabaseClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  )
}
