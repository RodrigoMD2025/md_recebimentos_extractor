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

// Vinculos da playlist já cruzados com a base de contratos (codigo MD<n>).
const VINCULOS_SQL = `
  SELECT v.id, v.playlist_id, v.cliente_id, v.nome_cliente, v.codigo_contrato,
         v.codigo_numero, v.tocar_sazonal, v.data_inicial, v.data_final,
         ct.contratante, ct.alias_matriz, ct.status AS contrato_status,
         ct.data_inicio AS contrato_inicio, ct.data_termino AS contrato_termino,
         ct.forma_envio AS contrato_forma_envio
  FROM md_playlist_clientes v
  LEFT JOIN LATERAL (
    SELECT contratante, alias_matriz, status, data_inicio, data_termino, forma_envio
    FROM contratos c
    WHERE c.codigo = v.codigo_contrato
    ORDER BY c.criado_em DESC NULLS LAST, c.id DESC
    LIMIT 1
  ) ct ON true
  WHERE v.playlist_id = ANY($1::int[])
  ORDER BY v.playlist_id, v.id
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
    if (q.playlist) {
      return await handlePlaylist(res, q.playlist);
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
  const [stats, playlists, detalhes, vinculos, cruzados, estados] = await Promise.all([
    query(`
      SELECT count(*) AS total,
             count(*) FILTER (WHERE status = 1) AS ativos,
             count(*) FILTER (WHERE status = 0) AS inativos,
             count(*) FILTER (WHERE coleta_completa = 1) AS completos
      FROM md_clientes
    `),
    query(`SELECT count(*) AS total, count(DISTINCT cliente_id) AS clientes FROM md_playlists`),
    query(`SELECT count(*) AS total FROM md_playlist_detalhes WHERE titulo IS NOT NULL`),
    query(`SELECT count(*) AS total, count(DISTINCT playlist_id) AS playlists FROM md_playlist_clientes`),
    query(`SELECT count(*) AS total FROM md_playlist_clientes WHERE codigo_numero IS NOT NULL AND EXISTS (SELECT 1 FROM contratos c WHERE c.codigo = md_playlist_clientes.codigo_contrato)`),
    query(`
      SELECT COALESCE(NULLIF(btrim(estado), ''), '—') AS estado, count(*) AS total
      FROM md_clientes
      GROUP BY 1
      ORDER BY total DESC
    `),
  ]);
  const s = stats.rows[0] || {};
  return res.status(200).json({
    total: Number(s.total) || 0,
    ativos: Number(s.ativos) || 0,
    inativos: Number(s.inativos) || 0,
    completos: Number(s.completos) || 0,
    playlists: Number(playlists.rows[0]?.total) || 0,
    clientes_com_playlist: Number(playlists.rows[0]?.clientes) || 0,
    playlists_detalhadas: Number(detalhes.rows[0]?.total) || 0,
    vinculos: Number(vinculos.rows[0]?.total) || 0,
    playlists_com_vinculos: Number(vinculos.rows[0]?.playlists) || 0,
    vinculos_cruzados: Number(cruzados.rows[0]?.total) || 0,
    estados: estados.rows,
  });
}

async function carregarPlaylists(clienteId) {
  const pls = await query(`
    SELECT id, cliente_id, ordem, playlist_id, nome, codigo, nao_mesclar, data_vinculacao, url
    FROM md_playlists
    WHERE cliente_id = $1
    ORDER BY ordem, id
  `, [clienteId]);
  const ids = pls.rows.map((p) => p.playlist_id).filter((n) => Number.isFinite(n));
  if (!ids.length) return [];

  const [detalhes, vinculos] = await Promise.all([
    query(`SELECT * FROM md_playlist_detalhes WHERE playlist_id = ANY($1::int[])`, [ids]),
    query(VINCULOS_SQL, [ids]),
  ]);
  const detalhePorId = new Map(detalhes.rows.map((d) => [d.playlist_id, d]));
  const vinculosPorId = new Map();
  for (const v of vinculos.rows) {
    if (!vinculosPorId.has(v.playlist_id)) vinculosPorId.set(v.playlist_id, []);
    vinculosPorId.get(v.playlist_id).push(v);
  }
  return pls.rows.map((p) => ({
    ...p,
    detalhe: detalhePorId.get(p.playlist_id) || null,
    vinculos: vinculosPorId.get(p.playlist_id) || [],
  }));
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
  const [contatos, playlists] = await Promise.all([
    query(`SELECT ordem, cargo_area, nome, email, telefone_celular FROM md_contatos WHERE cliente_id = $1 ORDER BY ordem`, [clienteId]),
    carregarPlaylists(clienteId),
  ]);
  return res.status(200).json({
    cliente: cliente.rows[0],
    contatos: contatos.rows,
    playlists,
  });
}

async function handlePlaylist(res, id) {
  const playlistId = parseInt(id, 10);
  if (!Number.isFinite(playlistId)) {
    return res.status(400).json({ error: "playlist inválida." });
  }
  const [detalhe, vinculos, clientes] = await Promise.all([
    query(`SELECT * FROM md_playlist_detalhes WHERE playlist_id = $1`, [playlistId]),
    query(VINCULOS_SQL, [[playlistId]]),
    query(`
      SELECT p.cliente_id AS id, p.nome, p.codigo, p.data_vinculacao, p.url,
             c.nome_razaosocial, c.nome_fantasia, c.status
      FROM md_playlists p
      JOIN md_clientes c ON c.id = p.cliente_id
      WHERE p.playlist_id = $1
      ORDER BY p.ordem, p.id
    `, [playlistId]),
  ]);
  if (!detalhe.rows.length && !vinculos.rows.length && !clientes.rows.length) {
    return res.status(404).json({ error: "Playlist não encontrada." });
  }
  return res.status(200).json({
    detalhe: detalhe.rows[0] || null,
    vinculos: vinculos.rows,
    clientes: clientes.rows,
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
