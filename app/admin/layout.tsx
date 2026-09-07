import Link from 'next/link'
import {
  Users,
  ShieldCheck,
  Flag,
  LayoutDashboard,
  FolderTree,
  Globe,
  UserRound,
  Film,
} from 'lucide-react'
import { requireStaff } from '@/lib/auth/guards'

export default async function AdminLayout({ children }: LayoutProps<'/admin'>) {
  // Moderators reach everything here except uploader approvals and category
  // management, which are admin-only and guarded again on their own pages.
  const profile = await requireStaff('/admin')
  const isAdmin = profile.role === 'admin'

  const links = [
    { href: '/admin', label: 'Overview', icon: LayoutDashboard, adminOnly: false },
    { href: '/admin/moderation', label: 'Moderation queue', icon: ShieldCheck, adminOnly: false },
    { href: '/admin/reports', label: 'Reports', icon: Flag, adminOnly: false },
    { href: '/admin/uploaders', label: 'Uploader applications', icon: Users, adminOnly: true },
    { href: '/admin/categories', label: 'Categories', icon: FolderTree, adminOnly: true },
    { href: '/admin/paysites', label: 'Networks', icon: Globe, adminOnly: true },
    { href: '/admin/models', label: 'Models', icon: UserRound, adminOnly: true },
    { href: '/admin/videos', label: 'All videos', icon: Film, adminOnly: true },
  ].filter((link) => !link.adminOnly || isAdmin)

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <aside className="lg:w-56 lg:shrink-0">
        <h1 className="mb-3 text-sm font-bold">
          {isAdmin ? 'Admin' : 'Moderation'}
        </h1>

        <nav className="flex gap-1 overflow-x-auto scrollbar-none lg:flex-col lg:overflow-visible">
          {links.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-muted hover:bg-surface hover:text-foreground"
            >
              <Icon size={15} aria-hidden />
              {label}
            </Link>
          ))}
        </nav>
      </aside>

      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
