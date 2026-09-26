-- =============================================================================
-- Schema PostgreSQL para Neon – Extrator de Recebimentos Music Delivery
-- Compatível com PostgreSQL 14+ (Neon Serverless)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Tabela principal de recebimentos
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS recebimentos (
    id                  SERIAL          PRIMARY KEY,
    ano                 TEXT            NOT NULL,
    contratante         TEXT            NOT NULL DEFAULT '',
    codigo_contrato     TEXT            NOT NULL DEFAULT '',
    vencimento          TEXT            NOT NULL DEFAULT '',
    valor_parcela       TEXT            NOT NULL DEFAULT '',
    status_pagamento    TEXT            NOT NULL DEFAULT '',
    pago_em             TEXT            NOT NULL DEFAULT '',
    link_detalhes       TEXT,
    status_playlist     TEXT            NOT NULL DEFAULT '',
    playlists           TEXT            NOT NULL DEFAULT '',
    periodo             TEXT            NOT NULL DEFAULT '',
    faixas              TEXT            NOT NULL DEFAULT '',
    execucao_id         TEXT            NOT NULL DEFAULT '',
    criado_em           TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    CONSTRAINT recebimentos_ano_contrato_vencimento_key
        UNIQUE (ano, codigo_contrato, vencimento)
);

COMMENT ON TABLE  recebimentos                  IS 'Parcelas de recebimentos de royalties extraídas do sistema Music Delivery.';
COMMENT ON COLUMN recebimentos.id               IS 'Chave primária auto-incrementada.';
COMMENT ON COLUMN recebimentos.ano              IS 'Ano do relatório (string, ex: "2025").';
COMMENT ON COLUMN recebimentos.contratante      IS 'Nome do contratante/artista conforme o sistema.';
COMMENT ON COLUMN recebimentos.codigo_contrato  IS 'Código do contrato no sistema Music Delivery.';
COMMENT ON COLUMN recebimentos.vencimento       IS 'Data de vencimento da parcela (texto bruto extraído).';
COMMENT ON COLUMN recebimentos.valor_parcela    IS 'Valor da parcela (texto bruto, ex: "R$ 1.234,56").';
COMMENT ON COLUMN recebimentos.status_pagamento IS 'Status de pagamento conforme exibido no sistema.';
COMMENT ON COLUMN recebimentos.pago_em          IS 'Data de efetivação do pagamento (pode ser vazio).';
COMMENT ON COLUMN recebimentos.link_detalhes    IS 'URL da página de detalhes da parcela (pode ser NULL).';
COMMENT ON COLUMN recebimentos.status_playlist  IS 'Status consolidado das playlists.';
COMMENT ON COLUMN recebimentos.playlists        IS 'Nomes das playlists vinculadas, separados por vírgula.';
COMMENT ON COLUMN recebimentos.periodo          IS 'Período de vigência informado nos detalhes.';
COMMENT ON COLUMN recebimentos.faixas           IS 'Quantidade de faixas (texto bruto extraído).';
COMMENT ON COLUMN recebimentos.execucao_id      IS 'ID curto da execução do GitHub Actions.';
COMMENT ON COLUMN recebimentos.criado_em        IS 'Timestamp UTC de inserção do registro.';

CREATE INDEX IF NOT EXISTS idx_recebimentos_ano ON recebimentos (ano);
CREATE INDEX IF NOT EXISTS idx_recebimentos_contratante_lower ON recebimentos (lower(contratante));
CREATE INDEX IF NOT EXISTS idx_recebimentos_status_pagamento ON recebimentos (status_pagamento);
CREATE INDEX IF NOT EXISTS idx_recebimentos_execucao_id ON recebimentos (execucao_id);

-- -----------------------------------------------------------------------------
-- VIEW: v_stats_por_ano
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_stats_por_ano AS
SELECT
    ano,
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE status_pagamento ILIKE '%pago%' OR status_pagamento ILIKE '%recebido%') AS pagos,
    COUNT(*) FILTER (WHERE status_pagamento NOT ILIKE '%pago%' AND status_pagamento NOT ILIKE '%recebido%') AS pendentes,
    COUNT(*) FILTER (WHERE status_playlist = 'Com Playlist') AS com_playlist,
    COUNT(*) FILTER (WHERE status_playlist = 'Sem Playlist') AS sem_playlist,
    COALESCE(SUM(faixas::BIGINT) FILTER (WHERE faixas ~ '^\d+$'), 0) AS total_faixas
FROM recebimentos
GROUP BY ano
ORDER BY ano DESC;

COMMENT ON VIEW v_stats_por_ano IS 'Resumo estatístico de recebimentos agrupado por ano.';

-- -----------------------------------------------------------------------------
-- VIEW: v_status_distribuicao
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_status_distribuicao AS
SELECT
    ano,
    status_pagamento,
    COUNT(*) AS contagem
FROM recebimentos
GROUP BY ano, status_pagamento
ORDER BY ano DESC, contagem DESC;

COMMENT ON VIEW v_status_distribuicao IS 'Distribuição de parcelas por status_pagamento e ano.';

-- =============================================================================
-- Tabela de contratos extraídos do sistema Music Delivery
-- =============================================================================
CREATE TABLE IF NOT EXISTS contratos (
    id                  SERIAL          PRIMARY KEY,
    codigo              TEXT            NOT NULL,
    contratante         TEXT            NOT NULL DEFAULT '',
    alias_matriz        TEXT            NOT NULL DEFAULT '',
    data_inicio         TEXT            NOT NULL DEFAULT '',
    data_termino        TEXT            NOT NULL DEFAULT '',
    forma_envio         TEXT            NOT NULL DEFAULT '',
    status              TEXT            NOT NULL DEFAULT '',
    criado_em           TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    CONSTRAINT contratos_codigo_key UNIQUE (codigo)
);

COMMENT ON TABLE  contratos             IS 'Contratos extraídos do sistema Music Delivery.';
COMMENT ON COLUMN contratos.codigo      IS 'Código único do contrato (ex: MD2561).';
COMMENT ON COLUMN contratos.contratante IS 'Nome do contratante.';
COMMENT ON COLUMN contratos.alias_matriz IS 'Alias ou matriz do contrato.';
COMMENT ON COLUMN contratos.data_inicio IS 'Data de início (DD/MM/YYYY).';
COMMENT ON COLUMN contratos.data_termino IS 'Data de término (DD/MM/YYYY).';
COMMENT ON COLUMN contratos.forma_envio IS 'Forma de envio.';
COMMENT ON COLUMN contratos.status      IS 'Status do contrato (Ativo, Inativo).';
COMMENT ON COLUMN contratos.criado_em   IS 'Timestamp UTC de inserção do registro.';

CREATE INDEX IF NOT EXISTS idx_contratos_status ON contratos (status);
CREATE INDEX IF NOT EXISTS idx_contratos_data_termino ON contratos (data_termino);
CREATE INDEX IF NOT EXISTS idx_contratos_contratante_lower ON contratos (lower(contratante));

-- =============================================================================
-- VIEW: v_contratos_alerta
-- Contratos vencendo nos próximos 90 dias (inclui vencidos).
-- =============================================================================
CREATE OR REPLACE VIEW v_contratos_alerta AS
WITH parsed AS (
    SELECT
        *,
        CASE
            WHEN data_termino ~ '^\d{2}/\d{2}/\d{4}$'
            THEN TO_DATE(data_termino, 'DD/MM/YYYY')
            ELSE NULL
        END AS termino_date
    FROM contratos
    WHERE status = 'Ativo'
)
SELECT
    codigo,
    contratante,
    alias_matriz,
    data_inicio,
    data_termino,
    forma_envio,
    status,
    termino_date,
    (termino_date - CURRENT_DATE) AS dias_restantes,
    CASE
        WHEN termino_date <= CURRENT_DATE THEN 'Vencido'
        WHEN termino_date <= CURRENT_DATE + INTERVAL '30 days' THEN 'Vence em 30 dias'
        WHEN termino_date <= CURRENT_DATE + INTERVAL '60 days' THEN 'Vence em 60 dias'
        WHEN termino_date <= CURRENT_DATE + INTERVAL '90 days' THEN 'Vence em 90 dias'
        ELSE 'OK'
    END AS alerta
FROM parsed
WHERE termino_date IS NOT NULL
  AND termino_date <= CURRENT_DATE + INTERVAL '90 days'
ORDER BY termino_date ASC;

COMMENT ON VIEW v_contratos_alerta IS 'Contratos ativos vencendo nos próximos 90 dias.';

-- =============================================================================
-- VIEW: v_contratos_por_mes
-- Contratos vencendo por mês (para gráfico).
-- =============================================================================
CREATE OR REPLACE VIEW v_contratos_por_mes AS
WITH parsed AS (
    SELECT
        CASE
            WHEN data_termino ~ '^\d{2}/\d{2}/\d{4}$'
            THEN TO_DATE(data_termino, 'DD/MM/YYYY')
            ELSE NULL
        END AS termino_date
    FROM contratos
    WHERE status = 'Ativo'
)
SELECT
    TO_CHAR(termino_date, 'YYYY-MM') AS mes,
    TO_CHAR(termino_date, 'MM/YYYY') AS mes_label,
    COUNT(*) AS total
FROM parsed
WHERE termino_date IS NOT NULL
  AND termino_date >= CURRENT_DATE - INTERVAL '3 months'
  AND termino_date <= CURRENT_DATE + INTERVAL '12 months'
GROUP BY mes, mes_label
ORDER BY mes ASC;

COMMENT ON VIEW v_contratos_por_mes IS 'Contratos ativos vencendo por mês.';

-- =============================================================================
-- VIEW: v_sem_atualizacao
-- Clientes que exigem ação, segmentados pelo ciclo real do negócio (contratos
-- anuais). Medir "meses sem pagamento" não serve: o ciclo de ~12 meses significa
-- que um contrato encerrado há 6 meses é o fim normal de um ciclo, não atraso.
--
--   1. sem_faturamento  Ativo, nunca emitiu uma parcela e já passou do período
--                      de carência de 90 dias. O contrato está "Ativo" no
--                      cadastro mas não gera nada.
--   2. nunca_pagou      Ativo, tem parcelas emitidas e nenhuma foi paga.
--   3. cliente_ativo    Ativo, dentro do prazo do contrato e pagou nos últimos
--                      120 dias. As parcelas vencidas em aberto são o atraso
--                      normal da liquidação anual, não mora. Sai da lista.
--   4. atraso           Tem parcela com vencimento já passado e não paga FORA do
--                      prazo do contrato, ou sem pagar há mais de 120 dias.
--                      É a lista de cobrança de verdade.
--   5. ciclo_encerrado  O ciclo terminou HA MAIS DE 6 MESES e o cliente não
--                      assinou outro contrato. É o pipeline de renegociação.
--
-- A carência de 180 dias é o ponto central: 74 renovações (3,1% do total)
-- acontecem entre 91 e 180 dias depois do fim do contrato anterior. Um
-- contrato que venceu há 4 meses ainda é lead em carência, não churn — o
-- cliente não cancelou, só ainda não renovou.
--
-- Cliente que já assinou contrato depois (reassinou_depois) sai da lista: ele
-- voltou, não é caso perdido nem é lead.
-- =============================================================================
CREATE OR REPLACE VIEW v_sem_atualizacao AS
WITH contratos_base AS (
    SELECT
        c.codigo,
        c.status,
        c.contratante,
        c.alias_matriz,
        c.forma_envio,
        COALESCE(
            NULLIF(btrim(c.contratante), ''),
            NULLIF(btrim(c.alias_matriz), ''),
            c.codigo
        ) AS cliente,
        c.data_inicio,
        c.data_termino,
        CASE WHEN c.data_inicio ~ '^\d{2}/\d{2}/\d{4}$'
             THEN TO_DATE(c.data_inicio, 'DD/MM/YYYY') END AS inicio,
        CASE WHEN c.data_termino ~ '^\d{2}/\d{2}/\d{4}$'
             THEN TO_DATE(c.data_termino, 'DD/MM/YYYY') END AS termino
    FROM contratos c
),
pagamentos AS (
    SELECT
        codigo_contrato,
        COUNT(*) AS total_parcelas,
        MAX(TO_DATE(pago_em, 'DD/MM/YY')) FILTER (
            WHERE status_pagamento = 'Pago' AND pago_em ~ '^\d{2}/\d{2}/\d{2}$'
        ) AS ultimo_pagamento,
        MAX(TO_DATE(vencimento, 'DD/MM/YY')) FILTER (
            WHERE vencimento ~ '^\d{2}/\d{2}/\d{2}$'
        ) AS ultimo_vencimento,
        COUNT(*) FILTER (WHERE status_pagamento <> 'Pago') AS parcelas_em_aberto,
        -- Parcelas com vencimento JÁ PASSADO: é o que distingue cobrança de
        -- "ainda vai vencer". O vencimento máximo não serve para isso, porque
        -- um contrato em dia tem parcelas futuras e mascararia o atraso.
        COUNT(*) FILTER (
            WHERE status_pagamento <> 'Pago'
              AND vencimento ~ '^\d{2}/\d{2}/\d{2}$'
              AND TO_DATE(vencimento, 'DD/MM/YY') < CURRENT_DATE
              -- Parcela de valor zero é placeholder de extração, não dívida.
              -- Sem isso ela vira a parcela vencida mais antiga e infla o
              -- dias_atraso do contrato inteiro (MD2425 chegou a 237d).
              AND NULLIF(regexp_replace(valor_parcela, '[^0-9]', '', 'g'), '')::numeric > 0
        ) AS parcelas_vencidas,
        MIN(TO_DATE(vencimento, 'DD/MM/YY')) FILTER (
            WHERE status_pagamento <> 'Pago'
              AND vencimento ~ '^\d{2}/\d{2}/\d{2}$'
              AND TO_DATE(vencimento, 'DD/MM/YY') < CURRENT_DATE
              AND NULLIF(regexp_replace(valor_parcela, '[^0-9]', '', 'g'), '')::numeric > 0
        ) AS vencida_mais_antiga,
        SUM(
            (CASE
                WHEN regexp_replace(valor_parcela, '^R\$\s*', '') LIKE '%,%'
                    THEN REPLACE(REPLACE(regexp_replace(valor_parcela, '^R\$\s*', ''), '.', ''), ',', '.')
                ELSE regexp_replace(valor_parcela, '^R\$\s*', '')
            END)::numeric
        ) FILTER (
            WHERE status_pagamento <> 'Pago'
              AND vencimento ~ '^\d{2}/\d{2}/\d{2}$'
              AND TO_DATE(vencimento, 'DD/MM/YY') < CURRENT_DATE
              AND NULLIF(regexp_replace(valor_parcela, '[^0-9]', '', 'g'), '')::numeric > 0
        ) AS valor_vencido,
        SUM(
            (CASE
                WHEN regexp_replace(valor_parcela, '^R\$\s*', '') LIKE '%,%'
                    THEN REPLACE(REPLACE(regexp_replace(valor_parcela, '^R\$\s*', ''), '.', ''), ',', '.')
                ELSE regexp_replace(valor_parcela, '^R\$\s*', '')
            END)::numeric
        ) FILTER (WHERE status_pagamento <> 'Pago') AS valor_em_aberto
    FROM recebimentos
    GROUP BY codigo_contrato
),
ultima_parcela AS (
    SELECT DISTINCT ON (codigo_contrato)
        codigo_contrato,
        (CASE
            WHEN regexp_replace(valor_parcela, '^R\$\s*', '') LIKE '%,%'
                THEN REPLACE(REPLACE(regexp_replace(valor_parcela, '^R\$\s*', ''), '.', ''), ',', '.')
            ELSE regexp_replace(valor_parcela, '^R\$\s*', '')
        END)::numeric AS valor_parcela
    FROM recebimentos
    WHERE status_pagamento = 'Pago'
    ORDER BY codigo_contrato, TO_DATE(vencimento, 'DD/MM/YY') DESC
),
-- Maior parcela já paga pelo cliente em qualquer contrato: serve de referência
-- de quanto o contrato parado renderia, já que o contrato sem faturamento não
-- tem valor próprio.
referencia AS (
    SELECT b.cliente, max(u.valor_parcela) AS valor_referencia
    FROM contratos_base b
    JOIN ultima_parcela u ON u.codigo_contrato = b.codigo
    GROUP BY b.cliente
),
-- Próxima matrícula do mesmo cliente: o contrato que veio depois deste. Fica
-- numa CTE (e não como subquery na lista de colunas) porque tanto
-- reassinou_depois quanto o fim do ciclo precisam dela.
proximo AS (
    SELECT a.codigo, min(n.inicio) AS inicio_novo_contrato
    FROM contratos_base a
    LEFT JOIN contratos_base n
        ON n.cliente = a.cliente
       AND a.inicio IS NOT NULL
       AND n.inicio IS NOT NULL
       AND n.inicio > a.inicio
    GROUP BY a.codigo
),
base AS (
    SELECT
        b.cliente,
        b.contratante,
        b.codigo,
        b.alias_matriz,
        b.status AS status_contrato,
        b.data_inicio,
        b.data_termino,
        b.forma_envio,
        b.inicio,
        b.termino,
        -- Quanto o contrato realmente durou. 93% da base fecha entre 363 e 366
        -- dias, entao o ciclo nominal e de 12 meses.
        CASE WHEN b.inicio IS NOT NULL AND b.termino IS NOT NULL
             THEN (b.termino - b.inicio) END AS duracao_dias,
        -- Encerrou ANTES do ciclo completar. Nao ha campo de duracao prevista
        -- (forma_envio e "Nao definido" em 2346 de 2347 registros), entao o
        -- corte e o proprio ciclo nominal: menos de 330 dias, com folga para
        -- nao capturar a faixa de transicao de 332-361 dias. So conta se o
        -- contrato ja terminou -- um contrato de 6 meses que ainda esta dentro
        -- do prazo nao foi encerrado cedo, esta em andamento.
        (b.inicio IS NOT NULL AND b.termino IS NOT NULL
         AND b.termino < CURRENT_DATE
         AND (b.termino - b.inicio) < 330) AS encerrado_cedo,
        COALESCE(p.total_parcelas, 0) AS total_parcelas,
        p.ultimo_pagamento,
        p.ultimo_vencimento,
        up.valor_parcela,
        r.valor_referencia,
        COALESCE(p.parcelas_em_aberto, 0) AS parcelas_em_aberto,
        COALESCE(p.valor_em_aberto, 0) AS valor_em_aberto,
        COALESCE(p.parcelas_vencidas, 0) AS parcelas_vencidas,
        COALESCE(p.valor_vencido, 0) AS valor_vencido,
        p.vencida_mais_antiga,
        -- O ciclo NÃO fecha no vencimento do contrato. Leva 6 meses de carência:
        -- 74 renovações (3,1% do total) acontecem entre 91 e 180 dias após o fim
        -- do contrato anterior, então "o contrato venceu" não é "o cliente
        -- perdeu" — durante a carência ele ainda é lead, não churn. Passados os
        -- 180 dias sem novo contrato, aí sim entra na lista de renegociação.
        -- Na falta da data de término, o ciclo fecha quando a última cobrança
        -- emitida expira (ou, se nunca emitiu nada, 180 dias após o início).
        COALESCE(pr.inicio_novo_contrato, b.termino, p.ultimo_vencimento::date, b.inicio)
            IS NOT NULL
        AND COALESCE(pr.inicio_novo_contrato, b.termino, p.ultimo_vencimento::date, b.inicio)
            <= CURRENT_DATE - INTERVAL '6 months'
            AS ciclo_fechado,
        -- O cliente assinou outro contrato depois deste? Equivale a ter próxima
        -- matrícula: se voltou, já não é caso perdido nem é lead.
        pr.inicio_novo_contrato IS NOT NULL AS reassinou_depois,
        pr.inicio_novo_contrato AS inicio_novo_contrato
    FROM contratos_base b
    LEFT JOIN pagamentos p ON p.codigo_contrato = b.codigo
    LEFT JOIN proximo pr ON pr.codigo = b.codigo
    LEFT JOIN ultima_parcela up ON up.codigo_contrato = b.codigo
    LEFT JOIN referencia r ON r.cliente = b.cliente
)
SELECT
    cliente,
    contratante,
    codigo,
    alias_matriz,
    status_contrato,
    data_inicio,
    data_termino,
    forma_envio,
    duracao_dias,
    encerrado_cedo,
    total_parcelas,
    ultimo_pagamento,
    ultimo_vencimento,
    valor_parcela,
    valor_referencia,
    parcelas_em_aberto,
    valor_em_aberto,
    parcelas_vencidas,
    valor_vencido,
    ciclo_fechado,
    reassinou_depois,
    inicio_novo_contrato,
    -- Fim do ciclo: se o cliente já assinou outro contrato, o ciclo anterior
    -- terminou quando o novo começou; senão no término, na última cobrança ou,
    -- se nunca emitiu nada, no início.
    COALESCE(b.inicio_novo_contrato, b.termino, b.ultimo_vencimento::date, b.inicio) AS fim_contrato,
    CASE
        WHEN COALESCE(b.inicio_novo_contrato, b.termino, b.ultimo_vencimento::date, b.inicio) IS NOT NULL
        THEN GREATEST(0, (CURRENT_DATE - COALESCE(b.inicio_novo_contrato, b.termino, b.ultimo_vencimento::date, b.inicio))::int)
    END AS dias_sem_contrato,
    CASE WHEN b.vencida_mais_antiga IS NOT NULL
         THEN (CURRENT_DATE - b.vencida_mais_antiga)::int
    END AS dias_atraso,
    CASE
        WHEN b.status_contrato = 'Ativo'
         AND b.total_parcelas = 0
         AND (b.inicio IS NULL OR CURRENT_DATE - b.inicio > 90)
            THEN 'sem_faturamento'
        WHEN b.status_contrato = 'Ativo' AND b.total_parcelas > 0 AND b.ultimo_pagamento IS NULL
            THEN 'nunca_pagou'
        -- Cliente que ainda está dentro do prazo do contrato E pagando não é
        -- inadimplente. A cobrança é mensal antecipada e a liquidação é anual:
        -- 67,8% das parcelas são pagas com mais de 180 dias de atraso, então
        -- "parcela vencida e não paga" dentro do ciclo é o comportamento normal,
        -- não mora. Sem esta carve-out, 84 dos 143 contratos marcados como atraso
        -- eram clientes que pagaram nos últimos 4 meses.
        WHEN b.status_contrato = 'Ativo'
         AND (b.termino IS NULL OR b.termino >= CURRENT_DATE)
         AND b.ultimo_pagamento IS NOT NULL
         AND (CURRENT_DATE - b.ultimo_pagamento) <= 120
            THEN 'cliente_ativo'
        WHEN b.parcelas_vencidas > 0
            THEN 'atraso'
        -- Cortou o contrato antes do ciclo completar: o cliente nao esta mais
        -- ativo por decisao propria, nao por decurso de prazo. Diferente do
        -- ciclo encerrado, em que o contrato cumpriu o prazo e o cliente
        -- simplesmente nao renovou. Fica depois de "atraso" de proposito: havendo
        -- parcela vencida a cobrar, a cobranca vem primeiro.
        WHEN b.encerrado_cedo
            THEN 'nao_ativo'
        WHEN b.ciclo_fechado
            THEN 'ciclo_encerrado'
        ELSE 'sem_acao'
    END AS situacao,
    CASE
        WHEN b.status_contrato = 'Ativo' AND b.total_parcelas = 0
         AND (b.inicio IS NULL OR CURRENT_DATE - b.inicio > 90) THEN 4
        WHEN b.status_contrato = 'Ativo' AND b.total_parcelas > 0 AND b.ultimo_pagamento IS NULL THEN 3
        WHEN b.status_contrato = 'Ativo'
         AND (b.termino IS NULL OR b.termino >= CURRENT_DATE)
         AND b.ultimo_pagamento IS NOT NULL
         AND (CURRENT_DATE - b.ultimo_pagamento) <= 120 THEN 0
        WHEN b.parcelas_vencidas > 0 THEN 1
        WHEN b.encerrado_cedo THEN 2
        WHEN b.ciclo_fechado THEN 3
        WHEN b.status_contrato = 'Ativo' AND b.total_parcelas > 0 AND b.ultimo_pagamento IS NULL THEN 4
        WHEN b.status_contrato = 'Ativo' AND b.total_parcelas = 0
         AND (b.inicio IS NULL OR CURRENT_DATE - b.inicio > 90) THEN 5
        ELSE 9
    END AS prioridade
FROM base b;

COMMENT ON VIEW v_sem_atualizacao IS 'Clientes que exigem ação, segmentados pelo ciclo anual: cliente_ativo (dentro do prazo, não exige ação), atraso (cobrança), ciclo_encerrado (renegociação, com carência de 180 dias), nunca_pagou e sem_faturamento. "cliente" falls back to alias_matriz; reassinou_depois marca quem já voltou e por isso sai da lista.';
-- =============================================================================
-- Tabela de relatórios de extração de contratos (para o monitor do dashboard)
-- =============================================================================
CREATE TABLE IF NOT EXISTS extracoes_contratos (
    id                  SERIAL          PRIMARY KEY,
    github_run_id       TEXT            NOT NULL DEFAULT '',
    github_run_number   TEXT            NOT NULL DEFAULT '',
    total_extraidos     INTEGER         NOT NULL DEFAULT 0,
    inserts             INTEGER         NOT NULL DEFAULT 0,
    updates             INTEGER         NOT NULL DEFAULT 0,
    pages               INTEGER         NOT NULL DEFAULT 1,
    status              TEXT            NOT NULL DEFAULT 'ok',
    mensagem            TEXT            NOT NULL DEFAULT '',
    duracao_segundos    INTEGER         NOT NULL DEFAULT 0,
    criado_em           TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE extracoes_contratos IS 'Histórico de execuções do extrator de contratos (inserts/updates e duração).';

CREATE INDEX IF NOT EXISTS idx_extracoes_contratos_criado_em
    ON extracoes_contratos (criado_em DESC);

CREATE INDEX IF NOT EXISTS idx_extracoes_contratos_run_number
    ON extracoes_contratos (github_run_number);
