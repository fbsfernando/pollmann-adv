import { describe, it, expect } from 'vitest'

import { parsePublicacaoConteudo } from '@/lib/expedit/expedit-parse'

describe('parsePublicacaoConteudo', () => {
  it('extrai tipo, classe, partes, advogados e inteiro-teor de HTML rotulado', () => {
    const html = `
      <div>
        <p>Tipo de comunicação: Intimação</p>
        <p>Classe: Procedimento Comum Cível</p>
        <p>Partes: João da Silva, Maria Souza</p>
        <p>Advogados: Carlos Pereira, Ana Lima</p>
        <p>Fica a parte intimada do despacho.</p>
        <a href="https://eproc.tjsc.jus.br/inteiro-teor/123">Inteiro teor</a>
      </div>
    `
    const r = parsePublicacaoConteudo(html)

    expect(r.tipoComunicacao).toBe('Intimação')
    expect(r.classe).toBe('Procedimento Comum Cível')
    expect(r.partes).toEqual(['João da Silva', 'Maria Souza'])
    expect(r.advogados).toEqual(['Carlos Pereira', 'Ana Lima'])
    expect(r.inteiroTeorUrl).toBe('https://eproc.tjsc.jus.br/inteiro-teor/123')
    expect(r.textoLimpo).toContain('Fica a parte intimada')
  })

  it('detecta tipo por palavra-chave quando não há rótulo', () => {
    const r = parsePublicacaoConteudo('<p>Foi proferida SENTENÇA de procedência nos autos.</p>')
    expect(r.tipoComunicacao).toBe('Sentença')
  })

  it('cai para o primeiro link quando nenhum sugere inteiro-teor', () => {
    const r = parsePublicacaoConteudo('<a href="https://x/abc">abrir</a>')
    expect(r.inteiroTeorUrl).toBe('https://x/abc')
  })

  it('é tolerante a conteúdo vazio/nulo', () => {
    const r = parsePublicacaoConteudo(null)
    expect(r.textoLimpo).toBe('')
    expect(r.tipoComunicacao).toBeNull()
    expect(r.inteiroTeorUrl).toBeNull()
    expect(r.partes).toEqual([])
  })
})
