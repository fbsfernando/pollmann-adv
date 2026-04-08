import type { NextAuthConfig } from "next-auth"

// Edge-compatible auth config (no Prisma adapter here)
export default {
  providers: [], // providers are configured in auth.ts, this is just for middleware
  pages: {
    signIn: "/login",
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user
      const isOnDashboard = nextUrl.pathname.startsWith("/dashboard")
      const isOnLogin = nextUrl.pathname === "/login"

      if (isOnDashboard) {
        if (isLoggedIn) return true
        return false // redirect to login
      }

      if (isOnLogin && isLoggedIn) {
        return Response.redirect(new URL("/dashboard", nextUrl))
      }

      return true
    },
  },
} satisfies NextAuthConfig
