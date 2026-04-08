"use client"

import { useState } from "react"
import { signIn } from "next-auth/react"
import { useRouter } from "next/navigation"
import { Input } from "@/components/ui/input"
import { Scale, ArrowRight, AlertCircle } from "lucide-react"

export default function LoginPage() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    })

    if (result?.error) {
      setError("E-mail ou senha incorretos")
      setLoading(false)
      return
    }

    router.push("/dashboard")
    router.refresh()
  }

  return (
    <main className="min-h-screen flex">
      {/* Left — dark brand panel */}
      <div className="hidden lg:flex lg:w-[42%] relative flex-col justify-between p-12 overflow-hidden bg-sidebar">
        {/* Noise texture overlay */}
        <div
          className="absolute inset-0 opacity-[0.025] pointer-events-none"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E")`,
            backgroundSize: "200px 200px",
          }}
        />

        {/* Subtle grid pattern */}
        <div
          className="absolute inset-0 opacity-[0.03] pointer-events-none"
          style={{
            backgroundImage: `linear-gradient(oklch(1 0 0 / 0.5) 1px, transparent 1px), linear-gradient(90deg, oklch(1 0 0 / 0.5) 1px, transparent 1px)`,
            backgroundSize: "48px 48px",
          }}
        />

        {/* Glow accent */}
        <div className="absolute bottom-0 left-0 w-96 h-96 rounded-full bg-accent/10 blur-[120px] pointer-events-none" />

        {/* Logo */}
        <div className="relative z-10 flex items-center gap-3">
          <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-sidebar-accent-foreground/8 border border-sidebar-border">
            <Scale className="w-4 h-4 text-sidebar-foreground/60" />
          </div>
          <div className="flex flex-col leading-none">
            <span className="font-heading text-[1.1rem] text-sidebar-foreground tracking-tight">
              Pollmann
            </span>
            <span className="text-[0.6rem] text-sidebar-foreground/30 tracking-[0.2em] uppercase font-medium">
              Advogados
            </span>
          </div>
        </div>

        {/* Headline */}
        <div className="relative z-10 space-y-5">
          <h1 className="font-heading text-[2.8rem] xl:text-[3.2rem] leading-[1.08] tracking-tight text-sidebar-foreground">
            Gestão processual{" "}
            <em className="not-italic text-sidebar-foreground/30">eficiente.</em>
          </h1>
          <p className="text-sidebar-foreground/35 text-base leading-relaxed max-w-xs">
            Acompanhe andamentos, gerencie clientes e tenha controle total do seu escritório.
          </p>
        </div>

        {/* Footer */}
        <div className="relative z-10">
          <p className="text-sidebar-foreground/20 text-xs tracking-wide">
            © 2026 Pollmann Advogados Associados
          </p>
        </div>
      </div>

      {/* Right — form */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-10 bg-background">
        <div className="w-full max-w-[360px] space-y-8">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-3">
            <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-primary/8 border border-border">
              <Scale className="w-4 h-4 text-primary/70" />
            </div>
            <div className="flex flex-col leading-none">
              <span className="font-heading text-[1.05rem] text-foreground tracking-tight">
                Pollmann
              </span>
              <span className="text-[0.6rem] text-muted-foreground/50 tracking-[0.2em] uppercase font-medium">
                Advogados
              </span>
            </div>
          </div>

          {/* Form header */}
          <div className="space-y-1.5">
            <h2 className="font-heading text-[1.8rem] text-foreground tracking-tight leading-tight">
              Entrar
            </h2>
            <p className="text-sm text-muted-foreground">
              Acesse com suas credenciais
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label
                htmlFor="email"
                className="block text-xs font-semibold uppercase tracking-widest text-muted-foreground/60"
              >
                E-mail
              </label>
              <Input
                id="email"
                type="email"
                placeholder="seu@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                autoFocus
                className="h-11 bg-background border-border/80 focus:border-ring focus-visible:ring-ring/30"
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="password"
                className="block text-xs font-semibold uppercase tracking-widest text-muted-foreground/60"
              >
                Senha
              </label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="h-11 bg-background border-border/80 focus:border-ring focus-visible:ring-ring/30"
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-destructive/8 border border-destructive/20">
                <AlertCircle className="w-3.5 h-3.5 text-destructive shrink-0" />
                <p className="text-xs font-medium text-destructive">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="relative w-full h-11 rounded-lg bg-primary text-primary-foreground text-sm font-semibold transition-all hover:bg-primary/90 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2 group mt-2"
            >
              {loading ? (
                <>
                  <span className="w-4 h-4 rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground animate-spin" />
                  Entrando...
                </>
              ) : (
                <>
                  Entrar
                  <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </main>
  )
}
