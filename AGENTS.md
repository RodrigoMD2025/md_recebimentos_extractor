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
- **`nao_ativo` x `corte_antecipado`: o aviso de 30 dias.** O cliente cumpre 30 dias de aviso ao encerrar, e é nesse intervalo que vence a última parcela. Ela não é inadimplência — é a prova de que o ciclo fechou com o pagamento em dia. O `MD2339` (Condomínio Shopping Center Cerrado) aparecia como "vencido" por R$ 454,76 sem nunca ter deixado de pagar nada.
  - `nao_ativo` (prio 1): sem contrato em vigor (`sem_contrato_vigente`), pagou conosco (`ja_pagou`), dentro da carência de 180 dias e com **no máximo 1 parcela em aberto**.
  - `corte_antecipado` (prio 3): saiu no meio do ciclo, `duracao_dias < 330`.
  - O teto de 1 parcela é o que segura a regra. Sem ele, `nao_ativo` engolia 36 clientes com 2 a 4 parcelas em aberto — incluindo R$ 18.372,28 com 87 dias de atraso — e a cobrança sumia da lista. `atraso` é inadimplência real: 48 clientes, 44 deles com mais de uma parcela vencida.
  - `situacao` e `prioridade` usam o MESMO `CASE`, na mesma ordem, com um número por segmento. As duas colunas já divergiram uma vez por duplicar a regra; o `CASE` de prioridade está logo abaixo do de `situacao` e precisa ser editado em conjunto.
- 8 segmentos finais: `cliente_ativo` (0) · `atraso` (1) · `nao_ativo` (2) · `corte_antecipado` (3) · `ciclo_encerrado` (4) · `nunca_pagou` (5) · `sem_faturamento` (6) · `sem_acao` (9).
- **CHURN É TEMPO, COBRANÇA É DINHEIRO. São ortogonais e não devem ser misturados.** A lista de 94 cancelamentos confirmados pela gestão (`_stg_cancel`) refutou a hipótese de que dado financeiro detecte churn: dos 77 que casam com a base, **91% pagaram tudo em dia e não deixaram saldo nenhum** — só 9% têm dívida. Já o relógio de 180 dias (`ciclo_fechado`) acerta **99%**. Consequência: `nao_ativo` foi rebaixado de "perda" para **"renovação pendente"** (papelada, o cliente está operando). Quem encerra de fato é o `ciclo_encerrado`, quando os 180 dias passam — não o extrato.
  - `situacao` e `prioridade` divergem **de propósito** agora, e é a única divergência permitida: `situacao` decide qual balde o cliente cai (regra de cobrança — a parcela final do aviso de 30 dias não é inadimplência, por isso `nao_ativo` vem antes de `atraso` no `CASE`); `prioridade` só ordena a fila de trabalho (dinheiro antes de papelada). Os dois `CASE` precisam cobrir exatamente os mesmos 8 segmentos, e o teste de `nao_ativo` vem antes do de `atraso` na prioridade porque eles se sobrepõem no teste de dinheiro.
  - **Não tentar de novo inferir churn pelo financeiro.** A tese de "parcela vencida há > 90 dias = encerrado" parecia funcionar no grupo do MD2339 e era verdade para n=1, mas erra em 91% dos casos reais.
- Tabela `clientes_cancelados` (39 inserts literais + 8 resolvidos): cliente canônico confirmado como cancelado, **join por igualdade exata**. A suppressão entra uma única vez no topo do `WHERE` da API, fora de todos os filtros — injetar a condição dentro deles já vazou uma vez num `OR` (`AND` liga antes que `OR`) e cancelados com `dias_sem_contrato >= N` passariam.
  - Resolver nome informal da `_stg_cancel` para o `cliente` canônico **não é seguro em SQL**: `LIKE` com substring casa 94/94 mas com falsos positivos, e word-boundary só resolve 35. O pior caso é "Cerrado Shopping", que por trigram iria para o MD778 em vez do MD2339. Falso positivo esconde cliente vivo da lista — o pior erro possível aqui. Os 47 restantes precisam de resolução manual; a ausência é o default seguro.
  - A lista do usuário tem nomes informais duplicados no banco ("Shopping Independência" vs "ASSOCIAÇÃO DOS LOJISTAS DO INDEPENDENCIA SHOPPING"), então a correspondência é por marca comercial, não por razão social.
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

## A base nao e um retrato vivo da fonte (achado de 26/09)
- O extrator le **30 registros por execucao** (`pages=1` nas 11 execucoes, 3 inserts em 2 meses). Os 2345 contratos vieram de um carregamento em massa em **24/07/2026**; desde entao entraram 2. "Nao existe contrato novo" so e fato ate 24/07.
- `base_ref` deriva a data de referencia (dia com mais inserts) em vez de fixar, e `dado_desatualizado_possivel` marca onde a view AFIRMA ausencia: contrato **ja terminado** depois da carga e sem sucessao. Exige `termino < CURRENT_DATE` alem de `> base_referencia` — sem isso o flag dispara em todo cliente ativo (contrato com termino em 2027 tem vigencia, nao lacuna). Hoje sao 28 clientes.
- Isso NAO invalida a tese churn=180 dias: os cancelamentos confirmados sairam entre 2020 e 2025, muito antes do corte. Invalida apenas usar "sem contrato vigente" como fato presente.
- **Nao medir durante uma extracao.** Uma medicao feita por volta das 20:00 de 26/09 pegou o lote de `recebimentos` pela metade: `atraso` appeared 45 em vez de 52 e `nao_ativo` 13 em vez de 12, porque alguns contratos ja tinham o `recebimentos` novo e outros nao. Total 518 nos dois casos. Estado estavel: 51/12/9/140 clientes em atraso/renovacao/corte/ciclo.
- 24/07 e' tambem a origem do confundidor `status='Ativo'`: o sistema de origem marca Ativo ate o ultimo dia do ciclo, entao 2347 contratos, e nao 2121, estao Ativo na fonte.

## Recent Testing
Basic contratos: 2345 total
mes=07/2026: 14 contratos ending July 2026
semana=1: 3 contratos ending this week
alerta=1: 945 vencidos, 15 em 30 dias, 14 em 60 dias, 3 em 90 dias
