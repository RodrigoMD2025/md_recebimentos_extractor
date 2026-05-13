-- =============================================================================
-- Schema PostgreSQL para Neon – Extrator de Recebimentos Music Delivery
-- Compatível com PostgreSQL 14+ (Neon Serverless)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Tabela principal de recebimentos
-- Cada linha representa uma parcela contratual de um período específico.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS recebimentos (
    -- Chave primária auto-incrementada
    id                  SERIAL          PRIMARY KEY,

    -- Ano do relatório extraído (ex: "2024", "2025")
    ano                 TEXT            NOT NULL,

    -- Nome do contratante (artista / label)
    contratante         TEXT            NOT NULL DEFAULT '',

    -- Código único do contrato no sistema Music Delivery
    codigo_contrato     TEXT            NOT NULL DEFAULT '',

    -- Data de vencimento da parcela (formato como extraído: DD/MM/YYYY)
    vencimento          TEXT            NOT NULL DEFAULT '',

    -- Valor monetário da parcela (formato como extraído, ex: "R$ 1.234,56")
    valor_parcela       TEXT            NOT NULL DEFAULT '',

    -- Status de pagamento conforme exibido no sistema
    -- (ex: "Pago", "Pendente", "Recebido", "Cancelado" …)
    status_pagamento    TEXT            NOT NULL DEFAULT '',

    -- Data em que o pagamento foi efetivado (pode ser vazio)
    pago_em             TEXT            NOT NULL DEFAULT '',

    -- URL relativa/absoluta para a página de detalhes da parcela
    link_detalhes       TEXT,

    -- Status consolidado das playlists vinculadas
    -- ("Com Playlist", "Sem Playlist", "Erro de Acesso", "Status Desconhecido" …)
    status_playlist     TEXT            NOT NULL DEFAULT '',

    -- Nomes das playlists separados por vírgula (ou "N/A")
    playlists           TEXT            NOT NULL DEFAULT '',

    -- Período de vigência informado na página de detalhes
    periodo             TEXT            NOT NULL DEFAULT '',

    -- Quantidade de faixas reportadas (valor textual como extraído)
    faixas              TEXT            NOT NULL DEFAULT '',

    -- Identificador curto da execução do GitHub Actions que gerou este registro
    -- (primeiros 8 caracteres de um UUID v4)
    execucao_id         TEXT            NOT NULL DEFAULT '',

    -- Timestamp de criação do registro (UTC)
    criado_em           TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    -- ------------------------------------------------------------------
    -- Restrição de unicidade: evita duplicatas para a mesma parcela.
    -- ON CONFLICT (ano, codigo_contrato, vencimento) é usado no UPSERT.
    -- ------------------------------------------------------------------
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
COMMENT ON COLUMN recebimentos.status_playlist  IS 'Status consolidado das playlists: Com Playlist | Sem Playlist | Erro de Acesso | Status Desconhecido.';
COMMENT ON COLUMN recebimentos.playlists        IS 'Nomes das playlists vinculadas, separados por vírgula.';
COMMENT ON COLUMN recebimentos.periodo          IS 'Período de vigência informado nos detalhes.';
COMMENT ON COLUMN recebimentos.faixas           IS 'Quantidade de faixas (texto bruto extraído).';
COMMENT ON COLUMN recebimentos.execucao_id      IS 'ID curto da execução do GitHub Actions (8 chars de UUID4).';
COMMENT ON COLUMN recebimentos.criado_em        IS 'Timestamp UTC de inserção do registro.';

-- -----------------------------------------------------------------------------
-- Índices para otimizar as consultas mais comuns
-- -----------------------------------------------------------------------------

-- Filtros por ano (query principal da dashboard)
CREATE INDEX IF NOT EXISTS idx_recebimentos_ano
    ON recebimentos (ano);

-- Busca case-insensitive por contratante
CREATE INDEX IF NOT EXISTS idx_recebimentos_contratante_lower
    ON recebimentos (lower(contratante));

-- Filtros e agrupamentos por status de pagamento
CREATE INDEX IF NOT EXISTS idx_recebimentos_status_pagamento
    ON recebimentos (status_pagamento);

-- Rastreamento de execuções (auditoria / debug)
CREATE INDEX IF NOT EXISTS idx_recebimentos_execucao_id
    ON recebimentos (execucao_id);

-- -----------------------------------------------------------------------------
-- VIEW: v_stats_por_ano
-- Resumo estatístico agrupado por ano.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_stats_por_ano AS
SELECT
    ano,

    -- Total absoluto de parcelas no ano
    COUNT(*)                                                        AS total,

    -- Parcelas cujo status indica pagamento efetivado
    COUNT(*) FILTER (
        WHERE status_pagamento ILIKE '%pago%'
           OR status_pagamento ILIKE '%recebido%'
    )                                                               AS pagos,

    -- Parcelas pendentes (total - pagos)
    COUNT(*) FILTER (
        WHERE status_pagamento NOT ILIKE '%pago%'
          AND status_pagamento NOT ILIKE '%recebido%'
    )                                                               AS pendentes,

    -- Parcelas que possuem playlists vinculadas
    COUNT(*) FILTER (
        WHERE status_playlist = 'Com Playlist'
    )                                                               AS com_playlist,

    -- Parcelas sem playlists vinculadas
    COUNT(*) FILTER (
        WHERE status_playlist = 'Sem Playlist'
    )                                                               AS sem_playlist,

    -- Soma total de faixas (apenas registros com valor numérico válido)
    COALESCE(
        SUM(faixas::BIGINT) FILTER (WHERE faixas ~ '^\d+$'),
        0
    )                                                               AS total_faixas

FROM recebimentos
GROUP BY ano
ORDER BY ano DESC;

COMMENT ON VIEW v_stats_por_ano IS 'Resumo estatístico de recebimentos agrupado por ano: totais, pagamentos, playlists e faixas.';

-- -----------------------------------------------------------------------------
-- VIEW: v_status_distribuicao
-- Distribuição de contagens por status_pagamento e ano.
-- Útil para gráficos de barras / pizza na dashboard.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_status_distribuicao AS
SELECT
    ano,
    status_pagamento,
    COUNT(*)    AS contagem
FROM recebimentos
GROUP BY ano, status_pagamento
ORDER BY ano DESC, contagem DESC;

COMMENT ON VIEW v_status_distribuicao IS 'Distribuição de parcelas por status_pagamento e ano (base para gráficos).';
