# Reescrever index.html e app.js com Neon + Firebase Auth

| Campo | Valor |
|-------|-------|
| **Conversa** | 6 de 6 |
| **Criada em** | 11/05/2026 15:50 |
| **Atualizada** | 11/05/2026 16:00 |
| **Mensagens** | 12 (1 suas · 11 do assistente) |
| **ID** | `a776a290-f2a9-4171-8a9e-2d7873c3a524` |

---

## 👤 Você  _(mensagem 1)_


Você é um engenheiro de software sênior. Precisa REESCREVER COMPLETAMENTE os arquivos `docs/index.html` e `docs/js/app.js` do projeto `md_recebimentos_extractor`.

O projeto agora tem:
- Autenticação via Firebase Auth (o módulo `window.Auth` já está em `docs/js/auth.js`)
- Backend API Vercel em `/api/recebimentos` e `/api/stats`
- Banco PostgreSQL Neon com tabela `recebimentos`

## `docs/index.html` — REESCREVER COMPLETAMENTE

Use Tailwind CDN + Chart.js CDN. Design idêntico ao atual (sidebar azul, cards, modo dark/light).

### Estrutura HTML obrigatória:

**Head:**
- `<title>MD Recebimentos — Dashboard</title>`
- Tailwind CDN com darkMode: 'class'
- Chart.js CDN
- Link para `css/style.css`
- Config Firebase em `window.FIREBASE_CONFIG = { /* SUBSTITUA */ }`
- SDK Firebase ESM module (importa firebase-app e firebase-auth, cria `window.__firebaseAuth`)
- Script `src="js/auth.js"` 

**Sidebar (igual ao atual)** — mantém as 4 seções: dashboard, run, history, settings. Adicionar item "Dados" (ícone de tabela/banco) com `data-section="dados"`.

**Header** — igual ao atual, mas adicionar à direita:
- Avatar do usuário logado: círculo com inicial do email + email truncado (hidden em mobile)
- Botão "Sair" (chama `Auth.logout()`)

**Seção "dados" — NOVA SEÇÃO (principal nova funcionalidade):**

```html
<section id="section-dados" class="section-content hidden">
  <!-- Barra de filtros -->
  <div id="filtros-bar" ...>
    <!-- select ano (preenchido dinamicamente) -->
    <!-- input busca contratante (debounced 400ms) -->
    <!-- select status_pagamento -->
    <!-- select status_playlist: Todos / Com Playlist / Sem Playlist -->
    <!-- botão Limpar filtros -->
    <!-- botão Exportar CSV -->
  </div>

  <!-- Cards de resumo (carregados via /api/stats) -->
  <div id="stats-neon" class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
    <!-- 4 cards: Total Registros, Pagos, Pendentes, Com Playlist -->
    <!-- IDs: stat-db-total, stat-db-pagos, stat-db-pendentes, stat-db-playlist -->
  </div>

  <!-- Tabela de dados do Neon -->
  <div class="bg-white dark:bg-gray-900 rounded-2xl border ...">
    <!-- header com: "Recebimentos" + contagem total + paginação info -->
    <div id="dados-info-bar">...</div>
    
    <!-- Tabela responsiva -->
    <div class="overflow-x-auto">
      <div id="dados-loading" ...>carregando...</div>
      <table id="dados-table" class="hidden w-full text-sm">
        <thead>
          <tr> <!-- Contratante, Código, Vencimento, Valor, Status, Pago Em, Playlist, Faixas, Período --> </tr>
        </thead>
        <tbody id="dados-tbody"></tbody>
      </table>
    </div>

    <!-- Paginação -->
    <div id="paginacao" class="flex items-center justify-between px-5 py-4 border-t ...">
      <span id="pag-info" class="text-xs text-gray-500">...</span>
      <div class="flex gap-2">
        <button id="btn-anterior" onclick="mudarPagina(-1)">Anterior</button>
        <span id="pag-paginas" class="text-sm">1 / 1</span>
        <button id="btn-proximo" onclick="mudarPagina(1)">Próxima</button>
      </div>
    </div>
  </div>
</section>
```

**Seção Dashboard** — MANTER igual, mas adicionar abaixo dos gráficos existentes um card de stats do Neon:
```html
<div id="neon-preview-card" class="bg-white dark:bg-gray-900 rounded-2xl border ...">
  <h3>Dados no Banco (Neon)</h3>
  <!-- 4 mini-stats: Total, Pagos %, Com Playlist %, Anos disponíveis -->
  <!-- Botão: "Ver tabela completa" → navigateTo('dados') -->
</div>
```

**Manter seções:** run, history, settings (sem alterações)

**Seção settings** — adicionar bloco "Firebase & API" com:
- Input `cfg-api-url` (URL base da API Vercel, ex: `https://meu-app.vercel.app`)
- Campo informativo mostrando email do usuário logado
- Botão "Testar API" (faz GET /api/stats e mostra resultado)

## `docs/js/app.js` — REESCREVER COMPLETAMENTE

**Inicialização obrigatória:**
```javascript
// Verificar auth ANTES de tudo
Auth.init(function(user, token) {
    appUser = user;
    // exibe email no header
    init();
});
```

**Variáveis globais adicionais:**
```javascript
let appUser = null;
let dadosPagAtual = 1;
let dadosFiltros  = { ano:'', contratante:'', status_pagamento:'', status_playlist:'' };
let dadosTotal    = 0;
let dadosTotalPags = 1;
let debounceTimer = null;
```

**Funções obrigatórias NOVAS:**

1. `async function carregarStats()`:
   - GET `/api/stats?ano=${filtroAno}`
   - Com `await Auth.headers()`
   - Preenche os 4 cards do neon-preview-card E os 4 cards da seção "dados"
   - Preenche o select de anos disponíveis

2. `async function carregarDados(pagina = 1)`:
   - Monta URL: `/api/recebimentos?page=${pagina}&limit=50&ano=...&contratante=...&status_pagamento=...&status_playlist=...`
   - Com `await Auth.headers()`
   - Mostra `dados-loading`, esconde tabela
   - Ao receber, chama `renderTabelaDados(rows)` e `renderPaginacao(total, page, pages)`
   - Salva `dadosPagAtual`, `dadosTotal`, `dadosTotalPags`

3. `function renderTabelaDados(rows)`:
   - Renderiza tbody com os dados
   - Colunas: contratante (truncado 20 chars), codigo_contrato, vencimento, valor_parcela, badge status_pagamento (verde=pago, amarelo=pendente, cinza=outros), pago_em, badge status_playlist (azul=Com/cinza=Sem), faixas, periodo
   - Linha sem dados: mensagem vazia
   - Aplica classes zebra: linhas pares `bg-gray-50 dark:bg-gray-800/30`

4. `function renderPaginacao(total, page, pages)`:
   - Atualiza `pag-info`: "Mostrando X-Y de Z registros"
   - Atualiza `pag-paginas`: "5 / 12"
   - Habilita/desabilita `btn-anterior` e `btn-proximo`

5. `function mudarPagina(delta)`:
   - `dadosPagAtual += delta`, chama `carregarDados(dadosPagAtual)`

6. `function aplicarFiltros()`:
   - Lê os selects/inputs da barra de filtros
   - Atualiza `dadosFiltros`
   - Reset página para 1
   - Chama `carregarDados(1)` e `carregarStats()`

7. `function exportarCSV()`:
   - Faz GET `/api/recebimentos?limit=5000&...filtros` (sem paginação)
   - Converte JSON para CSV
   - Faz download automático com `Blob` e `URL.createObjectURL`

8. `async function testarAPI()`:
   - GET `${cfg.apiUrl}/api/stats`
   - Toast de sucesso ou erro

**Manter todas as funções existentes:** loadRuns, triggerWorkflow, renderCharts, navigateTo, toggleTheme, saveSettings, toast, etc.

**Modificar `navigateTo`:**
- Adicionar case `dados`: chama `carregarStats()` e `carregarDados(1)` na primeira visita

**Modificar `saveSettings`:**
- Incluir leitura de `cfg-api-url` → `cfg.apiUrl`
- Default: `''` (usa URL relativa `/api/...` para Vercel)

**Importante sobre URLs da API:**
- Quando `cfg.apiUrl` está vazio: usa `/api/recebimentos` (relativo - funciona em Vercel)
- Quando preenchido: usa `cfg.apiUrl + '/api/recebimentos'` (para desenvolvimento local)

Use `edit_file` com mode `write` para REESCREVER completamente ambos os arquivos. Conteúdo COMPLETO, funcional, sem omissões.


---

## 🤖 Assistente  _(resposta 2)_

> 💭 **Raciocínio interno:** Let me start by exploring the project structure to understand what's already there before rewriting the files.

Vou explorar o projeto primeiro para entender a estrutura atual antes de reescrever.

**Ferramenta:** 📁 `list_directory` — `md_recebimentos_extractor`

**Ferramenta:** 📁 `list_directory` — `md_recebimentos_extractor/docs`

---

## 🤖 Assistente  _(resposta 3)_

**Ferramenta:** 📁 `list_directory` — `md_recebimentos_extractor/docs/js`

**Ferramenta:** 📁 `list_directory` — `md_recebimentos_extractor/docs/css`

**Ferramenta:** 📁 `list_directory` — `md_recebimentos_extractor/api`

---

## 🤖 Assistente  _(resposta 4)_

**Ferramenta:** 📄 `read_file` — `md_recebimentos_extractor/docs/index.html`

**Ferramenta:** 📄 `read_file` — `md_recebimentos_extractor/docs/js/auth.js`

---

## 🤖 Assistente  _(resposta 5)_

> 💭 **Raciocínio interno:** Now let me read the full current index.html and app.js to understand the existing structure and design.

**Ferramenta:** 📄 `read_file` — `md_recebimentos_extractor/docs/index.html`

**Ferramenta:** 📄 `read_file` — `md_recebimentos_extractor/docs/js/app.js`

---

## 🤖 Assistente  _(resposta 6)_

> 💭 **Raciocínio interno:** Let me continue reading the current index.html and app.js to understand the full structure before rewriting.

**Ferramenta:** 📄 `read_file` — `md_recebimentos_extractor/docs/index.html`

**Ferramenta:** 📄 `read_file` — `md_recebimentos_extractor/docs/js/app.js`

---

## 🤖 Assistente  _(resposta 7)_

**Ferramenta:** 📄 `read_file` — `md_recebimentos_extractor/docs/index.html`

**Ferramenta:** 📄 `read_file` — `md_recebimentos_extractor/docs/js/app.js`

---

## 🤖 Assistente  _(resposta 8)_

**Ferramenta:** 📄 `read_file` — `md_recebimentos_extractor/docs/js/app.js`

**Ferramenta:** 📄 `read_file` — `md_recebimentos_extractor/docs/css/style.css`

---

## 🤖 Assistente  _(resposta 9)_

> 💭 **Raciocínio interno:** Now let me also look at the API files to understand what they return:

Agora vou ler os arquivos da API para entender o formato dos dados:

**Ferramenta:** 📄 `read_file` — `md_recebimentos_extractor/api/recebimentos.js`

**Ferramenta:** 📄 `read_file` — `md_recebimentos_extractor/api/stats.js`

---

## 🤖 Assistente  _(resposta 10)_

> 💭 **Raciocínio interno:** Now I have a complete understanding of the project structure. Let me plan the rewrite:  1. **index.html** - Needs to:    - Keep the same design (blue sidebar, cards, dark/light mode)    - Add Firebase Auth initialization (ESM module)    - Add window.FIREBASE_CONFIG    - Add `src="js/auth.js"`    - S…

**Ferramenta:** 📁 `list_directory` — `md_recebimentos_extractor/sql`

**Ferramenta:** 📄 `read_file` — `md_recebimentos_extractor/docs/login.html`

---

## 🤖 Assistente  _(resposta 11)_

**Ferramenta:** 📄 `read_file` — `md_recebimentos_extractor/sql/schema.sql`

---

## 🤖 Assistente  _(resposta 12)_

> 💭 **Raciocínio interno:** Now I have a full picture of the project. Let me write both files completely.  ### index.html Plan: 1. Head:    - Meta tags    - Title: "MD Recebimentos — Dashboard"    - Tailwind CDN with config (darkMode: 'class', colors: brand)    - Chart.js CDN    - Link to css/style.css    - window.FIREBASE_CON…

Tenho toda a informação necessária. Agora vou reescrever ambos os arquivos completamente:

**Ferramenta:** ✏️ `edit_file` — `md_recebimentos_extractor/docs/index.html`

---
