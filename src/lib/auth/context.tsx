"use client"

import { SessionProvider, useSession, signOut } from "next-auth/react"
import { createContext, useContext, type ReactNode } from "react"
import type { Role } from "@prisma/client"

interface AuthContextType {
  userId: string | null
  name: string | null
  email: string | null
  role: Role | null
  loading: boolean
  isAdmin: boolean
  handleSignOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({
  userId: null,
  name: null,
  email: null,
  role: null,
  loading: true,
  isAdmin: false,
  handleSignOut: async () => {},
})

function AuthContextInner({ children }: { children: ReactNode }) {
  const { data: session, status } = useSession()

  const loading = status === "loading"
  const user = session?.user
  const role = (user as { role?: Role } | undefined)?.role ?? null

  async function handleSignOut() {
    await signOut({ callbackUrl: "/login" })
  }

  return (
    <AuthContext.Provider
      value={{
        userId: user?.id ?? null,
        name: user?.name ?? null,
        email: user?.email ?? null,
        role,
        loading,
        isAdmin: role === "ADMIN",
        handleSignOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function AuthProvider({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <AuthContextInner>{children}</AuthContextInner>
    </SessionProvider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
