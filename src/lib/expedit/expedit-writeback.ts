/**
 * Write-back de triagem: espelha no Expedit as ações de tratar/descartar
 * feitas na nossa plataforma (Fase A do sincronismo bidirecional).
 *
 * Best-effort por design: os endpoints são internos do app-v2 (não
 * documentados) e podem mudar — uma falha aqui NUNCA pode travar a triagem
 * local. Erros são logados e engolidos.
 *
 * Opt-in como o Drive/GCal: sem EXPEDIT_EMAIL/EXPEDIT_PASSWORD no ambiente,
 * vira no-op. O client (e a sessão PHP dele) é reutilizado entre chamadas
 * do mesmo processo Node.
 */
import { createExpeditClient, type ExpeditClient } from './expedit-client'

let cached: ExpeditClient | null | undefined

const getClient = (): ExpeditClient | null => {
  if (cached !== undefined) return cached
  const email = process.env.EXPEDIT_EMAIL
  const senha = process.env.EXPEDIT_PASSWORD
  cached =
    email && senha
      ? createExpeditClient({
          baseUrl: process.env.EXPEDIT_BASE_URL ?? 'https://app-v2.expedit.com.br',
          email,
          senha,
        })
      : null
  return cached
}

/** Marca a publicação como tratada no Expedit. Silencioso em falha. */
export async function espelharPublicacaoTratada(expeditRef: string | null): Promise<void> {
  const client = getClient()
  if (!client || !expeditRef) return
  try {
    const ok = await client.concluirPublicacao(expeditRef)
    if (!ok) console.warn('[expedit:writeback] concluir não confirmou', { expeditRef })
  } catch (e) {
    console.warn('[expedit:writeback] concluir falhou', {
      expeditRef,
      error: e instanceof Error ? e.message : 'unknown-error',
    })
  }
}

/** Descarta a publicação no Expedit com motivo auditável. Silencioso em falha. */
export async function espelharPublicacaoDescartada(
  expeditRef: string | null,
  motivo = 'Descartada na plataforma Pollmann ADV'
): Promise<void> {
  const client = getClient()
  if (!client || !expeditRef) return
  try {
    const ok = await client.setPublicacaoStatus(expeditRef, 'DESCARTADA', motivo)
    if (!ok) console.warn('[expedit:writeback] descartar não confirmou', { expeditRef })
  } catch (e) {
    console.warn('[expedit:writeback] descartar falhou', {
      expeditRef,
      error: e instanceof Error ? e.message : 'unknown-error',
    })
  }
}
