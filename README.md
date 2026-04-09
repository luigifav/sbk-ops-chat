# SBK Operacional Assistant

Chat com IA para suporte operacional interno da SBK Legal Operations. Operadores tiram dúvidas sobre processos e procedimentos; todas as interações são logadas e analisáveis pelo admin.

## Stack

- **Next.js 14** (App Router, TypeScript)
- **Tailwind CSS**
- **Prisma + PostgreSQL** (Vercel Postgres ou qualquer Postgres)
- **Anthropic Claude** (streaming)
- **Deploy:** Vercel

---

## Rodar localmente

### 1. Pré-requisitos

- Node.js 18+
- PostgreSQL acessível (local ou remoto)

### 2. Instalar dependências

```bash
npm install
```

### 3. Configurar variáveis de ambiente

```bash
cp .env.local.example .env.local
```

Edite `.env.local` com seus valores:

| Variável | Descrição |
|---|---|
| `DATABASE_URL` | String de conexão PostgreSQL |
| `ANTHROPIC_API_KEY` | Chave da API Anthropic |
| `ACCESS_PASSWORD` | Senha de acesso dos operadores |
| `ADMIN_PASSWORD` | Senha do painel de administração |
| `AUTH_SECRET` | String aleatória >= 32 chars para assinar cookies |

### 4. Criar as tabelas no banco

```bash
npx prisma db push
```

### 5. Gerar o cliente Prisma

```bash
npx prisma generate
```

### 6. Iniciar o servidor

```bash
npm run dev
```

Acesse `http://localhost:3000`.

---

## Deploy na Vercel

### 1. Criar projeto

1. Acesse [vercel.com](https://vercel.com) e crie um novo projeto
2. Conecte ao repositório GitHub

### 2. Adicionar banco de dados

Na aba **Storage** do projeto Vercel, adicione um **Postgres** (Vercel Postgres / Neon). A variável `DATABASE_URL` sera preenchida automaticamente.

### 3. Configurar variáveis de ambiente

No painel do projeto → **Settings → Environment Variables**, adicione:

```
ANTHROPIC_API_KEY    = sk-ant-...
ACCESS_PASSWORD      = senha-dos-operadores
ADMIN_PASSWORD       = senha-do-admin
AUTH_SECRET          = string-aleatoria-de-32-chars
```

> `DATABASE_URL` ja é configurada automaticamente pelo Vercel Postgres.

### 4. Build command (opcional)

Se necessário, configure em **Settings → Build & Development Settings**:

```
Build Command: npx prisma generate && next build
```

### 5. Deploy

Faca push para o branch principal — o deploy acontece automaticamente.

### 6. Criar as tabelas em producao

Apos o primeiro deploy, execute localmente com a `DATABASE_URL` de producao:

```bash
npx prisma db push
```

---

## Primeiros passos apos o deploy

1. Acesse a URL do projeto
2. Faca login como **admin**: navegue para `/?admin=1` ou clique em "Acessar painel" na tela de login
3. No painel admin → aba **Configurações**: cole a documentacao operacional da SBK
4. Configure as sugestoes rapidas conforme necessario
5. Compartilhe a URL raiz com os operadores

---

## Comandos uteis

```bash
npm run dev          # servidor de desenvolvimento
npm run build        # build de producao
npm run db:push      # sincroniza schema com o banco
npm run db:generate  # regenera o Prisma Client
npx prisma studio    # interface visual do banco (local)
```

---

## Estrutura do projeto

```
/app
  /api
    /auth/route.ts              <- login operadores
    /admin
      /auth/route.ts            <- login admin
      /messages/route.ts        <- historico + stats + CSV
      /settings/route.ts        <- system prompt e chips
    /chat/route.ts              <- streaming + logging
  /page.tsx                     <- tela de login
  /chat/page.tsx                <- interface do chat
  /admin/page.tsx               <- dashboard admin
/components
  Chat.tsx
  MessageBubble.tsx
  AdminDashboard.tsx
  SettingsPanel.tsx
  LoginScreen.tsx
/lib
  auth.ts                       <- HMAC token (Edge-compatible)
  prisma.ts                     <- Prisma singleton
/prisma
  schema.prisma
middleware.ts                   <- protecao de rotas (Edge)
```

---

## Seguranca

- Senhas nunca trafegam em texto claro apos o login
- Cookies sao httpOnly + SameSite=lax + Secure em producao
- Tokens = HMAC-SHA256(senha, AUTH_SECRET) — verificacao stateless
- API key da Anthropic nunca e exposta ao frontend
- Sessoes expiram em 8h (turno de trabalho)
