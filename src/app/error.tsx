"use client"

import { Button } from "@/components/ui/button"

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="flex min-h-[50vh] items-center justify-center p-4">
      <div className="text-center space-y-4 max-w-md">
        <h2 className="text-2xl font-semibold">Algo deu errado</h2>
        <p className="text-muted-foreground text-sm">
          Ocorreu um erro ao carregar esta página. Tente novamente.
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
    </div>
  )
}
