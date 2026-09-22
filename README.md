# 🧑🏻‍💻 MD Extractor

> Plataforma de automação, processamento e análise de dados do sistema Music Delivery, desenvolvida para transformar informações de **Recebimentos e Contratos** em dados estruturados, indicadores e alertas para acompanhamento operacional.

## 🎯 Problema de Negócio

O acompanhamento de informações de **recebimentos de royalties e contratos** exigia consultas e extrações realizadas diretamente no sistema Music Delivery.

Esse processo apresentava desafios como:

* 📋 necessidade de consultar grandes volumes de registros;
* ⏳ tempo elevado para realizar extrações manualmente;
* 🔎 dificuldade para consolidar informações de diferentes períodos;
* 📊 necessidade de organizar os dados para análise;
* 📅 dificuldade para acompanhar contratos próximos do vencimento;
* 🚨 necessidade de identificar rapidamente contratos vencidos ou próximos do vencimento;
* 📈 necessidade de transformar dados extraídos em indicadores para acompanhamento.

O problema central era transformar informações disponíveis no sistema operacional em **dados estruturados, pesquisáveis e úteis para análise e acompanhamento administrativo**.

---

## 💡 Solução Desenvolvida

Foi desenvolvido um processo automatizado capaz de realizar:

```text
Sistema Music Delivery
        ↓
Login e navegação automatizados
        ↓
Extração de dados
        ↓
Processamento e tratamento
        ↓
PostgreSQL / Neon
        ↓
Views e indicadores
        ↓
Dashboard Web
        ↓
Análise + Alertas + Relatórios
```

A solução combina **Python, automação web, PostgreSQL, GitHub Actions e um dashboard web** para transformar a extração de dados em um fluxo automatizado de análise.

---

## 📊 Dados Processados

O projeto trabalha principalmente com dois conjuntos de dados:

### 💰 Recebimentos

Dados relacionados às parcelas de royalties, incluindo informações utilizadas para análise de períodos e playlists.

### 📋 Contratos

Informações contratuais utilizadas para acompanhamento administrativo e identificação de vencimentos.

Entre os dados extraídos estão:

* Código do contrato;
* Contratante;
* Alias/Matriz;
* Data de início;
* Data de término;
* Forma de envio;
* Status;
* Informações relacionadas aos recebimentos.

---

## 📈 Indicadores e Análises

Os dados processados são utilizados para gerar informações como:

### Recebimentos

* estatísticas por ano;
* quantidade de registros;
* acompanhamento de parcelas;
* análise de playlists;
* histórico das execuções de extração.

### Contratos

* total de contratos;
* contratos ativos;
* contratos inativos;
* contratos vencidos;
* contratos próximos do vencimento;
* distribuição de vencimentos por mês;
* contratos com vencimento em 30, 60 e 90 dias.

Esses indicadores permitem transformar dados operacionais em uma **visão consolidada para acompanhamento**.

---

## 🚨 Alertas de Vencimento

Um dos principais recursos do projeto é a identificação automática de contratos que exigem acompanhamento.

Os contratos são classificados de acordo com a proximidade do vencimento:

```text
Contrato
   │
   ├── Vencido
   │
   ├── Vencimento ≤ 30 dias
   │
   ├── Vencimento ≤ 60 dias
   │
   └── Vencimento ≤ 90 dias
```

Essa classificação permite identificar antecipadamente contratos que podem demandar alguma ação administrativa.

---

## 📈 Resultado

A automação transforma um processo de consulta e consolidação de informações em um fluxo estruturado de dados.

Entre os principais ganhos proporcionados pela solução:

* ⚡ redução de tarefas manuais de extração;
* 📊 centralização dos dados em PostgreSQL;
* 🔎 facilidade para consultar e filtrar informações;
* 📈 criação de indicadores para acompanhamento;
* 📅 visão consolidada dos vencimentos;
* 🚨 identificação antecipada de contratos próximos do vencimento;
* 📱 disponibilização de relatórios e notificações;
* 🔄 possibilidade de executar extrações de diferentes períodos automaticamente.

> **Nota:** os ganhos acima representam funcionalidades e melhorias observáveis proporcionadas pela automação. Não são apresentados percentuais de produtividade sem uma medição formal do processo antes e depois da implementação.

---

# 🧠 Visão de Dados

O projeto segue um fluxo semelhante a um pipeline de dados:

```text
             COLETA
                ↓
      Sistema Music Delivery
                ↓
           EXTRAÇÃO
                ↓
       Python + Playwright
                ↓
         PROCESSAMENTO
                ↓
        Tratamento dos dados
                ↓
        ARMAZENAMENTO
                ↓
       Neon PostgreSQL
                ↓
       REGRAS DE NEGÓCIO
                ↓
     Alertas + classificações
                ↓
           INDICADORES
                ↓
           Dashboard
                ↓
       Análise e acompanhamento
```

Essa arquitetura permite separar a etapa de **coleta** da etapa de **análise**, facilitando a reutilização dos dados posteriormente.

---

# 🚀 Características Principais

* ✅ **Extração Automática:** login e navegação automatizados no sistema;
* 💰 **Recebimentos:** extração de parcelas com análise de playlists;
* 📋 **Contratos:** extração completa com acompanhamento de vencimentos;
* 📊 **Dashboard Web:** interface com gráficos, filtros e indicadores;
* 📅 **Processamento Multi-Ano:** execução de recebimentos para diferentes anos;
* 🔁 **Sistema de Retry:** novas tentativas automáticas para links com falha;
* 📱 **Notificações Telegram:** envio de relatórios;
* 🗄️ **Banco de Dados:** Neon PostgreSQL;
* 📈 **Views Analíticas:** consultas preparadas para indicadores e alertas;
* ⚙️ **GitHub Actions:** execução automatizada dos processos.

---

# 📋 Módulos

## 💰 Recebimentos

O módulo realiza a extração de parcelas de royalties e informações relacionadas às playlists.

A execução pode receber múltiplos anos:

```text
2024,2025
```

Isso permite processar diferentes períodos sem precisar executar manualmente cada ano de forma isolada.

### Fluxo

```text
Ano selecionado
      ↓
Acesso ao sistema
      ↓
Extração dos recebimentos
      ↓
Processamento
      ↓
Armazenamento PostgreSQL
      ↓
Indicadores / Dashboard
```

---

## 📋 Contratos

O módulo realiza a extração e organização das informações contratuais.

### Dados extraídos

* Código do contrato;
* Contratante;
* Alias/Matriz;
* Data de início;
* Data de término;
* Forma de envio;
* Status:

  * Ativo;
  * Inativo.

### Alertas

O sistema permite identificar:

* contratos vencidos;
* contratos com vencimento em até 30 dias;
* contratos com vencimento em até 60 dias;
* contratos com vencimento em até 90 dias.

---

# 📊 Dashboard

O projeto possui uma aplicação web para consulta e análise dos dados.

## Dashboard

Apresenta:

* gráficos de recebimentos;
* estatísticas das execuções;
* indicadores consolidados;
* informações da última execução.

## Executar

Permite acionar novas extrações por meio dos workflows do GitHub Actions.

## Histórico

Apresenta o histórico das execuções realizadas.

## Dados

Permite navegar pelos registros de recebimentos.

## Contratos

Disponibiliza:

* tabela de contratos;
* filtros;
* alertas de vencimento;
* gráfico de vencimentos por mês;
* indicadores de contratos ativos/inativos.

## Configurações

Área relacionada à configuração de:

* repositório GitHub;
* Firebase;
* API.

---

# 🏗️ Arquitetura do Projeto

```text
                         ┌─────────────────────┐
                         │ Music Delivery      │
                         │ Sistema de origem   │
                         └──────────┬──────────┘
                                    │
                                    ▼
                         ┌─────────────────────┐
                         │ Python Extractor    │
                         │ Playwright          │
                         └──────────┬──────────┘
                                    │
                                    ▼
                         ┌─────────────────────┐
                         │ Processamento       │
                         │ e tratamento        │
                         └──────────┬──────────┘
                                    │
                                    ▼
                         ┌─────────────────────┐
                         │ Neon PostgreSQL     │
                         │ Dados + Views       │
                         └──────────┬──────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
             ┌───────────┐   ┌────────────┐   ┌───────────┐
             │ Dashboard │   │ Telegram   │   │ API       │
             │ Web       │   │ Relatórios │   │ Vercel    │
             └───────────┘   └────────────┘   └───────────┘
```

---

# 📁 Estrutura do Projeto

```text
md_extractor/
├── .github/
│   └── workflows/
│       ├── recebimentos.yml
│       └── contratos.yml
│
├── api/
│   ├── _lib/
│   │   ├── auth.js
│   │   ├── db.js
│   │   └── github.js
│   ├── recebimentos.js
│   ├── contratos.js
│   ├── stats.js
│   └── ...
│
├── public/
│   ├── index.html
│   ├── login.html
│   ├── css/
│   │   └── style.css
│   └── js/
│       ├── app.js
│       ├── auth.js
│       └── firebase-init.js
│
├── python_extractor/
│   ├── client_recebimentos.py
│   ├── client_contratos.py
│   └── requirements.txt
│
├── sql/
│   └── schema.sql
│
└── README.md
```

---

# 🗄️ Banco de Dados

O projeto utiliza **Neon PostgreSQL** para armazenamento e consulta dos dados.

## Tabelas

### `recebimentos`

Armazena informações relacionadas às parcelas de royalties.

### `contratos`

Armazena os contratos extraídos do sistema.

## Views Analíticas

### `v_stats_por_ano`

Consolida estatísticas de recebimentos por ano.

### `v_status_distribuicao`

Apresenta a distribuição dos registros por status.

### `v_contratos_alerta`

Identifica contratos que estão dentro da janela de alerta.

### `v_contratos_por_mes`

Permite analisar a distribuição dos vencimentos por mês.

As views ajudam a separar a lógica de consulta e consolidação da camada responsável pela apresentação dos dados.

---

# 🔌 API

## Recebimentos

### Listagem

```http
GET /api/recebimentos
```

Suporta filtros e paginação.

### Exclusão

```http
DELETE /api/recebimentos
```

---

## Contratos

### Listagem

```http
GET /api/contratos
```

### Contratos em alerta

```http
GET /api/contratos?alerta=1
```

### Vencimentos por mês

```http
GET /api/contratos?grafico=1
```

### Estatísticas

```http
GET /api/contratos?stats=1
```

### Exclusão

```http
DELETE /api/contratos
```

---

## Geral

### Estatísticas de recebimentos

```http
GET /api/stats
```

---

# ⚙️ Automação

O projeto utiliza **GitHub Actions** para executar os processos de extração.

## Recebimentos

Workflow:

```text
.github/workflows/recebimentos.yml
```

Responsável pela extração dos dados de recebimentos.

Pode receber anos como entrada:

```text
2024,2025
```

## Contratos

Workflow:

```text
.github/workflows/contratos.yml
```

Responsável pela extração e processamento dos contratos.

Pode receber um `chat_id` para envio dos relatórios via Telegram.

---

# 🔁 Retry e Resiliência

Durante a extração podem ocorrer falhas temporárias em links ou páginas.

O sistema possui mecanismo de retry para realizar novas tentativas automaticamente.

```text
Tentativa
   ↓
Falha?
   │
   ├── Não → Processa normalmente
   │
   └── Sim
        ↓
     Retry
        ↓
     Nova tentativa
```

Isso reduz a necessidade de intervenção manual em falhas transitórias.

---

# 📱 Notificações Telegram

O projeto utiliza o Telegram para enviar relatórios relacionados às execuções.

Os relatórios podem incluir informações sobre:

* execução realizada;
* quantidade de registros processados;
* situação da extração;
* erros;
* resultados do processamento.

---

# 🔐 Configuração

## Secrets do Repositório

Configure os seguintes secrets no GitHub:

| Secret                     | Descrição                                  |
| -------------------------- | ------------------------------------------ |
| `BOT_TOKEN`                | Token do bot Telegram                      |
| `CLIENT_EMAIL`             | E-mail de acesso ao sistema Music Delivery |
| `CLIENT_SENHA`             | Senha do sistema Music Delivery            |
| `DEFAULT_CHAT_ID`          | Chat ID padrão do Telegram                 |
| `DATABASE_URL`             | Connection string do Neon PostgreSQL       |
| `GITHUB_TOKEN`             | Token de acesso ao GitHub                  |
| `FIREBASE_SERVICE_ACCOUNT` | JSON da conta de serviço Firebase          |

> Credenciais e tokens não devem ser armazenados diretamente no código-fonte.

---

# 🌐 Deploy no Vercel

O dashboard e as APIs podem ser publicados utilizando o Vercel.

### Configuração

1. Conecte o repositório ao Vercel.
2. Configure as variáveis de ambiente.
3. Execute o deploy.
4. O deploy poderá ser atualizado automaticamente a cada push.

---

# 🧪 Execução e Operação

O fluxo operacional pode ser resumido em:

```text
1. Agendamento ou acionamento manual
              ↓
2. GitHub Actions inicia o workflow
              ↓
3. Python realiza login
              ↓
4. Playwright navega pelo sistema
              ↓
5. Dados são extraídos
              ↓
6. Dados são processados
              ↓
7. PostgreSQL recebe os registros
              ↓
8. Views atualizam indicadores
              ↓
9. Dashboard disponibiliza os dados
              ↓
10. Telegram envia o relatório
```

---

# 🐛 Solução de Problemas

## Erro de Login

Verifique:

```text
CLIENT_EMAIL
CLIENT_SENHA
```

nos secrets do repositório.

## Timeout

Os workflows possuem limites de execução. Para grandes volumes de dados, pode ser necessário dividir o processamento em períodos menores.

## Banco de Dados

Execute:

```text
sql/schema.sql
```

para criar ou atualizar tabelas e views.

## Falhas de Extração

Verifique os logs do GitHub Actions e o mecanismo de retry antes de executar o processo novamente manualmente.

---

# 🧠 Competências Demonstradas

Este projeto demonstra conhecimentos aplicados em:

* 📊 Análise e organização de dados;
* 🐍 Python;
* 🐼 Processamento de dados;
* 🔎 Web scraping e automação;
* 📅 Análise temporal;
* 🗄️ PostgreSQL;
* 📈 Construção de indicadores;
* 🔄 Pipelines de dados;
* ⚙️ GitHub Actions;
* 🌐 APIs;
* 🔐 Autenticação;
* 📱 Integração com Telegram;
* ☁️ Deploy em Vercel;
* 🖥️ Desenvolvimento de dashboards;
* 🚨 Regras de negócio e alertas.

---

# 🆕 Histórico de Atualizações

## v3.0 — Contratos & Dashboard — Julho/2026

* ✅ módulo de contratos;
* ✅ análise de contratos;
* ✅ alertas de vencimento em 30, 60 e 90 dias;
* ✅ gráfico de vencimentos por mês;
* ✅ evolução do projeto para `md_extractor`.

## v2.1 — Dashboard & History UI — Maio/2026

* ✅ interface de histórico;
* ✅ seleção de anos;
* ✅ exibição dos dados da última execução no dashboard.

## v2.0 — Multi-Year Support — Abril/2026

* ✅ suporte a múltiplos anos para recebimentos;
* ✅ reorganização da estrutura do projeto.

---

# 📸 Galeria

### Dashboards

![Painel de Recebimentos](media/Painel%20Recebimentos.gif)

![Painel de Contratos](media/Painel%20Contratos.gif)

### Relatórios

![Relatório de Recebimentos](media/Relatorio%20Recebimentos.png)

![Relatório de Recebimentos (2)](media/Relatorio%20Recebimentos1.png)

---

# 🔮 Possíveis Evoluções

Algumas evoluções possíveis para o projeto:

* criação de novos indicadores financeiros;
* análise histórica dos recebimentos;
* indicadores de contratos por período;
* alertas configuráveis;
* integração com outras fontes de dados;
* análises de tendência;
* indicadores de SLA;
* consolidação de diferentes fontes em um único pipeline;
* evolução para uma arquitetura de dados mais robusta.

---

# 📌 Resumo do Projeto

O **MD Extractor** transforma um processo de extração de informações operacionais em um fluxo automatizado de dados.

```text
                 PROBLEMA
                    ↓
       Extrações e consultas manuais
                    ↓
                SOLUÇÃO
                    ↓
       Automação + processamento
                    ↓
                  DADOS
                    ↓
          PostgreSQL + Views
                    ↓
               INDICADORES
                    ↓
          Dashboard + Alertas
                    ↓
                RESULTADO
                    ↓
       Informação estruturada para
       acompanhamento operacional
```

O projeto demonstra a aplicação prática de **automação, dados, banco de dados, regras de negócio e visualização** para resolver um problema operacional real.

---

*Última atualização: Setembro de 2026*
