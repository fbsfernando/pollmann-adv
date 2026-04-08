import { AuthProvider } from "@/lib/auth/context"
import { AppShell } from "@/components/layout/app-shell"

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <AuthProvider>
      <AppShell>{children}</AppShell>
    </AuthProvider>
  )
}
