# Criar login.html e auth.js (Firebase)

| Campo | Valor |
|-------|-------|
| **Conversa** | 5 de 6 |
| **Criada em** | 11/05/2026 15:47 |
| **Atualizada** | 11/05/2026 15:50 |
| **Mensagens** | 9 (1 suas · 8 do assistente) |
| **ID** | `95082d4b-9375-49b0-8d3c-c7be54e28f06` |

---

## 👤 Você  _(mensagem 1)_


Crie os seguintes arquivos de autenticação Firebase para o projeto `md_recebimentos_extractor`.

## 1. Criar `md_recebimentos_extractor/docs/login.html`

Página de login com design moderno (dark/light mode). Use APENAS Tailwind CDN (sem frameworks).

Estrutura visual:
- Layout centralizado na tela (flex min-h-screen)
- Coluna esquerda (hidden lg:flex) com gradiente azul/indigo, logo MD Recebimentos, texto descritivo sobre o sistema
- Coluna direita: card branco com formulário de login
- Logo no topo do card (ícone música + "MD Recebimentos")
- Título "Entrar na sua conta"
- Input email com ícone
- Input senha com toggle mostrar/esconder + ícone
- Checkbox "Lembrar minha sessão" (usando Firebase `setPersistence`)
- Botão "Entrar" com gradiente azul/indigo, loading state
- Mensagem de erro (div oculto, aparece em caso de falha)
- Sem link "criar conta" (sistema fechado, usuários cadastrados manualmente)
- Footer: "Sistema de uso interno · Music Delivery"

JavaScript inline na página (não use arquivo externo ainda):
- Carrega Firebase via CDN ESM: `https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js` e `firebase-auth.js`
- Config do Firebase lida de `window.FIREBASE_CONFIG` (que será um objeto JS definido no HTML com placeholder)
  ```html
  <script>
    window.FIREBASE_CONFIG = {
      apiKey: "SEU_API_KEY",
      authDomain: "SEU_PROJECT.firebaseapp.com",
      projectId: "SEU_PROJECT_ID",
      // etc
    };
  </script>
  ```
  Com comentário: "SUBSTITUA com os dados do seu projeto Firebase"
- `signInWithEmailAndPassword` ao submeter
- `onAuthStateChanged`: se já logado, redireciona para `index.html`
- Ao logar com sucesso: salva token no sessionStorage e redireciona para `index.html`
- Erros mapeados para PT-BR:
  - `auth/user-not-found` → "Usuário não encontrado"
  - `auth/wrong-password` → "Senha incorreta"
  - `auth/invalid-credential` → "Credenciais inválidas"
  - `auth/too-many-requests` → "Muitas tentativas. Aguarde alguns minutos."
  - default → "Erro ao fazer login. Tente novamente."
- Animação de loading no botão (substituir texto por spinner SVG)

## 2. Criar `md_recebimentos_extractor/docs/js/auth.js`

Módulo JavaScript (não-ES module, vanilla JS compatível com script src normal) para gerenciar autenticação Firebase nas páginas protegidas.

Variáveis e funções exportadas como globais (window.Auth = {...}):

```javascript
window.Auth = {
  user: null,
  token: null,
  
  // Inicializa Firebase e verifica se está logado
  // Se não logado, redireciona para login.html
  // Se logado, seta Auth.user e Auth.token, chama callback(user, token)
  init(callback),
  
  // Retorna o token atualizado (chama getIdToken(true) se expirado)
  async getToken(),
  
  // Faz logout e redireciona para login.html
  async logout(),
  
  // Retorna headers para fetch com Authorization Bearer
  async headers()
}
```

Implementação:
- Carrega Firebase via CDN tag script (assume que login.html já carregou o SDK, mas adiciona verificação)
- `init(callback)`: usa `onAuthStateChanged`. Se `user === null`, redireciona para `login.html`. Se logado, chama `user.getIdToken()` e passa para callback.
- `getToken()`: chama `currentUser.getIdToken(false)` — Firebase renova automaticamente quando necessário
- `logout()`: chama `signOut()` e redireciona para `login.html`
- Inclui comentário no topo explicando que o Firebase SDK deve ser carregado antes deste script

Use `edit_file` com mode `write` para criar os arquivos. Conteúdo completo e funcional.


---

## 🤖 Assistente  _(resposta 2)_

> 💭 **Raciocínio interno:** Let me first explore the project structure to understand what already exists.

**Ferramenta:** 📁 `list_directory` — `md_recebimentos_extractor`

---

## 🤖 Assistente  _(resposta 3)_

**Ferramenta:** 📁 `list_directory` — `md_recebimentos_extractor/docs`

---

## 🤖 Assistente  _(resposta 4)_

**Ferramenta:** 📁 `list_directory` — `md_recebimentos_extractor/docs/js`

**Ferramenta:** 📄 `read_file` — `md_recebimentos_extractor/docs/index.html`

---

## 🤖 Assistente  _(resposta 5)_

> 💭 **Raciocínio interno:** Let me read a few key sections of the index.html to understand the design patterns used, then create the login.html and auth.js files.

**Ferramenta:** 📄 `read_file` — `md_recebimentos_extractor/docs/index.html`

**Ferramenta:** 📄 `read_file` — `md_recebimentos_extractor/docs/js/app.js`

---

## 🤖 Assistente  _(resposta 6)_

> 💭 **Raciocínio interno:** Now I have a good understanding of the project structure. Let me look at the CSS file to understand the styling patterns used.

**Ferramenta:** 📁 `list_directory` — `md_recebimentos_extractor/docs/css`

---

## 🤖 Assistente  _(resposta 7)_

**Ferramenta:** 📄 `read_file` — `md_recebimentos_extractor/docs/css/style.css`

---

## 🤖 Assistente  _(resposta 8)_

> 💭 **Raciocínio interno:** Now I have a comprehensive understanding of the project structure and design patterns. Let me create the two files:  1. `docs/login.html` - A full-featured login page with Firebase authentication 2. `docs/js/auth.js` - An auth module for protecting pages  Let me create these files now.  For `login.h…

Agora tenho tudo que preciso para criar os arquivos. Vou criar ambos em paralelo.

**Ferramenta:** ✏️ `edit_file` — `md_recebimentos_extractor/docs/login.html`

**Ferramenta:** ✏️ `edit_file` — `md_recebimentos_extractor/docs/js/auth.js`

---

## 🤖 Assistente  _(resposta 9)_

Os dois arquivos foram criados com sucesso. Veja um resumo completo do que foi implementado:

---

## Arquivos criados

### `docs/login.html` — 557 linhas

**Layout:**
- Dois painéis lado a lado: coluna esquerda com gradiente `from-blue-700 via-blue-800 to-indigo-900` (visível apenas em `lg+`) e coluna direita com o formulário
- A coluna esquerda tem 3 círculos decorativos animados no fundo, logo, headline em 3 linhas, lista de recursos com ícones de check, e copyright no rodapé
- O card do formulário entra com uma animação `fadeInUp` suave

**Formulário:**
- Logo com gradiente e ícone de nota musical no topo do card
- Input de e-mail com ícone de envelope à esquerda
- Input de senha com ícone de cadeado à esquerda e toggle olho aberto/fechado à direita
- Checkbox "Lembrar minha sessão" conectado ao `setPersistence` do Firebase (`browserLocalPersistence` vs `browserSessionPersistence`)
- Botão com gradiente, `disabled:opacity-60`, troca o texto pelo spinner SVG animado durante o loading
- Caixa de erro vermelha oculta por padrão, aparece com `flex` ao falhar

**Firebase (ESM module inline):**
- Importa `firebase-app.js` e `firebase-auth.js` via `https://www.gstatic.com/firebasejs/10.12.2/`
- Lê a config de `window.FIREBASE_CONFIG` (bloco com placeholders e comentário de instrução)
- `onAuthStateChanged` logo na inicialização — redireciona para `index.html` se já logado
- Todos os 7 códigos de erro mapeados para PT-BR + fallback genérico

**Extras:**
- Botão de tema (lua/sol) no canto superior direito, persiste no `localStorage`
- Respeita `prefers-color-scheme` do sistema operacional na primeira visita

---

### `docs/js/auth.js` — 236 linhas

**Arquitetura:**
- IIFE `(function(global) { ... })(window)` — não polui o namespace global além de `window.Auth`
- Compatível com `<script src="js/auth.js">` normal (não é ES module)

**`waitForAuth()`** (interno):
- Faz polling de 100ms × 50 tentativas (~5s) em `window.__firebaseAuth`
- Retorna uma Promise, desacopla completamente do timing de carregamento do SDK

**API pública `window.Auth`:**

| Método | Descrição |
|---|---|
| `Auth.init(cb)` | `onAuthStateChanged` → redireciona para login se `null`; caso autenticado, chama `cb(user, token)` |
| `Auth.getToken()` | `Promise<string>` — `getIdToken(false)`, Firebase renova quando necessário |
| `Auth.logout()` | `signOut()` + limpa sessionStorage + `location.replace('login.html')` |
| `Auth.headers()` | `Promise<object>` com `Authorization: Bearer <token>`, `Content-Type` e `Accept` |

**`redirectToLogin()`** (interno): preserva a URL atual como `?next=` para redirecionamento pós-login.

---

### Próximo passo: integrar ao `index.html`

Para proteger o `index.html`, você precisa adicionar no `<head>`:

```md_recebimentos_extractor/docs/index.html#L1-1
<!-- 1. Configuração Firebase (antes de tudo) -->
<script>
  window.FIREBASE_CONFIG = { /* mesmos dados do login.html */ };
</script>

<!-- 2. Inicializa Firebase e expõe auth -->
<script type="module">
  import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
  import { getAuth } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
  const app = initializeApp(window.FIREBASE_CONFIG);
  window.__firebaseAuth = getAuth(app);
</script>

<!-- 3. Módulo de autenticação -->
<script src="js/auth.js"></script>
```

E no início do `app.js`:
```md_recebimentos_extractor/docs/js/app.js#L1-1
Auth.init(function(user, token) {
    // app inicializa aqui com usuário autenticado
});
```

---
