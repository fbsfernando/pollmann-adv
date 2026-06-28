// Renderiza marcadores do processo (campo Json `[{ nome, cor }]`) como chips
// com a cor do Expedit. Server component puro.

type Marcador = { nome: string; cor: string | null }

const HEX = /^#?[0-9a-fA-F]{3,8}$/

function parse(value: unknown): Marcador[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && "nome" in x)
    .map((x) => ({
      nome: String(x.nome ?? "").trim(),
      cor: typeof x.cor === "string" && HEX.test(x.cor) ? (x.cor.startsWith("#") ? x.cor : `#${x.cor}`) : null,
    }))
    .filter((m) => m.nome)
}

export function MarcadorChips({
  marcadores,
  className,
  max = 3,
}: {
  marcadores: unknown
  className?: string
  max?: number
}) {
  const list = parse(marcadores)
  if (list.length === 0) return null
  const shown = list.slice(0, max)
  const rest = list.length - shown.length

  return (
    <div className={`flex flex-wrap items-center gap-1 ${className ?? ""}`}>
      {shown.map((m) => (
        <span
          key={m.nome}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.62rem] font-medium bg-muted text-muted-foreground/80"
          title={m.nome}
        >
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0"
            style={{ backgroundColor: m.cor ?? "var(--muted-foreground)" }}
          />
          {m.nome}
        </span>
      ))}
      {rest > 0 && <span className="text-[0.6rem] text-muted-foreground/50">+{rest}</span>}
    </div>
  )
}
