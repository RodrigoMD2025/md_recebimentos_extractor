const { query } = require("./_lib/db");
const { verifyToken, cors } = require("./_lib/auth");

const ORDER_BY_WHITELIST = new Map([
  ["id", "c.id"],
  ["nome", "lower(c.nome_razaosocial)"],
  ["fantasia", "lower(c.nome_fantasia)"],
  ["cidade", "lower(c.cidade)"],
  ["estado", "lower(c.estado)"],
  ["playlists", "playlist_count"],
  ["status", "c.status"],
]);

const LIST_FIELDS = `
  c.id,
  c.nome_razaosocial,
  c.nome_fantasia,
  c.cnpj,
  c.cidade,
  c.estado,
  c.status,
  c.status_listagem,
  c.tipo,
  c.contrato_vinculado,
  (SELECT count(*) FROM md_playlists p WHERE p.cliente_id = c.id) AS playlist_count
`;

module.exports = async function handler(req, res) {
  cors(res, undefined, "GET, OPTIONS");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "GET") {
    res.status(405).json({ error: "Método não permitido." });
    return;
  }

  try {
    await verifyToken(req);
  } catch (authErr) {
    res.status(authErr.statusCode || 401).json({ error: authErr.message });
    return;
  }

  const q = req.query || parseQuery(req.url);

  try {
    if (String(q.stats) === "1" || String(q.stats) === "true") {
      return await handleStats(res);
    }
    if (q.id) {
      return await handleDetail(res, q.id);
    }
    return await handleList(req, res, q);
  } catch (err) {
    if (err.code === "42P01") {
      return res.status(200).json({ data: [], total: 0, page: 1, pages: 1, pending_schema: true });
    }
    console.error("[md-clientes] Erro:", err);
    return res.status(500).json({ error: "Erro interno ao consultar clientes." });
  }
};

function parseQuery(urlStr) {
  const idx = String(urlStr || "").indexOf("?");
  if (idx === -1) return {};
  return Object.fromEntries(new URLSearchParams(String(urlStr).slice(idx + 1)));
}

async function handleStats(res) {
  const stats = await query(`
    SELECT
      count(*) AS total,
      count(*) FILTER (WHERE status = 1) AS ativos,
      count(*) FILTER (WHERE status = 0) AS inativos,
      count(*) FILTER (WHERE coleta_completa = 1) AS completos
    FROM md_clientes
  `);
  const playlists = await query(`SELECT count(*) AS total, count(DISTINCT cliente_id) AS clientes FROM md_playlists`);
  const sazonais = await query(`SELECT count(*) AS total FROM md_configuracoes WHERE sazonal = 1`);
  const estados = await query(`
    SELECT COALESCE(NULLIF(btrim(estado), ''), '—') AS estado, count(*) AS total
    FROM md_clientes
    GROUP BY 1
    ORDER BY total DESC
  `);
  const s = stats.rows[0] || {};
  return res.status(200).json({
    total: Number(s.total) || 0,
    ativos: Number(s.ativos) || 0,
    inativos: Number(s.inativos) || 0,
    completos: Number(s.completos) || 0,
    playlists: Number(playlists.rows[0]?.total) || 0,
    clientes_com_playlist: Number(playlists.rows[0]?.clientes) || 0,
    sazonais: Number(sazonais.rows[0]?.total) || 0,
    estados: estados.rows,
  });
}

async function handleDetail(res, id) {
  const clienteId = parseInt(id, 10);
  if (!Number.isFinite(clienteId)) {
    return res.status(400).json({ error: "id inválido." });
  }
  const cliente = await query(`SELECT * FROM md_clientes WHERE id = $1`, [clienteId]);
  if (!cliente.rows.length) {
    return res.status(404).json({ error: "Cliente não encontrado." });
  }
  const [contatos, playlists, config, documentos] = await Promise.all([
    query(`SELECT ordem, cargo_area, nome, email, telefone_celular FROM md_contatos WHERE cliente_id = $1 ORDER BY ordem`, [clienteId]),
    query(`SELECT ordem, playlist_id, nome, codigo, nao_mesclar, data_vinculacao, url FROM md_playlists WHERE cliente_id = $1 ORDER BY ordem`, [clienteId]),
    query(`SELECT * FROM md_configuracoes WHERE cliente_id = $1`, [clienteId]),
    query(`SELECT ordem, documento_id, nome, data_upload, url FROM md_documentos WHERE cliente_id = $1 ORDER BY ordem`, [clienteId]),
  ]);
  return res.status(200).json({
    cliente: cliente.rows[0],
    contatos: contatos.rows,
    playlists: playlists.rows,
    configuracao: config.rows[0] || null,
    documentos: documentos.rows,
  });
}

async function handleList(req, res, q) {
  const page = Math.max(1, parseInt(q.page, 10) || 1);
  const limit = Math.min(500, Math.max(1, parseInt(q.limit, 10) || 50));
  const offset = (page - 1) * limit;

  const orderCol = ORDER_BY_WHITELIST.get(q.order_by) || "lower(c.nome_razaosocial)";
  const orderDir = String(q.order_dir).toUpperCase() === "DESC" ? "DESC" : "ASC";

  const conditions = [];
  const params = [];

  if (q.busca) {
    params.push(`%${q.busca}%`);
    conditions.push(`(c.nome_razaosocial ILIKE $${params.length} OR c.nome_fantasia ILIKE $${params.length} OR c.cnpj ILIKE $${params.length} OR c.email ILIKE $${params.length})`);
  }
  if (q.status === "1" || q.status === "0") {
    params.push(Number(q.status));
    conditions.push(`c.status = $${params.length}`);
  }
  if (q.estado) {
    params.push(q.estado);
    conditions.push(`c.estado = $${params.length}`);
  }
  if (q.com_playlist === "1" || q.com_playlist === "true") {
    conditions.push(`EXISTS (SELECT 1 FROM md_playlists p WHERE p.cliente_id = c.id)`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const totalRes = await query(`SELECT count(*) AS total FROM md_clientes c ${where}`, params);
  const total = Number(totalRes.rows[0]?.total) || 0;

  const dataRes = await query(
    `SELECT ${LIST_FIELDS}
     FROM md_clientes c
     ${where}
     ORDER BY ${orderCol} ${orderDir} NULLS LAST, c.id ASC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );

  return res.status(200).json({
    data: dataRes.rows,
    total,
    page,
    limit,
    pages: Math.max(1, Math.ceil(total / limit)),
  });
}
