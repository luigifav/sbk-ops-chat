/**
 * Identidade reservada do harness de avaliação (issue #60).
 *
 * O runner do harness bate na rota de chat de verdade, então as mensagens dele
 * caem na mesma tabela `Message` que o tráfego real. Em vez de dar à rota um modo
 * especial que desliga persistência (mais um caminho condicional numa rota
 * sensível, e um que só existe para teste), o runner se identifica com este nome
 * pelo caminho normal do cookie `sbk_operator_name`. Assim as linhas do eval
 * ficam gravadas e visíveis, o que é útil para ver o custo da própria avaliação,
 * e ao mesmo tempo são filtráveis em qualquer análise.
 *
 * Duas consequências no código de produção, ambas deliberadas e pequenas:
 *
 * - `app/api/chat/route.ts` não classifica tema para este operador. A
 *   classificação custa uma chamada de Haiku por mensagem e o tema de um caso de
 *   eval não interessa a ninguém.
 * - `scripts/measure.ts` aceita `--exclude-eval` para tirar essas linhas da
 *   comparação de janelas, senão uma rodada de 50 casos entraria na média de
 *   custo por mensagem do dia e sujaria a medição.
 *
 * O nome tem underscores duplos nas pontas para não colidir com nome de pessoa.
 */
export const EVAL_OPERATOR_NAME = '__eval__'

/** Verdadeiro quando a mensagem veio do harness, não de um operador real. */
export function isEvalOperator(operatorName: string | null | undefined): boolean {
  return operatorName === EVAL_OPERATOR_NAME
}
