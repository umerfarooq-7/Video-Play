'use server'

import { headers } from 'next/headers'
import { z } from 'zod'
import { listVideos, type VideoCardData } from '@/lib/queries'
import { COUNTRY_HEADER } from '@/lib/constants'

const SORTS = ['new', 'views', 'rating', 'duration'] as const

const schema = z.object({
  page: z.number().int().min(2).max(500),
  perPage: z.number().int().min(1).max(60),
  sort: z.enum(SORTS),
})

/**
 * The next page of the public grid, for a list that grows as it is scrolled.
 *
 * Page one is rendered on the server with everything else; this only ever
 * serves what comes after it, which is why the page floor is 2.
 *
 * The viewer's country is read from the request here rather than accepted as
 * an argument: it decides which videos are allowed to be seen, and a caller
 * that could name its own country could page past geo-blocking.
 */
export async function loadMoreVideos(input: {
  page: number
  perPage: number
  sort: (typeof SORTS)[number]
}): Promise<{ videos: VideoCardData[]; hasMore: boolean }> {
  const parsed = schema.safeParse(input)
  if (!parsed.success) return { videos: [], hasMore: false }

  const { page, perPage, sort } = parsed.data
  const headerList = await headers()
  const country = headerList.get(COUNTRY_HEADER) || null

  const { videos, total } = await listVideos({ page, perPage, sort, country })

  return { videos, hasMore: page * perPage < total }
}
