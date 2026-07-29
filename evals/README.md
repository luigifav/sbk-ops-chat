# Harness de avaliação

Issue #60. Existe para responder uma pergunta que nenhuma outra métrica do projeto
responde: **a resposta piorou?**

O dashboard mede custo, taxa de fallback, latência e truncamento. Nenhuma dessas
mede correção. Sem isso, cada otimização de custo é aposta, e as issues de custo
(#61, #63, #64, #65) todas mexem, direta ou indiretamente, no conteúdo que chega ao
modelo. Esta é a régua que gateia essas mudanças.

## Como funciona

Três etapas, e a do meio não é automatizável.

1. `npm run eval:extract` lê a tabela `Message` e monta um **rascunho** com
   cobertura dos cinco clientes, dos temas, dos dois modos (petição e pergunta
   curta) e dos casos em que a resposta certa é escalar.
2. **Revisão humana.** O extrator não sabe qual era a resposta certa. Ele deixa
   `expectedFields` e `criteria` vazios de propósito: preenchê-los com a saída
   atual do modelo faria o conjunto aprovar exatamente o que o modelo já faz,
   inclusive os erros. Quem revisa preenche olhando a petição, não a resposta.
3. `npm run eval` roda o conjunto contra a rota de chat de verdade e grava um
   relatório com acerto, custo, taxa de fallback e latência.

## Uso

```bash
# 1. rascunho a partir do log
npm run eval:extract -- --target 50        # grava evals/golden-set.draft.json

# 2. revise à mão e salve como evals/golden-set.json

# 3. rode
npm run eval

# 4. compare com uma rodada anterior
npm run eval -- --baseline evals/baseline.json

# subconjunto, para iterar rápido sem gastar a rodada inteira
npm run eval -- --only exemplo_peticao_bradesco,exemplo_escalada

# compara duas rodadas já gravadas, sem rodar nada de novo
npm run eval -- --compare evals/baseline.json evals/results/2026-07-29T12-00-00.json
```

`evals/golden-set.example.json` mostra o formato de cada tipo de caso. É exemplo,
não conjunto utilizável: os valores são inventados.

## Ambiente

| Variável | Para quê |
|---|---|
| `EVAL_BASE_URL` | Instância a testar. Padrão `http://localhost:3000`. |
| `ACCESS_PASSWORD` | O runner assina o cookie de operador com ela. |
| `AUTH_SECRET` | Idem. |
| `ANTHROPIC_API_KEY` | Juiz da trilha aberta. |
| `DATABASE_URL` | Ler os tokens de cada caso. |
| `CHAT_HOURLY_LIMIT` | **Suba isto.** Um conjunto de 40 a 60 casos estoura o padrão de 60 por hora e a rodada morre no meio com 429. |

Rode contra uma instância de teste ou local, não contra produção: a rodada grava
dezenas de linhas em `Message` e consome API.

## As duas trilhas de correção

**Petição, determinística.** A resposta tem campos definidos, então a nota é
comparação campo a campo, sem modelo no meio. Quando o valor esperado é um código
numérico, a comparação olha só o código e ignora a descrição: o código precisa
sair certo, a descrição é prosa do modelo e varia sem estar errada.

Esta é a trilha que mais importa. A classificação é a tarefa de maior valor do
produto e é a primeira a degradar quando se reduz `effort`.

**Pergunta aberta, LLM como juiz.** Não há resposta única, então um juiz aplica
uma rubrica fixa: a resposta se apoia só na documentação, trata do cliente certo,
não mistura clientes, e escala quando (e só quando) deve.

O modelo do juiz (`JUDGE_MODEL` em `score.ts`) é **pinado de propósito** e não lê
`CHAT_MODEL`. Se o juiz acompanhasse o modelo avaliado, trocar o modelo do chat
moveria a régua junto, e o diff antes/depois mediria a diferença entre dois juízes
em vez da mudança que se quer avaliar. Ao trocar o modelo do chat, deixe o juiz
onde está.

## Como gatear uma mudança de custo

1. Rode o eval na configuração atual e salve como baseline:
   `cp evals/results/<rodada>.json evals/baseline.json` e comite.
2. Aplique a mudança (por exemplo, baixar `chat_effort_simple` para `low` no painel
   de admin).
3. Rode com `--baseline evals/baseline.json`.
4. Decida pelo **par acerto e custo**, nunca pelo custo isolado.

O diff lista as regressões caso a caso, e não só a variação da taxa de acerto. Isso
é deliberado: uma taxa estável pode esconder três casos que passaram a falhar e
três que passaram a acertar, e na classificação isso não é empate. Regressão na
trilha de petição aparece com destaque, porque a issue #65 pede zero regressão ali.

Se `low` mostrar qualquer regressão nas perguntas simples, suba para `medium` e não
insista.

## Detalhes que decidem se o número é confiável

- **Custo por caso é medido, não estimado.** O runner gera um `messageId`, a rota
  já aceita esse campo e o usa como id da linha em `Message`, e depois o runner lê
  essa linha. Os tokens são os que a API cobrou.
- **Caso que não roda não conta como reprovado.** Erro de transporte deixa
  `passed` em `null` e entra na contagem de erros, separado da taxa de acerto.
  Somar falha de infraestrutura como reprovação faria problema de rede parecer
  queda de qualidade.
- **Juiz que não responde JSON válido é erro, não aprovação.** O parser falha alto.
- **O conjunto é versionado.** Se a régua mudar junto com a mudança avaliada, a
  comparação não significa nada. `evals/results/` é ignorado pelo git; só
  `evals/baseline.json` e `evals/golden-set.json` são versionados.
- **As mensagens do harness são marcadas.** Elas gravam com o operador reservado
  `__eval__` (ver `lib/evalMode.ts`), o que serve para dois fins: a classificação
  de tema é pulada para elas, e `npm run measure -- --exclude-eval` as tira das
  comparações de janela. Sem esse filtro, uma rodada de 50 casos entra na média de
  custo por mensagem do dia e distorce a medição de produção.

## Limitação conhecida

O runner se autentica sem `sbk_operator_id`, então não há escopo de cliente por
operador: o cliente efetivo vem só do texto da pergunta. Um caso que dependa de
operador restrito a um cliente precisa mencionar o cliente no texto. Cobrir o
escopo por operador exigiria criar linhas em `Operator`, o que ficou de fora.
