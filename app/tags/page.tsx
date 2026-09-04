import Link from 'next/link'
import { getPopularTags } from '@/lib/queries'

export const metadata = {
  title: 'Tags',
  description: 'Browse videos by tag.',
}

export default async function TagsPage() {
  const tags = await getPopularTags(200)

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-bold">Tags</h1>
        <p className="mt-0.5 text-xs text-muted">
          {tags.length} tag{tags.length === 1 ? '' : 's'}, most used first.
        </p>
      </div>

      {tags.length === 0 ? (
        <p className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-muted">
          No tags yet.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <Link
              key={tag.id}
              href={`/search?q=${encodeURIComponent(tag.name)}`}
              className="rounded-full border border-border bg-surface px-3.5 py-1.5 text-xs font-medium text-muted transition-colors hover:border-accent hover:text-accent"
            >
              {tag.name}
              {tag.usage_count > 0 && (
                <span className="ml-1.5 text-[10px] text-muted">
                  {tag.usage_count}
                </span>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
