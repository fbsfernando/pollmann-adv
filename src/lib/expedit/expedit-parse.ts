/**
 * Parser do campo `conteudo_publicacao` (HTML) das publicações do Expedit.
 *
 * Extrai, de forma best-effort, os campos estruturados que o restante da
 * aplicação consome: tipo de comunicação, URL de inteiro-teor, partes,
 * advogados, classe e o texto limpo (sem tags).
 *
 * A estrutura exata do HTML do Expedit pode variar entre diários, então o
 * parser é tolerante: cada campo é opcional e cai para `null`/`[]` quando
 * não encontrado, sempre preservando `textoLimpo`.
 */
import * as cheerio from 'cheerio'

import type { PublicacaoConteudoParsed } from '@/lib/expedit/expedit-types'

/** Tipos de comunicação reconhecidos (ordem = prioridade de detecção). */
const TIPOS_COMUNICACAO = [
  'Sentença',
  'Acórdão',
  'Decisão',
  'Despacho',
  'Intimação',
  'Citação',
  'Notificação',
  'Edital',
  'Audiência',
  'Ato Ordinatório',
] as const

const stripAccents = (value: string): string =>
  value.normalize('NFD').replace(/\p{Diacritic}/gu, '')

/** Colapsa apenas espaços/tabs (preserva quebras de linha). */
const collapseSpaces = (value: string): string => value.replace(/[^\S\n]+/g, ' ').trim()

/** Colapsa todo o espaço em branco (inclui quebras de linha). */
const collapseAll = (value: string): string => value.replace(/\s+/g, ' ').trim()

const detectTipoComunicacao = (texto: string): string | null => {
  const alvo = stripAccents(texto).toLowerCase()
  for (const tipo of TIPOS_COMUNICACAO) {
    if (alvo.includes(stripAccents(tipo).toLowerCase())) return tipo
  }
  return null
}

/** Procura "Label: valor" em alguma das linhas e retorna o primeiro valor. */
const extractLabel = (lines: string[], labels: string[]): string | null => {
  for (const line of lines) {
    for (const label of labels) {
      const re = new RegExp(`^\\s*${label}\\s*[:\\-]\\s*(.+)$`, 'i')
      const m = line.match(re)
      if (m?.[1]) {
        const value = collapseSpaces(m[1])
        if (value) return value
      }
    }
  }
  return null
}

const splitNomes = (value: string | null): string[] =>
  value
    ? value
        .split(/\s*(?:,|;| e )\s*/i)
        .map((s) => collapseSpaces(s))
        .filter((s) => s.length > 1)
    : []

export const parsePublicacaoConteudo = (
  html: string | null | undefined
): PublicacaoConteudoParsed => {
  const raw = html ?? ''

  // Preserva limites de bloco como quebras de linha para a extração por rótulo.
  const withBreaks = raw
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')

  const $ = cheerio.load(withBreaks)
  const fullText = $.root().text()
  const textoLimpo = collapseAll(fullText)
  const lines = fullText
    .split('\n')
    .map((l) => collapseSpaces(l))
    .filter((l) => l.length > 0)

  // Inteiro-teor: primeiro link cujo texto/href sugira o documento integral,
  // senão o primeiro link absoluto encontrado.
  let inteiroTeorUrl: string | null = null
  let firstHref: string | null = null
  $('a[href]').each((_, el) => {
    const href = ($(el).attr('href') ?? '').trim()
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) return
    if (!firstHref) firstHref = href
    const hint = `${href} ${$(el).text()}`.toLowerCase()
    if (!inteiroTeorUrl && /(inteiro|teor|integra|documento|download|pdf)/.test(hint)) {
      inteiroTeorUrl = href
    }
  })
  inteiroTeorUrl = inteiroTeorUrl ?? firstHref

  const partes = splitNomes(
    extractLabel(lines, ['Partes', 'Parte', 'Autor', 'Requerente', 'Exequente'])
  )
  const advogados = splitNomes(
    extractLabel(lines, ['Advogados?', 'Adv', 'Procuradores?'])
  )
  const classe = extractLabel(lines, ['Classe', 'Tipo de a[çc][ãa]o'])
  const tipoComunicacao =
    extractLabel(lines, ['Tipo de comunica[çc][ãa]o', 'Comunica[çc][ãa]o']) ??
    detectTipoComunicacao(textoLimpo)

  return {
    tipoComunicacao,
    inteiroTeorUrl,
    partes,
    advogados,
    classe,
    textoLimpo,
  }
}
