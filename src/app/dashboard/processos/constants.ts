// Constantes compartilhadas entre a página e as server actions de processos.
// Mantidas FORA do arquivo "use server" (actions.ts) porque um módulo de
// server actions só pode exportar funções async — exportar uma constante ali
// invalida o módulo inteiro no build do Next.
export const PROCESSOS_PAGE_SIZE = 50
