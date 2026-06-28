import { unstable_cache } from 'next/cache'

import { createExpeditApiClient } from './expedit-api-client'
import type {
  ProcessoAssuntoQuantidadeDTO,
  ProcessoMarcadorQuantidadeDTO,
  ProcessoFinanceiroGrupoDTO,
  ProcessoFinanceiroCategoriaTotalDTO,
  ProcessoDuracaoPorEstadoResponseDTO,
} from './expedit-api-types'

export type IndicadoresData = {
  /** false quando as credenciais do Expedit não estão configuradas no runtime. */
  configured: boolean
  assuntos: ProcessoAssuntoQuantidadeDTO[]
  marcadores: ProcessoMarcadorQuantidadeDTO[]
  financeiro: ProcessoFinanceiroGrupoDTO[]
  categorias: ProcessoFinanceiroCategoriaTotalDTO[]
  duracao: ProcessoDuracaoPorEstadoResponseDTO | null
}

const VAZIO: IndicadoresData = {
  configured: false,
  assuntos: [],
  marcadores: [],
  financeiro: [],
  categorias: [],
  duracao: null,
}

async function fetchIndicadores(): Promise<IndicadoresData> {
  const username = process.env.EXPEDIT_EMAIL
  const password = process.env.EXPEDIT_PASSWORD
  if (!username || !password) return VAZIO

  const client = createExpeditApiClient({
    baseUrl: process.env.EXPEDIT_API_BASE_URL || 'https://api.expedit.com.br',
    username,
    password,
    timeout: 20000,
    proxyUrl: process.env.EXPEDIT_PROXY_URL || undefined,
  })

  // Degradação graciosa: cada indicador que falhar vira vazio, sem derrubar a página.
  const safe = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await fn()
    } catch {
      return fallback
    }
  }

  const [assuntos, marcadores, financeiro, categorias, duracao] = await Promise.all([
    safe(() => client.getIndicadorAssuntos(), [] as ProcessoAssuntoQuantidadeDTO[]),
    safe(() => client.getIndicadorMarcadores(), [] as ProcessoMarcadorQuantidadeDTO[]),
    safe(() => client.getIndicadorFinanceiro(), [] as ProcessoFinanceiroGrupoDTO[]),
    safe(() => client.getIndicadorFinanceiroCategorias(), [] as ProcessoFinanceiroCategoriaTotalDTO[]),
    safe(() => client.getIndicadorDuracao(), null as ProcessoDuracaoPorEstadoResponseDTO | null),
  ])

  return { configured: true, assuntos, marcadores, financeiro, categorias, duracao }
}

/** Indicadores do Expedit com cache de 1h (evita bater na API a cada page load). */
export const getIndicadores = unstable_cache(fetchIndicadores, ['expedit-indicadores'], {
  revalidate: 3600,
})
