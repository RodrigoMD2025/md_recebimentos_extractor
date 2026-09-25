# AGENTS.md — Session Summary

## Goal
Fix production app (Recebimentos/Contratos sections), align local server with production API format, add weekly contracts card + bar chart click filter, and deliver the "Sem Atualização" menu — a per-cycle list of clients that require action.

## Constraints & Preferences
- All API endpoints must return valid JSON, not HTML.
- Local test server (`server_local.js`) must mirror production API response shapes.
- Changes tested locally on `http://localhost:3456`, then pushed to GitHub for Vercel auto-deploy.

## Progress
### Done
- **"Sem Atualização" reescrito sobre o ciclo real (anual).** Medir "meses sem pagamento" estava errado: com contratos de 0–11 meses e intervalo mediano de 366 dias entre contratos do mesmo cliente, 6 meses sem pagamento é o fim normal de um ciclo. A lista agora tem 4 segmentos:
  - `atraso` (prio 1, cobrança): parcela com vencimento JÁ PASSADO e não paga
  - `ciclo_encerrado` (prio 2, renegociação): ciclo terminou e o cliente não assinou outro
  - `nunca_pagou` (prio 3): parcelas emitidas, nenhuma paga
  - `sem_faturamento` (prio 4): contrato Ativo que nunca emitiu parcela
  - Cliente com `reassinou_depois` sai da lista (é lead, não caso perdido). Toggle "incluir reativados" para auditoria.
- View `v_sem_atualizacao` reescrita: colunas `situacao`, `prioridade`, `ciclo_fechado`, `reassinou_depois`, `inicio_novo_contrato`, `fim_contrato`, `dias_sem_contrato`, `dias_atraso`, `parcelas_vencidas`, `valor_vencido`, `valor_referencia`.
- `api/sem-atualizacao.js`: filtro `?dias=` (90/180/365/730) substitui `?meses=`; cards contam sempre os 4 segmentos (navegação) via segunda query; `NULLS LAST` explícito.
- Removed 6 stray closing braces in `public/js/app.js` that caused SyntaxError (commit `9313651`, deployed).
- Reverted `DEFAULT_REPO` from `md_extractor` to `md_recebimentos_extractor` in `api/_lib/github.js` (commit `8a17fb0`, deployed).
- Updated `server_local.js` `/api/stats` and `/api/recebimentos` to match production response format (views `v_stats_por_ano`, `v_status_distribuicao`, pagination, filters, summary).
- Added `signOut` and `toggleYearTag()` to mock auth and frontend.
- Replaced "Vencidos" card with "Esta Semana (dom–sáb)" card in Contracts section.
- Added `?semana=1` handler to both `api/contratos.js` and `server_local.js`.
- Production app now working: all sections show live data after login.
- Added `?mes=MM/YYYY` filter to contratos API for bar chart click filtering.
- Added `onClick` handler to Chart.js bar chart to filter contracts table by month.
- Added `ct-filtro-mes-label` span to show active month filter in UI.
- Updated `limparFiltrosContratos()` to also clear the mes filter.

### In Progress
- Testing locally before committing.

### Blocked
- (none)

## Key Decisions
- Removed "Vencidos" card because overdue contracts are less actionable than current-week expirations.
- `server_local.js` kept in `.gitignore` (local dev tool only); produção API files (`api/`) committed normally.

## Next Steps
- Validar o menu reescrito no navegador em producao.
- Investigar a extracao: 214 Inativos com `data_termino = 'Não definido'`, 44 contratantes vazios, 2 registros orfaos de R$ 330k.

## Critical Context
- Repo: `RodrigoMD2025/md_recebimentos_extractor` (NOT `md_extractor`).
- Production: `https://md-recebimentos-extractor.vercel.app/` — Vercel auto-deploys from `main`.
- Local: `http://localhost:3456` — mock auth bypasses Firebase; requires `DATABASE_URL` env var.
- DB has ~3968 recebimentos, 2347 contratos (2121 Ativo / 226 Inativo); view `v_contratos_por_mes` powers the bar chart.
- Ciclo anual confirmado: duracao p25/mediana/p75 = 0/0/11 meses; intervalo mediano entre contratos do mesmo cliente = 366 dias; 40% dos contratos Inativos seguidos de Ativo; 379 de 522 clientes tem 2+ contratos.
- `valor_vencido` usa o **vencimento já passado**, nao `parcelas_em_aberto` (que inclui parcelas futuras e mascara o atraso).
- 2 registros de `recebimentos` sem `codigo_contrato` (R$ 330.853,05 orfaos) nao pertencem a nenhum contrato — falha de extracao conhecida.
- Date calculation: Sunday = `CURRENT_DATE - EXTRACT(DOW FROM CURRENT_DATE)`.

## Recent Changes (24/07)
- **Default sort** changed to `data_termino DESC` (mais recentes primeiro) com `NULLS LAST` (registros sem data no final), usando conversão para data real no `ORDER BY`.
- **Filtro contratante** agora lê o valor do `<input>` ao clicar "Filtrar" (antes só lia após `limparFiltrosContratos()`).
- **Bar chart click filter** (`?mes=MM/YYYY`) implementado — clicar na barra filtra a tabela pelo mês.

## Recent Testing
Basic contratos: 2345 total
mes=07/2026: 14 contratos ending July 2026
semana=1: 3 contratos ending this week
alerta=1: 945 vencidos, 15 em 30 dias, 14 em 60 dias, 3 em 90 dias
