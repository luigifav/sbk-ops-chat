-- Composição do prompt por mensagem.
--
-- O dashboard já media o custo por mensagem, mas só o total: 35 mil tokens de
-- entrada apareciam como um número só, sem dizer se vieram das instruções fixas,
-- do glossário do cliente, do dump do fallback ou do histórico. Cada um desses
-- blocos tem uma alavanca de redução diferente e um risco de qualidade
-- diferente, então sem a quebra qualquer decisão sobre o que encolher era chute.
-- Estas colunas fecham essa lacuna com cinco valores que a rota já tinha em
-- memória na hora de gravar a linha: nenhuma chamada de API a mais, nenhum
-- count_tokens, nenhuma latência — é o mesmo INSERT com cinco campos a mais.
--
-- Por que CARACTERES e não tokens: contar tokens exigiria uma chamada por
-- mensagem, que é exatamente o tipo de gasto que esta revisão existe para
-- cortar. Para português a razão fica em torno de 3,5 caracteres por token, o
-- suficiente para dimensionar blocos e comparar antes/depois.
--
-- Todas nullable de propósito. As linhas gravadas antes desta migração não têm
-- como ser preenchidas retroativamente: o prompt daquelas mensagens não foi
-- guardado em lugar nenhum, e inventar um valor a partir do total de tokens
-- criaria uma série histórica falsa que passaria a ser comparada com a série
-- real. Nulo aqui significa "não medido", que é a verdade.

ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "fixedChars" INTEGER;
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "clientChars" INTEGER;
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "fallbackChars" INTEGER;
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "historyChars" INTEGER;
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "contextCapHit" BOOLEAN;
