"use client"

import { Button } from "@/components/ui/button"

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center space-y-4 max-w-md">
          <h2 className="text-2xl font-semibold">Algo deu errado</h2>
          <p className="text-muted-foreground text-sm">
            Ocorreu um erro inesperado. Tente novamente ou entre em contato com o suporte.
          </p>
          {error.digest && (
            <p className="text-xs text-muted-foreground font-mono">
              Referência: {error.digest}
            </p>
          )}
          <Button onClick={reset} variant="default">
            Tentar novamente
          </Button>
        </div>
      </body>
    </html>
  )
}
