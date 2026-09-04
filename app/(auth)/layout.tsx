/**
 * Narrow, centred column for every credential form. Kept as a route group so
 * these pages share a shell without adding a path segment to their URLs.
 */
export default function AuthLayout({ children }: LayoutProps<'/'>) {
  return (
    <div className="mx-auto flex min-h-[70vh] w-full max-w-sm flex-col justify-center py-8">
      {children}
    </div>
  )
}
