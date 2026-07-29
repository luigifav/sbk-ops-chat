/**
 * Formato do golden set e dos resultados do harness de avaliação (issue #60).
 *
 * O conjunto é versionado no repositório (`evals/golden-set.json`) porque ele é a
 * régua: se ele mudar junto com a mudança que está sendo avaliada, a comparação
 * antes/depois não significa nada.
 */

/**
 * Trilha de correção do caso.
 *
 * - `petition`: classificação de petição inicial. A saída é um conjunto de campos
 *   definidos, então a nota é determinística, campo a campo, sem juiz.
 * - `open`: pergunta operacional aberta. Não há resposta única, então a nota sai
 *   de um juiz com rubrica explícita.
 */
export type Track = 'petition' | 'open'

export interface GoldenCase {
  /** Estável entre rodadas: é por ele que o diff contra o baseline casa os casos. */
  id: string
  track: Track
  /** Texto enviado como mensagem do operador, igual ao que ele digitaria. */
  question: string
  /**
   * Cliente esperado, ou null quando a pergunta é global. Serve de critério para
   * o juiz e para detectar mistura de clientes.
   */
  client: string | null
  /** Por que este caso está no conjunto. Não entra na nota, é para quem revisa. */
  notes?: string
  /**
   * Só na trilha `petition`. Chave é o rótulo do campo como aparece na resposta
   * (`GESTOR PRINCIPAL`, `COD_TIPO`, `Produto`, ...), valor é o esperado.
   *
   * Quando o esperado é um código numérico, a comparação olha só o código e
   * ignora a descrição que vem depois: o código é o que precisa sair certo, a
   * descrição é prosa do modelo e varia sem estar errada.
   */
  expectedFields?: Record<string, string>
  /**
   * Só na trilha `open`. Critérios concretos que a resposta precisa satisfazer,
   * em linguagem natural, avaliados pelo juiz.
   */
  criteria?: string[]
  /**
   * Verdadeiro quando a resposta correta é escalar, ou dizer que não encontrou a
   * informação. São os casos mais frágeis a qualquer relaxamento de recuperação:
   * afrouxar o RAG faz o modelo inventar em vez de escalar, e é justamente o que
   * uma otimização de custo pode quebrar sem que a taxa de acerto geral caia.
   */
  expectEscalation?: boolean
}

export interface GoldenSet {
  /** Sobe quando o formato muda de forma incompatível. */
  version: 1
  cases: GoldenCase[]
}

/** Nota de um caso. `null` em `passed` significa que a nota não pôde ser apurada. */
export interface CaseResult {
  id: string
  track: Track
  passed: boolean | null
  /** 0 a 1. Na trilha de petição, fração de campos corretos. */
  score: number | null
  /** Por que passou ou não, em uma linha. */
  reason: string
  /** Campos que saíram errados, só na trilha de petição. */
  fieldErrors?: Array<{ field: string; expected: string; got: string | null }>

  answer: string
  responseTimeMs: number
  inputTokens: number | null
  outputTokens: number | null
  cacheReadTokens: number | null
  cacheCreationTokens: number | null
  cacheCreation1hTokens: number | null
  ragFallback: boolean | null
  ragTopScore: number | null
  stopReason: string | null
  costUsd: number | null
  /** Erro de transporte ou de juiz, quando houve. */
  error?: string
}

export interface RunSummary {
  startedAt: string
  /** Configuração sob teste, para o diff dizer o que mudou entre duas rodadas. */
  config: {
    baseUrl: string
    chatModel: string
    judgeModel: string
    /** Valores de Setting em vigor, quando o runner conseguiu lê-los. */
    tuning: Record<string, string> | null
  }
  totals: {
    cases: number
    scored: number
    errors: number
    passed: number
    passRate: number | null
    /** Por trilha, para não misturar acerto determinístico com nota de juiz. */
    byTrack: Record<Track, { cases: number; passed: number; passRate: number | null }>
    escalationCases: number
    escalationPassed: number
    avgCostUsd: number | null
    totalCostUsd: number
    judgeCostUsd: number
    fallbackRate: number | null
    avgOutputTokens: number | null
    avgResponseMs: number | null
    p95ResponseMs: number | null
  }
  results: CaseResult[]
}
