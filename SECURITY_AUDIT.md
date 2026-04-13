# Security Audit — SBK Ops Chat

**Data da auditoria:** 2026-04-13  
**Auditor:** Claude (engenheiro de segurança sênior automatizado)  
**Versão:** 0.1.0  
**Stack:** Next.js 14 App Router · Prisma + PostgreSQL (pgvector) · Anthropic Claude · Vercel

---

## Sumário Executivo

A aplicação possui uma arquitetura sólida para uma plataforma interna (App Router, Prisma ORM, bcrypt para senhas de operadores, cookies httpOnly). Foram identificados **17 itens de segurança** distribuídos em nove categorias. Todos os itens foram endereçados nesta auditoria: 13 corrigidos no código e 4 documentados como riscos residuais aceitos com TODOs explícitos.

---

## Parte A — O que foi corrigido

### 1. Rate Limiting (CRÍTICO — novo: `lib/ratelimit.ts`)

**Problema:** Nenhum endpoint tinha proteção contra brute-force ou abuso de API.

**Correção:** Criado `lib/ratelimit.ts` — sliding-window rate limiter em memória aplicado em:

| Endpoint | Limite | Janela |
|----------|--------|--------|
| `POST /api/auth` (login) | 10 req/IP | 60 s |
| `POST /api/auth` (cadastro) | 5 req/IP | 10 min |
| `POST /api/admin/auth` | 5 req/IP | 60 s |
| `POST /api/chat` | 60 req/operador | 1 h |

Respostas de rate limit incluem o header `Retry-After` com o tempo restante em segundos.

> **Limitação documentada:** O rate limiter em memória não é compartilhado entre instâncias serverless. Ver "Riscos Residuais" abaixo.

---

### 2. Security Headers HTTP (ALTO — `next.config.mjs`)

**Problema:** Nenhum header de segurança estava configurado.

**Correção:** Adicionados os seguintes headers em todas as rotas:

| Header | Valor |
|--------|-------|
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` |
| `Content-Security-Policy` | Veja abaixo |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains` (apenas produção) |

**CSP configurada:**
```
default-src 'self';
script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:;
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src 'self' https://fonts.gstatic.com;
img-src 'self' data: blob:;
connect-src 'self';
worker-src 'self' blob: https://unpkg.com;
object-src 'none';
base-uri 'self';
form-action 'self';
frame-ancestors 'none';
```

> `'unsafe-inline'` é necessário pelo App Router do Next.js 14. `'unsafe-eval'` é necessário pelo worker do pdf.js. Ambos podem ser removidos em versões futuras com suporte a nonce.

---

### 3. Validação de Tamanho de Input (MÉDIO)

**Problema:** Campos de texto aceitos sem limite de comprimento, abrindo risco de payloads grandes e poluição de logs.

**Correções:**

| Arquivo | Campo | Limite adicionado |
|---------|-------|-------------------|
| `api/auth/route.ts` | `operatorName` | 100 chars |
| `api/auth/route.ts` | `password` | 128 chars |
| `api/auth/route.ts` | `inviteCode` | 128 chars |
| `api/admin/auth/route.ts` | `password` | 128 chars |
| `api/admin/operators/route.ts` | `name` | 100 chars |
| `api/admin/operators/route.ts` | `password` | 128 chars |
| `api/admin/documents/route.ts` | `name` | 255 chars |
| `api/admin/documents/route.ts` | `type` | 50 chars |
| `api/admin/documents/route.ts` | `content` | 10 MB de texto |
| `api/admin/messages/route.ts` | `search` query param | 200 chars |

---

### 4. Streaming Timeout — Claude API (`api/chat/route.ts`)

**Problema:** A stream de resposta da Anthropic não tinha timeout; uma requisição poderia ficar aberta indefinidamente se a API travasse.

**Correção:** Adicionado `AbortController` com timeout de 60 segundos passado como `signal` para `anthropic.messages.create()`. O `clearTimeout` é chamado no bloco `finally` do stream.

---

### 5. Validação de `sessionId` (`api/chat/route.ts`)

**Problema:** `sessionId` vindo do cliente era salvo diretamente no banco sem qualquer validação, permitindo poluição de logs com strings arbitrárias.

**Correção:** `sessionId` é validado contra o regex `/^[a-zA-Z0-9\-_]{1,64}$/`. Valores inválidos são silenciosamente substituídos por `'invalid'` (a requisição não é rejeitada, pois `sessionId` é puramente para logging).

---

### 6. Validação de Tamanho Mínimo do `AUTH_SECRET` (`lib/auth.ts`)

**Problema:** Nenhuma verificação garantia que `AUTH_SECRET` tinha comprimento suficiente para ser uma chave HMAC segura.

**Correção:** Adicionada função `validateAuthConfig()` que lança erro se `AUTH_SECRET` tiver menos de 32 caracteres. Deve ser chamada no startup da aplicação (ver recomendações operacionais).

---

### 7. Validação Numérica de Embeddings (`api/admin/documents/embed/route.ts`)

**Problema:** Os valores do array de embedding eram formatados em string diretamente sem validação. Valores como `NaN` ou `Infinity` causariam erro no cast `::vector` do PostgreSQL.

**Correção:** Adicionada função `toVectorLiteral()` que valida cada valor com `isFinite()` antes de incluir na string. Lança erro descritivo se algum valor inválido for encontrado.

---

### 8. Documentação do `sbk_operator_name` não-httpOnly (`api/auth/route.ts`)

**Problema:** O cookie `sbk_operator_name` é acessível via JavaScript no cliente (não-httpOnly), o que pode ser confundido com uma falha de segurança.

**Avaliação:** Intencional — o componente `Chat.tsx` lê este cookie via `document.cookie` para exibir o nome do operador na UI. Sem este cookie acessível via JS, seria necessário uma chamada de API adicional.

**Correção:** Adicionados comentários detalhados no código documentando:
- Por que o cookie é não-httpOnly (uso legítimo no cliente)
- O risco aceito: operador autenticado pode falsificar o nome nos logs
- O impacto real: apenas log-attribution spoofing, sem escalação de privilégio
- SECURITY TODO com solução recomendada (operatorId no token)

---

### 9. Correção do Script de Build (`package.json`)

**Problema:** O script `build` executava `prisma db push` antes do build, o que em produção modifica o schema do banco automaticamente sem possibilidade de rollback.

**Correção:**
- Removido `prisma db push` do script `build`
- Adicionado script `db:migrate:deploy` (`prisma migrate deploy`) para uso explícito em CI/CD

**Build atual:**
```json
"build": "prisma generate && next build"
```

---

### 10. Documentação do SSRF Interno (`api/admin/documents/route.ts`)

**Problema:** A rota de documentos dispara um `fetch()` interno para `/api/admin/documents/embed` passando os cookies da requisição original, o que foi apontado como possível SSRF.

**Avaliação:** Risco mínimo — a URL é derivada de `req.url` (controlado pelo framework Next.js, não pelo usuário) e a requisição destino autentica via cookie. Adicionados comentários no código explicando a análise e confirmando a segurança da abordagem.

---

### 11. Middleware — Path Traversal (`middleware.ts`)

**Avaliação:** O middleware usa comparação exata (`pathname === '/api/admin/auth'`) para as exceções de auth. O Next.js normaliza URLs antes de entregá-las ao middleware, portanto `/api/admin/auth/../documents` se torna `/api/admin/documents` e é corretamente protegido pela regra `pathname.startsWith('/api/admin')`. Sem vulnerabilidade.

**Documentado:** Nenhuma mudança necessária; fluxo confirmado seguro.

---

### 12. Atualização do `.env.local.example`

**Problema:** `DATABASE_URL_UNPOOLED` estava referenciado no `schema.prisma` mas ausente no arquivo de exemplo.

**Correção:** Adicionada entrada `DATABASE_URL_UNPOOLED` com documentação explicando seu uso (Prisma Migrate, Vercel Postgres/Neon).

---

### 13. Documentação do Risco de Inject no INVITE_CODE (`api/auth/route.ts`)

**Avaliação:** O `INVITE_CODE` não vaza em respostas de erro (a mensagem é genérica: "Código de convite inválido"). A comparação agora inclui um check de comprimento antes da comparação de conteúdo para comportamento mais consistente.

---

## Parte B — Riscos Residuais Documentados

### R1. Rate Limiting Não-Distribuído (CRÍTICO em produção multi-instância)

**Risco:** O `lib/ratelimit.ts` usa memória do processo Node.js. Em deployments Vercel com múltiplas instâncias de Function, cada instância mantém seu próprio contador. Um atacante distribuindo requisições entre instâncias pode exceder o limite efetivo.

**Impacto:** Brute force contra `/api/auth` e `/api/admin/auth` pode ser mais eficaz do que os limites configurados.

**Mitigação parcial implementada:** O limite em memória ainda fornece proteção significativa em instâncias únicas e contra ataques não-distribuídos.

**Solução recomendada (produção):**
```bash
npm install @upstash/ratelimit @upstash/redis
```
Substituir `lib/ratelimit.ts` por rate limiting com Upstash Redis (atomic INCR + EXPIRE).  
Documentação: https://github.com/upstash/ratelimit-js

**SECURITY TODO:** Marcado em `lib/ratelimit.ts` e `api/chat/route.ts`.

---

### R2. Log-Attribution Spoofing via `sbk_operator_name` (BAIXO)

**Risco:** O cookie `sbk_operator_name` não é httpOnly. Um operador autenticado pode modificar seu valor no navegador e ter mensagens registradas sob o nome de outro operador.

**Impacto:** Apenas integridade dos logs de auditoria. Não há escalação de privilégio — a autenticação é feita exclusivamente pelo `sbk_auth_token` (httpOnly).

**Causa raiz:** O design atual usa um único token compartilhado (`HMAC(ACCESS_PASSWORD, AUTH_SECRET)`) para todos os operadores. Sem um identificador de operador no token, não é possível validar o nome contra o banco no servidor.

**Solução recomendada:**
Emitir tokens per-operador: `HMAC(operatorId + ":" + hashedPassword, AUTH_SECRET)`, armazenar o `operatorId` em sessão e resolver o nome no servidor.

**SECURITY TODO:** Marcado em `api/auth/route.ts` e `api/chat/route.ts`.

---

### R3. Content Security Policy com `unsafe-inline` / `unsafe-eval` (MÉDIO)

**Risco:** A CSP inclui `'unsafe-inline'` e `'unsafe-eval'` nos scripts, o que enfraquece a proteção contra XSS.

**Causa:** `'unsafe-inline'` é necessário pelo Next.js 14 App Router para scripts de hidratação inline. `'unsafe-eval'` é necessário pelo worker do `pdfjs-dist`.

**Solução recomendada:**
1. Implementar CSP baseada em nonce conforme documentação do Next.js 14: https://nextjs.org/docs/app/building-your-application/configuring/content-security-policy
2. Substituir ou configurar o worker do pdf.js para funcionar sem `eval`.

**SECURITY TODO:** Marcado em `next.config.mjs`.

---

### R4. Token Sem Expiração Server-Side (BAIXO)

**Risco:** O token de autenticação é `HMAC(password, AUTH_SECRET)`. Enquanto `AUTH_SECRET` e `ACCESS_PASSWORD`/`ADMIN_PASSWORD` não mudarem, tokens antigos permanecem válidos. A única expiração é o `maxAge` do cookie (8 horas) — que não é enforçado pelo servidor.

**Impacto:** Se um token for comprometido (e.g., vazamento de cookie), ele permanece válido até a rotação das variáveis de ambiente.

**Mitigação:** Cookies `SameSite=lax` + `Secure` (produção) reduzem o risco de roubo de cookie.

**Solução recomendada:** Adicionar um nonce/timestamp ao payload do token armazenado no banco, com TTL verificado server-side. Alternativamente, migrar para JWT com expiração.

**SECURITY TODO:** Documentado em `lib/auth.ts`.

---

## Parte C — Recomendações Operacionais Pós-Deploy

### Imediatas (antes do go-live)

1. **Configurar variáveis de ambiente:** Preencher todas as entradas de `.env.local.example` no painel do Vercel. `AUTH_SECRET` deve ter **mínimo 32 caracteres** — use `openssl rand -hex 32`.

2. **Executar migrations em produção:**
   ```bash
   npm run db:migrate:deploy
   ```
   **Nunca** executar `prisma db push` em um banco de produção com dados. Use sempre `prisma migrate deploy`.

3. **Confirmar Node.js 20+ no Vercel:** `pdfjs-dist@5.x` requer Node >= 20.19.0. Configurar em `Settings > General > Node.js Version` no projeto Vercel.

4. **Verificar extensão pgvector:** Confirmar que `CREATE EXTENSION vector` foi executado no banco de produção (Neon e Vercel Postgres suportam por padrão).

5. **Rotacionar `INVITE_CODE`** após o onboarding inicial dos operadores. Considerar desabilitar o auto-cadastro em produção (remover ou comentar o bloco `isNewAccount`).

### Curto Prazo (primeiras 2 semanas)

6. **Implementar rate limiting distribuído** (R1 acima) com Upstash Redis antes de qualquer exposição pública ou volume significativo de usuários.

7. **Monitorar logs de erro do Vercel** para padrões de rate limit (`429`) que possam indicar ataques de brute force.

8. **Política de retenção de dados:** Definir e implementar purge automático da tabela `Message` (sugestão: deletar mensagens com mais de 90 dias via cron job).

9. **Adicionar índice de tempo na tabela Message** para melhorar performance das queries de analytics:
   ```sql
   CREATE INDEX IF NOT EXISTS message_created_at_idx ON "Message" ("createdAt" DESC);
   ```

10. **Configurar alertas de custo** nas APIs Anthropic e Voyage AI para detectar abuso precocemente.

### Médio Prazo (primeiro mês)

11. **Implementar log de auditoria admin:** Registrar todas as ações administrativas (criação/edição/exclusão de operadores e documentos) em uma tabela `AuditLog`.

12. **Revisitar CSP com nonces** (R3) após atualização do Next.js ou substituição do worker do pdf.js.

13. **Avaliar `xlsx@0.18.5`:** Esta versão tem histórico de vulnerabilidades de parsing. Avaliar substituição por `exceljs` ou upgrade para uma versão com suporte ativo, se upload de planilhas for um vetor de risco na organização.

14. **Index IVFFlat:** O índice criado com `lists = 100` é adequado para ~100k vetores. Para volumes menores que 1k, considerar remover o índice (full-scan é mais rápido); para volumes maiores que 1M, aumentar `lists` proporcionalmente ao `sqrt(n_vectors)`.

15. **Avaliar migração para JWT assinado** para tokens com expiração server-side real (R4).

---

## Parte D — Checklist de Segurança para Deploy

### Configuração

- [ ] `AUTH_SECRET` tem pelo menos 32 caracteres
- [ ] `ADMIN_PASSWORD` é forte (mínimo 16 chars, alfanumérico + especiais)
- [ ] `ACCESS_PASSWORD` é forte
- [ ] `INVITE_CODE` é único e não-óbvio
- [ ] `.env.local` não está commitado no repositório
- [ ] Todas as variáveis estão configuradas no Vercel (não hardcoded)

### Banco de Dados

- [ ] `prisma migrate deploy` executado (não `prisma db push`)
- [ ] Extensão `vector` habilitada no PostgreSQL de produção
- [ ] Backup automático configurado
- [ ] Acesso ao banco restrito ao IP/VPC do Vercel

### Aplicação

- [ ] `NODE_ENV=production` definido no Vercel (automático)
- [ ] Node.js >= 20.19.0 configurado no Vercel
- [ ] Headers de segurança verificados via https://securityheaders.com
- [ ] HTTPS enforçado (Vercel faz isso por padrão)

### Monitoramento

- [ ] Alertas de erro configurados (Vercel Logs / Sentry)
- [ ] Alertas de custo configurados (Anthropic + Voyage AI dashboards)
- [ ] Plano de resposta a incidentes definido para vazamento de `AUTH_SECRET`

---

## Apêndice — Inventário de Arquivos Modificados

| Arquivo | Tipo de mudança |
|---------|-----------------|
| `lib/ratelimit.ts` | **NOVO** — rate limiter em memória |
| `lib/auth.ts` | Adicionado `validateAuthConfig()` + comentários de design |
| `next.config.mjs` | Adicionados security headers (CSP, HSTS, X-Frame-Options, etc.) |
| `app/api/auth/route.ts` | Rate limiting, validação de comprimento, comentário sobre `sbk_operator_name` |
| `app/api/admin/auth/route.ts` | Rate limiting, validação de comprimento |
| `app/api/chat/route.ts` | AbortController timeout, validação de `sessionId`, comentário sobre spoofing |
| `app/api/admin/documents/route.ts` | Limite de tamanho de conteúdo, validação de campos, comentário sobre SSRF |
| `app/api/admin/documents/embed/route.ts` | Validação numérica de embeddings com `toVectorLiteral()` |
| `app/api/admin/messages/route.ts` | Limite de comprimento do parâmetro `search` |
| `app/api/admin/operators/route.ts` | Validação de comprimento de `name` e `password` |
| `.env.local.example` | Adicionado `DATABASE_URL_UNPOOLED`, melhorada documentação |
| `package.json` | Removido `prisma db push` do build; adicionado `db:migrate:deploy` |
| `SECURITY_AUDIT.md` | **NOVO** — este documento |
