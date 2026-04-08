import Link from "next/link"
import { Scale, ArrowRight } from "lucide-react"

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 p-8 bg-primary text-primary-foreground relative overflow-hidden">
      {/* Subtle pattern */}
      <div
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
        }}
      />

      <div className="relative z-10 flex flex-col items-center gap-4">
        <div className="flex items-center justify-center w-14 h-14 rounded-xl bg-white/10 backdrop-blur-sm">
          <Scale className="w-7 h-7 text-accent" />
        </div>
        <h1 className="font-heading text-5xl md:text-6xl font-medium tracking-tight text-center">
          Pollmann ADV
        </h1>
        <p className="text-primary-foreground/50 text-lg">
          Gestão processual inteligente
        </p>
      </div>

      <Link
        href="/login"
        className="relative z-10 inline-flex items-center gap-2 h-11 px-6 rounded-lg bg-accent text-accent-foreground text-sm font-semibold transition-opacity hover:opacity-90"
      >
        Entrar
        <ArrowRight className="w-4 h-4" />
      </Link>
    </main>
  )
}
