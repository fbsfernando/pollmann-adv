import Link from "next/link"
import { Scale } from "lucide-react"

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center p-6 bg-background">
      <div className="text-center space-y-6 max-w-sm">
        <div className="flex items-center justify-center w-12 h-12 rounded-full bg-muted mx-auto">
          <Scale className="w-5 h-5 text-muted-foreground/50" />
        </div>
        <div className="space-y-2">
          <h2 className="font-heading text-2xl text-foreground">
            Página não encontrada
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            A página que você está procurando não existe ou foi movida.
          </p>
        </div>
        <Link
          href="/dashboard"
          className="inline-flex items-center justify-center h-9 px-5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          Voltar ao início
        </Link>
      </div>
    </div>
  )
}
