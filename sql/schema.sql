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
