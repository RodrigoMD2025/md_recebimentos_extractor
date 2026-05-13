const { query } = require("./_lib/db");
const { verifyToken, cors } = require("./_lib/auth");

// Colunas permitidas para ordenação (whitelist contra SQL injection)
const ORDER_BY_WHITELIST = new Set([
  "contratante",
  "vencimento",
  "valor_parcela",
  "criado_em",
]);

// Campos retornados no SELECT
const SELECT_FIELDS = [
  "id",
  "ano",
  "contratante",
  "codigo_contrato",
  "vencimento",
  "valor_parcela",
  "status_pagamento",
  "pago_em",
  "status_playlist",
  "playlists",
  "periodo",
  "faixas",
  "execucao_id",
  "criado_em",
].join(", ");

/**
 * Handler principal do endpoint /api/recebimentos
 *
 * @param {import("http").IncomingMessage} req
 * @param {import("http").ServerResponse}  res
 */
module.exports = async function handler(req, res) {
  cors(res);

  // 1. Trata OPTIONS (CORS preflight)
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  // 2. Só aceita GET
  if (req.method !== "GET") {
    res.status(405).json({ error: "Método não permitido. Use GET." });
    return;
  }

  // 3. Verifica token Firebase
  try {
    await verifyToken(req);
  } catch (authErr) {
    res
      .status(authErr.statusCode || 401)
      .json({ error: authErr.message });
    return;
  }

  // 4. Lê e valida query params
  const {
    ano,
    contratante,
    status_pagamento,
    status_playlist,
    page: pageRaw = "1",
    limit: limitRaw = "50",
    order_by: orderByRaw = "contratante",
    order_dir: orderDirRaw = "ASC",
  } = req.query || parseQuery(req.url);

  const page = Math.max(1, parseInt(pageRaw, 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(limitRaw, 10) || 50));
  const offset = (page - 1) * limit;

  const orderBy = ORDER_BY_WHITELIST.has(orderByRaw) ? orderByRaw : "contratante";
  const orderDir = orderDirRaw.toUpperCase() === "DESC" ? "DESC" : "ASC";

  // 5. Monta cláusulas WHERE com parâmetros numerados
  const conditions = [];
  const params = [];

  if (ano) {
    params.push(parseInt(ano, 10));
    conditions.push(`ano = $${params.length}`);
  }

  if (contratante) {
    params.push(`%${contratante}%`);
    conditions.push(`contratante ILIKE $${params.length}`);
  }

  if (status_pagamento) {
    params.push(status_pagamento);
    conditions.push(`status_pagamento = $${params.length}`);
  }

  if (status_playlist) {
    if (status_playlist === "Com Playlist") {
      conditions.push(
        `(status_playlist = 'Com Playlist' OR (playlists IS NOT NULL AND playlists <> ''))`
      );
    } else if (status_playlist === "Sem Playlist") {
      conditions.push(
        `(status_playlist = 'Sem Playlist' OR playlists IS NULL OR playlists = '')`
      );
    } else {
      // valor literal passado diretamente
      params.push(status_playlist);
      conditions.push(`status_playlist = $${params.length}`);
    }
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  try {
    // COUNT (reutiliza os mesmos params)
    const countSql = `SELECT COUNT(*) AS total FROM recebimentos ${whereClause}`;
    const countResult = await query(countSql, params);
    const total = parseInt(countResult.rows[0].total, 10);

    // SELECT paginado
    const dataSql = `
      SELECT ${SELECT_FIELDS}
      FROM recebimentos
      ${whereClause}
      ORDER BY ${orderBy} ${orderDir}
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;
    const dataParams = [...params, limit, offset];
    const dataResult = await query(dataSql, dataParams);

    // execucao_ids distintos do conjunto retornado
    const execucaoIdsSql = `
      SELECT DISTINCT execucao_id
      FROM recebimentos
      ${whereClause}
      ORDER BY execucao_id
    `;
    const execucaoResult = await query(execucaoIdsSql, params);
    const execucao_ids = execucaoResult.rows
      .map((r) => r.execucao_id)
      .filter(Boolean);

    const pages = Math.ceil(total / limit);

    // 6. Retorna JSON
    res.status(200).json({
      data: dataResult.rows,
      total,
      page,
      limit,
      pages,
      execucao_ids,
    });
  } catch (dbErr) {
    console.error("[recebimentos] Erro de banco de dados:", dbErr);
    res.status(500).json({
      error: "Erro interno ao consultar recebimentos.",
      detail: process.env.NODE_ENV !== "production" ? dbErr.message : undefined,
    });
  }
};

// ---------------------------------------------------------------------------
// Utilitário: parse manual de query string (fallback quando req.query não
// está disponível — ex.: ambiente de testes fora do runtime Vercel)
// ---------------------------------------------------------------------------
function parseQuery(url = "") {
  const idx = url.indexOf("?");
  if (idx === -1) return {};
  const qs = url.slice(idx + 1);
  return Object.fromEntries(new URLSearchParams(qs));
}
