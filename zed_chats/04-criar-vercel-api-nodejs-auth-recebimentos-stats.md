# Criar Vercel API (Node.js) — auth + recebimentos + stats

| Campo | Valor |
|-------|-------|
| **Conversa** | 4 de 6 |
| **Criada em** | 11/05/2026 15:45 |
| **Atualizada** | 11/05/2026 15:47 |
| **Mensagens** | 5 (1 suas · 4 do assistente) |
| **ID** | `82e5b8c4-0df8-40ce-a4c3-cc27b067894a` |

---

## 👤 Você  _(mensagem 1)_


Você é um engenheiro de software sênior especializado em Node.js e Vercel. Crie os seguintes arquivos no projeto. Escreva conteúdo COMPLETO, funcional e sem omissões.

## 1. Criar `md_recebimentos_extractor/package.json`

```json
{
  "name": "md-recebimentos",
  "version": "1.0.0",
  "private": true,
  "description": "API backend para MD Recebimentos",
  "engines": { "node": "20.x" },
  "dependencies": {
    "firebase-admin": "^12.3.0",
    "pg": "^8.12.0"
  }
}
```

## 2. Criar `md_recebimentos_extractor/api/_lib/db.js`

Helper para conexão com Neon PostgreSQL:
- Use `pg` Pool com `connectionString: process.env.DATABASE_URL` e `ssl: { rejectUnauthorized: false }`
- Singleton pattern (cria pool uma vez)
- Exporta `getPool()` e `query(text, params)` helper

## 3. Criar `md_recebimentos_extractor/api/_lib/auth.js`

Helper Firebase Admin:
- Inicializa firebase-admin uma única vez (verificar se já inicializado com `admin.apps.length`)
- `FIREBASE_SERVICE_ACCOUNT` env var contém o JSON do service account (stringify)
- Exporta `verifyToken(req)` que:
  - Extrai Bearer token do header Authorization
  - Verifica com `admin.auth().verifyIdToken(token)`
  - Lança erro descritivo se inválido
- Exporta `cors(res, allowedOrigin)` que seta headers CORS (aceita `*` ou origin específica via env `ALLOWED_ORIGIN`)

## 4. Criar `md_recebimentos_extractor/api/recebimentos.js`

Endpoint Vercel: `GET /api/recebimentos`

Query params suportados:
- `ano` (ex: "2025")
- `contratante` (busca ILIKE `%valor%`)
- `status_pagamento`
- `status_playlist` ("Com Playlist" ou "Sem Playlist")
- `page` (default 1)
- `limit` (default 50, max 200)
- `order_by` (whitelist: contratante, vencimento, valor_parcela, criado_em — default: contratante)
- `order_dir` (ASC/DESC — default: ASC)

Lógica:
1. Trata OPTIONS (CORS preflight)
2. Só aceita GET
3. Verifica token Firebase (401 se inválido)
4. Monta query dinâmica com WHERE e parâmetros numerados ($1, $2...)
5. Faz COUNT(*) e depois SELECT com LIMIT/OFFSET
6. Retorna JSON: `{ data: [...], total, page, limit, pages, execucao_ids: [...distinct] }`
7. Campos SELECT: id, ano, contratante, codigo_contrato, vencimento, valor_parcela, status_pagamento, pago_em, status_playlist, playlists, periodo, faixas, execucao_id, criado_em

## 5. Criar `md_recebimentos_extractor/api/stats.js`

Endpoint Vercel: `GET /api/stats`

Query params:
- `ano` (opcional — filtra por ano)

Lógica:
1. Trata OPTIONS
2. Só aceita GET
3. Verifica token Firebase
4. Executa TRÊS queries em paralelo com `Promise.all`:
   a. `SELECT * FROM v_stats_por_ano` (com WHERE ano se passado)
   b. `SELECT * FROM v_status_distribuicao` (com WHERE se passado)
   c. `SELECT DISTINCT ano FROM recebimentos ORDER BY ano DESC` (lista de anos disponíveis)
5. Retorna: `{ stats_por_ano: [...], status_distribuicao: [...], anos_disponiveis: [...] }`

## 6. Criar `md_recebimentos_extractor/vercel.json`

```json
{
  "outputDirectory": "docs",
  "rewrites": [
    { "source": "/api/:path*", "destination": "/api/:path*" },
    { "source": "/:path*", "destination": "/:path*" }
  ],
  "headers": [
    {
      "source": "/api/(.*)",
      "headers": [
        { "key": "Access-Control-Allow-Origin", "value": "*" },
        { "key": "Access-Control-Allow-Methods", "value": "GET, OPTIONS" },
        { "key": "Access-Control-Allow-Headers", "value": "Authorization, Content-Type" }
      ]
    }
  ],
  "env": {
    "NODE_ENV": "production"
  }
}
```

Use a ferramenta `edit_file` com mode `write` para criar cada arquivo com conteúdo COMPLETO.


---

## 🤖 Assistente  _(resposta 2)_

> 💭 **Raciocínio interno:** Let me create all the required files for the project. I'll start by exploring the project structure to understand what's already there.

**Ferramenta:** 📁 `list_directory` — `md_recebimentos_extractor`

---

## 🤖 Assistente  _(resposta 3)_

**Ferramenta:** 📁 `list_directory` — `md_recebimentos_extractor/api`

---

## 🤖 Assistente  _(resposta 4)_

Estrutura identificada. Vou criar todos os 6 arquivos em paralelo agora.

**Ferramenta:** ✏️ `edit_file` — `md_recebimentos_extractor/package.json`

**Ferramenta:** ✏️ `edit_file` — `md_recebimentos_extractor/api/_lib/db.js`

**Ferramenta:** ✏️ `edit_file` — `md_recebimentos_extractor/api/_lib/auth.js`

**Ferramenta:** ✏️ `edit_file` — `md_recebimentos_extractor/api/recebimentos.js`

**Ferramenta:** ✏️ `edit_file` — `md_recebimentos_extractor/api/stats.js`

**Ferramenta:** ✏️ `edit_file` — `md_recebimentos_extractor/vercel.json`

---

## 🤖 Assistente  _(resposta 5)_

Todos os 6 arquivos foram criados com sucesso. Aqui está um resumo completo do que foi gerado:

---

## Arquivos criados

### `package.json`
Manifesto do projeto com `firebase-admin ^12.3.0` e `pg ^8.12.0`, fixando Node.js 20.x via `engines`.

---

### `api/_lib/db.js` — Helper de banco
- **Singleton pool**: o `Pool` do `pg` é criado apenas uma vez e reutilizado entre invocações serverless (evita abertura excessiva de conexões).
- Configurado com `ssl: { rejectUnauthorized: false }` (obrigatório no Neon) e limites conservadores (`max: 5`) para o ambiente Vercel.
- Exporta `getPool()` e `query(text, params)`.

---

### `api/_lib/auth.js` — Helper Firebase Admin
- `initFirebase()` usa `admin.apps.length` para garantir inicialização única.
- `verifyToken(req)`: extrai e valida o Bearer token, lançando erros com `statusCode: 401` prontos para uso nos handlers.
- `cors(res, allowedOrigin)`: seta os 4 headers CORS incluindo `Access-Control-Max-Age: 86400` para cache do preflight.

---

### `api/recebimentos.js` — `GET /api/recebimentos`
- Filtros: `ano`, `contratante` (ILIKE), `status_pagamento`, `status_playlist` (Com/Sem Playlist com lógica dupla).
- Paginação: `page` / `limit` (máx 200).
- Ordenação: whitelist de 4 colunas + direção ASC/DESC.
- 3 queries executadas: `COUNT(*)`, `SELECT` paginado e `DISTINCT execucao_id`.
- Retorna `{ data, total, page, limit, pages, execucao_ids }`.

---

### `api/stats.js` — `GET /api/stats`
- Filtro opcional por `ano`.
- `Promise.all` com 3 queries paralelas: `v_stats_por_ano`, `v_status_distribuicao` e lista de anos.
- Retorna `{ stats_por_ano, status_distribuicao, anos_disponiveis }`.

---

### `vercel.json`
Configuração de rewrites, headers CORS globais para `/api/*` e `NODE_ENV: production`.

---

## Variáveis de ambiente necessárias

| Variável | Descrição |
|---|---|
| `DATABASE_URL` | Connection string do Neon PostgreSQL |
| `FIREBASE_SERVICE_ACCOUNT` | JSON do service account do Firebase (stringify) |
| `ALLOWED_ORIGIN` | *(opcional)* Origin específica no lugar de `*` |

---
