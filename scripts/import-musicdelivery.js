#!/usr/bin/env node
/**
 * Importa o musicdelivery.db (SQLite) para o Neon (PostgreSQL).
 * Uso: node scripts/import-musicdelivery.js [caminho/para/musicdelivery.db]
 * Lê DATABASE_URL de process.env ou do .env na raiz do projeto.
 */
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const { Pool } = require("pg");

const ROOT = path.join(__dirname, "..");
const BATCH = 200;

function loadEnv() {
  if (process.env.DATABASE_URL) return;
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] == null) process.env[m[1]] = v;
  }
}

function parseJson(val) {
  if (val == null || val === "") return null;
  const s = String(val);
  try { JSON.parse(s); return s; } catch { return null; }
}
function parseDate(val) {
  if (!val || String(val).trim() === "") return null;
  const s = String(val).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}
function parseTs(val) {
  if (!val || String(val).trim() === "") return null;
  return String(val).trim();
}
function nn(v) { return v === "" || v === undefined ? null : v; }

async function bulkInsert(client, table, cols, rows) {
  if (!rows.length) return;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const values = [];
    const tuples = batch.map((row) => {
      const placeholders = row.map((v) => { values.push(v); return `$${values.length}`; });
      return `(${placeholders.join(",")})`;
    });
    await client.query(`INSERT INTO ${table} (${cols.join(",")}) VALUES ${tuples.join(",")}`, values);
  }
}

async function main() {
  loadEnv();
  const dbPath = process.argv[2] || "/home/pedro/Documentos/Devops/projects/musicdelivery-extractor/musicdelivery.db";
  if (!fs.existsSync(dbPath)) throw new Error(`SQLite não encontrado: ${dbPath}`);
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL não definida.");

  const sqlite = new DatabaseSync(dbPath, { readOnly: true });
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

  const schemaSql = fs.readFileSync(path.join(ROOT, "sql", "musicdelivery.sql"), "utf8");

  console.log("Criando/atualizando schema no Neon...");
  await pool.query(schemaSql);

  const clientes = sqlite.prepare("SELECT * FROM clientes").all();
  const contatos = sqlite.prepare("SELECT * FROM contatos_cliente").all();
  const documentos = sqlite.prepare("SELECT * FROM documentos_cliente").all();
  const playlists = sqlite.prepare("SELECT * FROM playlists_cliente").all();
  const configs = sqlite.prepare("SELECT * FROM configuracoes_cliente").all();
  const execucoes = sqlite.prepare("SELECT * FROM execucoes").all();
  const metas = sqlite.prepare("SELECT * FROM meta").all();

  console.log(`Lidos do SQLite: ${clientes.length} clientes, ${playlists.length} playlists, ${configs.length} configs, ${contatos.length} contatos, ${documentos.length} docs`);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("TRUNCATE md_playlists, md_contatos, md_documentos, md_configuracoes, md_execucoes, md_meta, md_clientes RESTART IDENTITY CASCADE");

    const cCols = [
      "id","nome_listagem","nome_razaosocial","nome_fantasia","cnpj","telefone","celular","email","status",
      "contrato_vinculado","data_inicio","data_fim","data_inicio_iso","data_fim_iso","tipo","filiais_vinculadas",
      "endereco","cidade","estado","pais","cep","nome_responsavel","rgcpf_responsavel","email_responsavel",
      "telefone_responsavel","celular_responsavel","banco","agencia","conta","titular","forma_envio","observacoes",
      "feedback","checklist_json","responsavel_listagem","playlists_listagem","playlists_listagem_json",
      "forma_envio_listagem","observacoes_listagem","status_listagem","url","dados_json","coleta_avisos",
      "coleta_completa","coletado_em","atualizado_em"
    ];
    const cRows = clientes.map((r) => [
      r.id, nn(r.nome_listagem), nn(r.nome_razaosocial), nn(r.nome_fantasia), nn(r.cnpj), nn(r.telefone), nn(r.celular), nn(r.email), r.status,
      nn(r.contrato_vinculado), nn(r.data_inicio), nn(r.data_fim), parseDate(r.data_inicio_iso), parseDate(r.data_fim_iso), nn(r.tipo), parseJson(r.filiais_vinculadas),
      nn(r.endereco), nn(r.cidade), nn(r.estado), nn(r.pais), nn(r.cep), nn(r.nome_responsavel), nn(r.rgcpf_responsavel), nn(r.email_responsavel),
      nn(r.telefone_responsavel), nn(r.celular_responsavel), nn(r.banco), nn(r.agencia), nn(r.conta), nn(r.titular), nn(r.forma_envio), nn(r.observacoes),
      nn(r.feedback), parseJson(r.checklist_json), nn(r.responsavel_listagem), nn(r.playlists_listagem), parseJson(r.playlists_listagem_json),
      nn(r.forma_envio_listagem), nn(r.observacoes_listagem), nn(r.status_listagem), nn(r.url), parseJson(r.dados_json), nn(r.coleta_avisos),
      r.coleta_completa ?? 0, parseTs(r.coletado_em), parseTs(r.atualizado_em)
    ]);
    await bulkInsert(client, "md_clientes", cCols, cRows);
    console.log(`Inseridos ${clientes.length} clientes.`);

    await bulkInsert(client, "md_playlists",
      ["cliente_id","ordem","playlist_id","nome","codigo","nao_mesclar","data_vinculacao","url"],
      playlists.map((r) => [r.cliente_id, r.ordem, r.playlist_id, nn(r.nome), nn(r.codigo), r.nao_mesclar, nn(r.data_vinculacao), nn(r.url)])
    );
    console.log(`Inseridas ${playlists.length} playlists.`);

    await bulkInsert(client, "md_configuracoes",
      ["cliente_id","id_configuracao","sazonal","data_inicio","data_fim","musicas_sazonais","musicas_playlist_base","atualizado_em"],
      configs.map((r) => [r.cliente_id, r.id_configuracao, r.sazonal, nn(r.data_inicio), nn(r.data_fim), r.musicas_sazonais, r.musicas_playlist_base, parseTs(r.atualizado_em)])
    );
    console.log(`Inseridas ${configs.length} configurações.`);

    await bulkInsert(client, "md_contatos",
      ["cliente_id","ordem","cargo_area","nome","email","telefone_celular"],
      contatos.map((r) => [r.cliente_id, r.ordem, nn(r.cargo_area), nn(r.nome), nn(r.email), nn(r.telefone_celular)])
    );
    console.log(`Inseridos ${contatos.length} contatos.`);

    await bulkInsert(client, "md_documentos",
      ["cliente_id","ordem","documento_id","nome","data_upload","url"],
      documentos.map((r) => [r.cliente_id, r.ordem, r.documento_id, nn(r.nome), nn(r.data_upload), nn(r.url)])
    );
    console.log(`Inseridos ${documentos.length} documentos.`);

    await bulkInsert(client, "md_execucoes",
      ["id","iniciado_em","finalizado_em","paginas","clientes_novos","clientes_pulados","erros","status","mensagem"],
      execucoes.map((r) => [r.id, parseTs(r.iniciado_em), parseTs(r.finalizado_em), r.paginas, r.clientes_novos, r.clientes_pulados, r.erros, nn(r.status), nn(r.mensagem)])
    );
    await bulkInsert(client, "md_meta", ["chave","valor"], metas.map((r) => [r.chave, nn(r.valor)]));

    await client.query("COMMIT");
    console.log("Importação concluída com sucesso.");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
    await pool.end();
    sqlite.close();
  }
}

main().catch((e) => { console.error("ERRO:", e.message); console.error(e.stack); process.exit(1); });
