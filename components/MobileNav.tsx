'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Menu, X } from 'lucide-react'
import type { Category } from '@/types/database'

/**
 * Slide-out category drawer for narrow viewports. The desktop rail in
 * SiteHeader stays server-rendered; only this needs client state.
 */
export function MobileNav({ categories }: { categories: Category[] }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        aria-expanded={open}
        className="rounded-md p-1.5 text-muted hover:bg-surface hover:text-foreground lg:hidden"
      >
        <Menu size={20} aria-hidden />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/70"
          />

          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-surface shadow-xl">
            <div className="flex h-14 items-center justify-between border-b border-border px-4">
              <span className="text-sm font-semibold">Browse</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="rounded-md p-1.5 text-muted hover:text-foreground"
              >
                <X size={18} aria-hidden />
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto p-2">
              {categories.map((category) => (
                <Link
                  key={category.id}
                  href={`/category/${category.slug}`}
                  onClick={() => setOpen(false)}
                  className="block rounded-md px-3 py-2 text-sm text-foreground hover:bg-surface-raised"
                >
                  {category.name}
                </Link>
              ))}
            </nav>

            <div className="border-t border-border p-2">
              <Link
                href="/studio"
                onClick={() => setOpen(false)}
                className="block rounded-md px-3 py-2 text-sm text-muted hover:bg-surface-raised"
              >
                Creator studio
              </Link>
              <Link
                href="/legal/dmca"
                onClick={() => setOpen(false)}
                className="block rounded-md px-3 py-2 text-sm text-muted hover:bg-surface-raised"
              >
                Report content
              </Link>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
