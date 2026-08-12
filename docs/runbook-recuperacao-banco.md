# Runbook: banco de dados indisponível ou perdido

O sintoma que traz alguém a este documento é a tela de login devolvendo
**"Internal server error"**. Toda autenticação de operador passa por
`prisma.operator.findFirst()`, então qualquer falha de banco aparece ali, e o
login é o ponto onde ela deixa de ter contorno.

## 1. Confirmar que é o banco, em 30 segundos

Abra `/?admin=1` e entre com a `ADMIN_PASSWORD`.

| Resultado | Leitura |
|---|---|
| Admin **entra**, operador dá 500 | É o banco. `/api/admin/auth` só compara uma variável de ambiente e não toca o Postgres, então essa assimetria isola o problema com precisão. |
| Admin **também** dá 500 | Não é o banco. Olhe `AUTH_SECRET` e o Redis do rate limit. |
| A tela de login nem carrega | Não é o banco. É deploy ou build. |

Para saber qual falha de banco é, leia o log da função `/api/auth` no runtime da
Vercel. As duas rotas de autenticação registram a exceção com o código do Prisma:

```
[auth] Falha no login do operador: {"name":"...","message":"...","code":"P2021"}
```

| Código | Significado | Ação |
|---|---|---|
| `P1001` | Não conseguiu alcançar o banco | Provedor fora do ar, compute suspenso ou host errado. Seção 2. |
| `P1017` | O servidor fechou a conexão | Compute derrubado no meio da requisição. Seção 2. |
| `P2024` | Timeout pegando conexão do pool | Limite de conexões. Confira se `DATABASE_URL` aponta para o endpoint **pooled**. |
| `P2021` | Tabela não existe | Schema perdido ou banco novo e vazio. Seção 3. |
| `P2022` | Coluna não existe | Migrações pendentes. Rode `npm run db:migrate:deploy`. |

## 2. O provedor está fora ou o compute não acorda

Antes de concluir que caiu, verifique nesta ordem, porque as três primeiras
causas são de projeto e não aparecem na página de status pública:

1. **Compute suspenso.** O Neon faz scale-to-zero, e a primeira requisição
   depois de ociosidade pode estourar timeout antes de o compute subir. Force um
   wake pelo SQL Editor do console.
2. **Limite do plano estourado.** Passando do teto de compute-hours ou storage, o
   provedor desabilita o compute e toda conexão falha.
3. **Endpoint errado nas variáveis.** O `schema.prisma` declara
   `directUrl = env("DATABASE_URL_UNPOOLED")`. As duas variáveis precisam existir
   e ser distintas: a **pooled** (host com `-pooler`) em `DATABASE_URL`, a
   **direta** em `DATABASE_URL_UNPOOLED`. Invertê-las esgota as conexões sob
   carga e produz `P2024` intermitente.
4. **Status do provedor.** Só depois disso, a página de status.

Se o banco voltar com os dados intactos, aplique as migrações pendentes e
confira que não sobrou nada:

```bash
DATABASE_URL='...' DATABASE_URL_UNPOOLED='...' npx prisma migrate deploy
```

## 3. O banco não volta: reconstruir do zero

Faça isto **somente depois** de esgotar a recuperação de dados, porque migração
recria estrutura e não conteúdo. Se o projeto ainda existe no provedor, o
**point-in-time restore** (Neon: restaurar a branch para um instante anterior) é
o único caminho que traz de volta operadores, histórico e documentos. Reconstruir
por migração perde tudo isso.

### 3.1 Provisionar e apontar

Crie o banco novo, e no painel da Vercel, em Settings, Environment Variables,
atualize `DATABASE_URL` (endpoint pooled) e `DATABASE_URL_UNPOOLED` (endpoint
direto). Redeploy, porque variável de ambiente só entra em efeito em build novo.

### 3.2 Criar o schema

```bash
DATABASE_URL='...' DATABASE_URL_UNPOOLED='...' npx prisma migrate deploy
```

Isto cria as 5 tabelas, a extensão `vector` e o índice HNSW. Verificado num
Postgres 16 vazio com pgvector 0.6.0: as 13 migrações aplicam limpas.

Requisito: **pgvector 0.5.0 ou superior**, por causa do índice HNSW da migração
`20260729000003`. Em versão anterior essa migração falha e bloqueia as seguintes.

Não use `prisma db push` aqui. Ele funciona, mas deixa `_prisma_migrations` vazia,
e a partir daí `migrate deploy` passa a tentar aplicar tudo desde o começo e
falha na primeira migração, que não é idempotente. Foi assim que o diretório de
migrações ficou incapaz de reconstruir o schema por vários meses.

### 3.3 Recuperar o acesso das pessoas

O painel admin funciona com banco vazio, porque a senha dele é variável de
ambiente. Entre em `/?admin=1` e recrie os operadores na aba de operadores. Cada
um volta com `status: 'active'` e já consegue entrar. A alternativa é cada pessoa
usar "Criar conta" com o `INVITE_CODE` e o admin aprovar, o que faz sentido para
um time grande.

### 3.4 Recarregar a documentação

Os documentos e seus embeddings não voltam por migração. No painel admin, suba
novamente os arquivos e dispare o embedding de cada um. Isso consome chamadas da
API de embeddings, então é gasto real, não só tempo.

Enquanto o corpus estiver vazio, o RAG não encontra nada e cada mensagem cai no
fallback, que é o caminho caro. Vale avisar o time antes de liberar o chat.

### 3.5 Reconferir as configurações

A tabela `Setting` também volta vazia. Os parâmetros de geração
(`chat_effort_simple`, `chat_max_tokens_petition` e os outros descritos em
`.env.local.example`) voltam aos defaults de `lib/chatTuning.ts`, que reproduzem o
comportamento anterior à issue #65. Se algum valor tinha sido ajustado no painel,
reaplique.

## 4. Verificação final

```bash
# 1. schema alinhado: só deve acusar o índice vetorial, ver a nota abaixo
npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script
# 2. o índice HNSW existe
psql "$DATABASE_URL" -c "SELECT indexname FROM pg_indexes WHERE tablename='DocumentChunk';"
```

Depois, pela aplicação: login de operador, uma pergunta no chat que deva
recuperar documentação, e o dashboard admin carregando sem erro.

**Nota sobre o `migrate diff`:** ele sempre vai propor `DROP INDEX
documentchunk_embedding_hnsw_idx`. O Prisma não sabe declarar índice vetorial no
schema, então esse drift é inerente e não indica problema. A consequência prática
é que um `prisma migrate dev` futuro vai propor derrubar o índice: recuse, ou
recrie-o na migração que o `migrate dev` gerar.
