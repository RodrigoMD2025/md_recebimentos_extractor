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

// A origem grava o estado como texto livre: "SP", "sp", "SAO PAULO", "São Paulo",
// "PARANA"... Sem normalizar, o filtro e a lista de UFs mostram a mesma unidade
// várias vezes. Aqui tudo vira "Nome-UF" ("São Paulo-SP").
const UFS = {
  AC: "Acre", AL: "Alagoas", AP: "Amapá", AM: "Amazonas", BA: "Bahia",
  CE: "Ceará", DF: "Distrito Federal", ES: "Espírito Santo", GO: "Goiás",
  MA: "Maranhão", MT: "Mato Grosso", MS: "Mato Grosso do Sul", MG: "Minas Gerais",
  PA: "Pará", PB: "Paraíba", PR: "Paraná", PE: "Pernambuco", PI: "Piauí",
  RJ: "Rio de Janeiro", RN: "Rio Grande do Norte", RS: "Rio Grande do Sul",
  RO: "Rondônia", RR: "Roraima", SC: "Santa Catarina", SP: "São Paulo",
  SE: "Sergipe", TO: "Tocantins",
};
const semAcento = (v) => String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const UF_POR_NOME = new Map(
  Object.entries(UFS).map(([uf, nome]) => [semAcento(nome).toUpperCase(), uf])
);
function normalizarEstado(valor) {
  const texto = String(valor ?? "").replace(/\s+/g, " ").trim();
  if (!texto) return null;
  const chave = semAcento(texto).toUpperCase();
  if (UFS[chave]) return `${UFS[chave]}-${chave}`;
  const porNome = UF_POR_NOME.get(chave);
  if (porNome) return `${UFS[porNome]}-${porNome}`;
  // "SÃO PAULO - SP" / "SAO PAULO/SP": nome seguido da sigla.
  const combo = chave.match(/^(.*?)[\s/,-]+([A-Z]{2})$/);
  if (combo && UFS[combo[2]] && UF_POR_NOME.get(combo[1].trim()) === combo[2]) {
    return `${UFS[combo[2]]}-${combo[2]}`;
  }
  // Valor que não é UF (ex.: "10"): não inventa, deixa em branco.
  return null;
}

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
  // Documentos anexos e configuração sazonal saíram do modelo.
  await pool.query("DROP TABLE IF EXISTS md_documentos, md_configuracoes");

  const readTable = (name) => {
    try { return sqlite.prepare(`SELECT * FROM ${name}`).all(); }
    catch (e) { if (/no such table/.test(e.message)) return []; throw e; }
  };
  const clientes = readTable("clientes");
  const contatos = readTable("contatos_cliente");
  const playlists = readTable("playlists_cliente");
  const detalhes = readTable("playlists_detalhes");
  const vinculos = readTable("playlist_clientes");
  const execucoes = readTable("execucoes");
  const metas = readTable("meta");

  console.log(`Lidos do SQLite: ${clientes.length} clientes, ${playlists.length} playlists, ${detalhes.length} detalhes, ${vinculos.length} vínculos, ${contatos.length} contatos`);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("TRUNCATE md_playlists, md_playlist_clientes, md_playlist_detalhes, md_contatos, md_execucoes, md_meta, md_clientes RESTART IDENTITY CASCADE");

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
      nn(r.endereco), nn(r.cidade), normalizarEstado(r.estado), nn(r.pais), nn(r.cep), nn(r.nome_responsavel), nn(r.rgcpf_responsavel), nn(r.email_responsavel),
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

    await bulkInsert(client, "md_playlist_detalhes",
      ["playlist_id","titulo","tipo_playlist","genero","idades","classes_sociais","hour_start","hour_end","observacoes","status_playlist","musicas_count","musicas","codigo_contratos","data_criacao","coletado_em"],
      detalhes.map((r) => [
        r.playlist_id, nn(r.titulo), nn(r.tipo_playlist), nn(r.genero), parseJson(r.idades), parseJson(r.classes_sociais),
        nn(r.hour_start), nn(r.hour_end), nn(r.observacoes), r.status_playlist, r.musicas_count ?? 0,
        parseJson(r.musicas_json ?? r.musicas), parseJson(r.codigo_contratos), nn(r.data_criacao), parseTs(r.coletado_em),
      ])
    );
    console.log(`Inseridos ${detalhes.length} detalhes de playlist.`);

    await bulkInsert(client, "md_playlist_clientes",
      ["playlist_id","cliente_id","nome_cliente","codigo_contrato","codigo_numero","tocar_sazonal","data_inicial","data_final"],
      vinculos.map((r) => [
        r.playlist_id, r.cliente_id, nn(r.nome_cliente), nn(r.codigo_contrato),
        r.codigo_contrato ? Number(String(r.codigo_contrato).replace(/\D/g, "")) || null : null,
        r.tocar_sazonal, nn(r.data_inicial), nn(r.data_final),
      ])
    );
    console.log(`Inseridos ${vinculos.length} vínculos de playlist.`);

    await bulkInsert(client, "md_contatos",
      ["cliente_id","ordem","cargo_area","nome","email","telefone_celular"],
      contatos.map((r) => [r.cliente_id, r.ordem, nn(r.cargo_area), nn(r.nome), nn(r.email), nn(r.telefone_celular)])
    );
    console.log(`Inseridos ${contatos.length} contatos.`);

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
