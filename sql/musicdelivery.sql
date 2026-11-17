-- Schema PostgreSQL (Neon) para dados do Music Delivery (clientes/playlists)
-- Importados do SQLite gerado por musicdelivery-extractor (musicdelivery.db).

CREATE TABLE IF NOT EXISTS md_clientes (
    id                       INTEGER PRIMARY KEY,
    nome_listagem            TEXT,
    nome_razaosocial         TEXT,
    nome_fantasia            TEXT,
    cnpj                     TEXT,
    telefone                 TEXT,
    celular                  TEXT,
    email                    TEXT,
    status                   INTEGER,
    contrato_vinculado       TEXT,
    data_inicio              TEXT,
    data_fim                 TEXT,
    data_inicio_iso          DATE,
    data_fim_iso             DATE,
    tipo                     TEXT,
    filiais_vinculadas       JSONB,
    endereco                 TEXT,
    cidade                   TEXT,
    estado                   TEXT,
    pais                     TEXT,
    cep                      TEXT,
    nome_responsavel         TEXT,
    rgcpf_responsavel        TEXT,
    email_responsavel        TEXT,
    telefone_responsavel     TEXT,
    celular_responsavel      TEXT,
    banco                    TEXT,
    agencia                  TEXT,
    conta                    TEXT,
    titular                  TEXT,
    forma_envio              TEXT,
    observacoes              TEXT,
    feedback                 TEXT,
    checklist_json           JSONB,
    responsavel_listagem     TEXT,
    playlists_listagem       TEXT,
    playlists_listagem_json  JSONB,
    forma_envio_listagem     TEXT,
    observacoes_listagem     TEXT,
    status_listagem          TEXT,
    url                      TEXT,
    dados_json               JSONB,
    coleta_avisos            TEXT,
    coleta_completa          INTEGER NOT NULL DEFAULT 0,
    coletado_em              TIMESTAMPTZ,
    atualizado_em            TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_md_clientes_nome    ON md_clientes (lower(nome_razaosocial));
CREATE INDEX IF NOT EXISTS idx_md_clientes_fantasia ON md_clientes (lower(nome_fantasia));
CREATE INDEX IF NOT EXISTS idx_md_clientes_cnpj    ON md_clientes (cnpj);
CREATE INDEX IF NOT EXISTS idx_md_clientes_status  ON md_clientes (status);
CREATE INDEX IF NOT EXISTS idx_md_clientes_estado  ON md_clientes (estado);
CREATE INDEX IF NOT EXISTS idx_md_clientes_cidade  ON md_clientes (lower(cidade));

CREATE TABLE IF NOT EXISTS md_contatos (
    id               SERIAL PRIMARY KEY,
    cliente_id       INTEGER NOT NULL REFERENCES md_clientes(id) ON DELETE CASCADE,
    ordem            INTEGER,
    cargo_area       TEXT,
    nome             TEXT,
    email            TEXT,
    telefone_celular TEXT
);
CREATE INDEX IF NOT EXISTS idx_md_contatos_cli ON md_contatos (cliente_id);

CREATE TABLE IF NOT EXISTS md_playlists (
    id              SERIAL PRIMARY KEY,
    cliente_id      INTEGER NOT NULL REFERENCES md_clientes(id) ON DELETE CASCADE,
    ordem           INTEGER,
    playlist_id     INTEGER,
    nome            TEXT,
    codigo          TEXT,
    nao_mesclar     INTEGER,
    data_vinculacao TEXT,
    url             TEXT
);
CREATE INDEX IF NOT EXISTS idx_md_playlists_cli ON md_playlists (cliente_id);
CREATE INDEX IF NOT EXISTS idx_md_playlists_pid ON md_playlists (playlist_id);

-- Detalhes lidos em /playlists/edit/<id> (uma linha por playlist única).
CREATE TABLE IF NOT EXISTS md_playlist_detalhes (
    playlist_id     INTEGER PRIMARY KEY,
    titulo          TEXT,
    tipo_playlist   TEXT,
    genero          TEXT,
    idades          JSONB,
    classes_sociais JSONB,
    hour_start      TEXT,
    hour_end        TEXT,
    observacoes     TEXT,
    status_playlist INTEGER,
    musicas_count   INTEGER DEFAULT 0,
    musicas         JSONB,
    codigo_contratos JSONB,
    data_criacao    TEXT,
    coletado_em     TIMESTAMPTZ
);

-- "Clientes vinculados à Playlist". codigo_contrato é MD<n> (igual a contratos.codigo).
CREATE TABLE IF NOT EXISTS md_playlist_clientes (
    id              SERIAL PRIMARY KEY,
    playlist_id     INTEGER NOT NULL,
    cliente_id      INTEGER,
    nome_cliente    TEXT,
    codigo_contrato TEXT,
    codigo_numero   BIGINT,
    tocar_sazonal   INTEGER,
    data_inicial    TEXT,
    data_final      TEXT
);
CREATE INDEX IF NOT EXISTS idx_md_plcli_playlist ON md_playlist_clientes (playlist_id);
CREATE INDEX IF NOT EXISTS idx_md_plcli_numero   ON md_playlist_clientes (codigo_numero);
CREATE INDEX IF NOT EXISTS idx_md_plcli_cliente  ON md_playlist_clientes (cliente_id);

CREATE TABLE IF NOT EXISTS md_execucoes (
    id               INTEGER PRIMARY KEY,
    iniciado_em      TIMESTAMPTZ,
    finalizado_em    TIMESTAMPTZ,
    paginas          INTEGER DEFAULT 0,
    clientes_novos   INTEGER DEFAULT 0,
    clientes_pulados INTEGER DEFAULT 0,
    erros            INTEGER DEFAULT 0,
    status           TEXT,
    mensagem         TEXT
);

CREATE TABLE IF NOT EXISTS md_meta (
    chave TEXT PRIMARY KEY,
    valor TEXT
);

-- Migração: a data de criação da playlist passou a vir da listagem /playlists.
ALTER TABLE md_playlist_detalhes ADD COLUMN IF NOT EXISTS data_criacao TEXT;
