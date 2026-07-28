# 🧑🏻‍💻​ MD Extractor

Automação completa para extração de dados do sistema Music Delivery, incluindo **Recebimentos** e **Contratos**, com dashboard web, GitHub Actions e notificações via Telegram.

## 🚀 Características Principais

- ✅ **Extração Automática**: Login e navegação automatizada no sistema
- ✅ **Recebimentos**: Extração de parcelas com análise de playlists
- ✅ **Contratos**: Extração completa com alertas de vencimento
- ✅ **Dashboard Web**: Interface moderna com gráficos e filtros
- ✅ **Processamento Multi-Ano**: Execução em paralelo para recebimentos
- ✅ **Sistema de Retry**: Tentativas automáticas para links com falha
- ✅ **Notificações Telegram**: Relatórios detalhados
- ✅ **Banco de Dados**: Neon PostgreSQL com views para alertas

## 📋 Estrutura do Projeto

```
md_extractor/
├── .github/
│   └── workflows/
│       ├── recebimentos.yml       # Workflow de extração de recebimentos
│       └── contratos.yml          # Workflow de extração de contratos
├── api/                           # Backend Vercel (serverless functions)
│   ├── _lib/
│   │   ├── auth.js                # Firebase Admin Auth
│   │   ├── db.js                  # Conexão PostgreSQL (Neon)
│   │   └── github.js              # Cliente GitHub API
│   ├── recebimentos.js            # GET/DELETE /api/recebimentos
│   ├── contratos.js               # GET/DELETE /api/contratos
│   ├── stats.js                   # GET /api/stats
│   └── ...
├── public/                        # Frontend SPA (Vercel)
│   ├── index.html                 # Dashboard principal
│   ├── login.html                 # Página de login
│   ├── css/style.css              # Estilos customizados
│   └── js/
│       ├── app.js                 # Lógica principal
│       ├── auth.js                # Firebase Auth
│       └── firebase-init.js       # Firebase SDK
├── python_extractor/
│   ├── client_recebimentos.py     # Extrator de recebimentos
│   ├── client_contratos.py        # Extrator de contratos
│   └── requirements.txt           # Dependências Python
├── sql/
│   └── schema.sql                 # Schema PostgreSQL
└── README.md
```

## ⚙️ Configuração

### 1. Secrets do Repositório

| Secret | Descrição |
|--------|-----------|
| `BOT_TOKEN` | Token do bot Telegram |
| `CLIENT_EMAIL` | Email de login do sistema MD |
| `CLIENT_SENHA` | Senha do sistema MD |
| `DEFAULT_CHAT_ID` | Chat ID padrão do Telegram |
| `DATABASE_URL` | Connection string do Neon PostgreSQL |
| `GITHUB_TOKEN` | Token de acesso ao GitHub |
| `FIREBASE_SERVICE_ACCOUNT` | JSON do service account Firebase |

### 2. Deploy no Vercel

1. Conecte o repositório ao Vercel
2. Configure as variáveis de ambiente
3. Deploy automático a cada push

## 🎯 Módulos

### 📊 Recebimentos

Extração de parcelas de royalties com análise de playlists.

```bash
# Extração via GitHub Actions
# Workflow: recebimentos.yml
# Inputs: anos (ex: "2024,2025")
```

### 📋 Contratos

Extração de contratos com alertas de vencimento.

```bash
# Extração via GitHub Actions
# Workflow: contratos.yml
# Inputs: chat_id (opcional)
```

**Dados extraídos:**
- Código do contrato
- Contratante
- Alias/Matriz
- Data de início e término
- Forma de envio
- Status (Ativo/Inativo)

**Alertas de vencimento:**
- Contratos vencidos
- Vencimento em 30 dias
- Vencimento em 60 dias
- Vencimento em 90 dias

## 📊 API Endpoints

### Recebimentos
- `GET /api/recebimentos` - Listar com filtros e paginação
- `DELETE /api/recebimentos` - Excluir registros

### Contratos
- `GET /api/contratos` - Listar com filtros
- `GET /api/contratos?alerta=1` - Contratos vencendo em 90 dias
- `GET /api/contratos?grafico=1` - Vencimentos por mês
- `GET /api/contratos?stats=1` - Estatísticas (total/ativos/inativos)
- `DELETE /api/contratos` - Excluir registros

### Geral
- `GET /api/stats` - Estatísticas de recebimentos

## 🗄️ Banco de Dados

### Tabelas

- `recebimentos` - Parcelas de royalties
- `contratos` - Contratos extraídos

### Views

- `v_stats_por_ano` - Estatísticas por ano
- `v_status_distribuicao` - Distribuição por status
- `v_contratos_alerta` - Contratos vencendo em 90 dias
- `v_contratos_por_mes` - Vencimentos por mês

## 📱 Frontend

Dashboard SPA com:

- **Dashboard**: Gráficos de recebimentos e execuções
- **Executar**: Trigger de extrações via GitHub Actions
- **Histórico**: Log de todas as execuções
- **Dados**: Navegação por dados de recebimentos
- **Contratos**: Alertas de vencimento, gráfico por mês, tabela completa
- **Configurações**: Repo GitHub, Firebase, API

## 🐛 Solução de Problemas

### Erro de Login
Verifique `CLIENT_EMAIL` e `CLIENT_SENHA` nos secrets.

### Timeout
Workflows têm timeout de 60-90 minutos. Divida o processamento se necessário.

### Banco de Dados
Execute o `sql/schema.sql` para criar/atualizar tabelas e views.

## 🆕 Atualizações

### v3.0 - Contratos & Dashboard (Julho 2026)
- ✅ **Módulo de Contratos**: Extração e análise de contratos
- ✅ **Alertas de Vencimento**: 30, 60, 90 dias
- ✅ **Gráfico de Vencimentos**: Por mês
- ✅ **Renomeação**: Projeto renomeado para md_extractor

### v2.1 - Dashboard & History UI (Maio 2026)
- ✅ Interface de histórico com dropdown de anos
- ✅ Exibição de dados da última execução no Dashboard

### v2.0 - Multi-Year Support (Abril 2026)
- ✅ Suporte multi-ano para recebimentos
- ✅ Estrutura reorganizada

---

## 📸 Galeria

### Dashboards

![Painel de Recebimentos](media/Painel%20Recebimentos.gif)

![Painel de Contratos](media/Painel%20Contratos.gif)

### Relatórios

![Relatório de Recebimentos](media/Relatorio%20Recebimentos.png)

![Relatório de Recebimentos (2)](media/Relatorio%20Recebimentos1.png)

---

*Última atualização: Julho 2026*
