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

  // 2. Trata GET e DELETE
  if (req.method === "GET") {
    return handleGet(req, res);
  } else if (req.method === "DELETE") {
    return handleDelete(req, res);
  } else {
    res.status(405).json({ error: "Método não permitido." });
    return;
  }
};

/**
 * Lógica do GET
 */
async function handleGet(req, res) {

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
    execucao_id,
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
    if (status_pagamento === "pago") {
      conditions.push(`(status_pagamento ILIKE '%pago%' OR status_pagamento ILIKE '%recebido%')`);
    } else if (status_pagamento === "pendente") {
      conditions.push(`(status_pagamento NOT ILIKE '%pago%' AND status_pagamento NOT ILIKE '%recebido%' AND status_pagamento NOT ILIKE '%cancelado%')`);
    } else if (status_pagamento === "cancelado") {
      conditions.push(`status_pagamento ILIKE '%cancelado%'`);
    } else {
      params.push(`%${status_pagamento}%`);
      conditions.push(`status_pagamento ILIKE $${params.length}`);
    }
  }

  if (status_playlist) {
    if (status_playlist === "Com Playlist") {
      conditions.push(`status_playlist = 'Com Playlist'`);
    } else if (status_playlist === "Sem Playlist") {
      conditions.push(`status_playlist = 'Sem Playlist'`);
    } else {
      params.push(status_playlist);
      conditions.push(`status_playlist = $${params.length}`);
    }
  }
  
  if (execucao_id) {
    params.push(execucao_id);
    conditions.push(`execucao_id = $${params.length}`);
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // Se foi solicitado um resumo por execucao_id, retorne agregados (mais eficiente)
  const { summary } = req.query || parseQuery(req.url);
  if (execucao_id && (String(summary) === "1" || String(summary) === "true")) {
    try {
      const aggSql = `
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE status_pagamento ILIKE '%pago%' OR status_pagamento ILIKE '%recebido%') AS pagos,
          COUNT(*) FILTER (WHERE status_pagamento NOT ILIKE '%pago%' AND status_pagamento NOT ILIKE '%recebido%') AS pendentes,
          COUNT(*) FILTER (WHERE status_playlist = 'Com Playlist') AS com_playlist
        FROM recebimentos
        WHERE execucao_id = $1
      `;
      const aggRes = await query(aggSql, [execucao_id]);
      const row = aggRes.rows[0] || { total: 0, pagos: 0, pendentes: 0, com_playlist: 0 };
      return res.status(200).json({
        total: Number(row.total || 0),
        pagos: Number(row.pagos || 0),
        pendentes: Number(row.pendentes || 0),
        com_playlist: Number(row.com_playlist || 0),
      });
    } catch (err) {
      console.error('[recebimentos] Erro ao gerar resumo por execucao_id:', err);
      return res.status(500).json({ error: 'Erro interno ao gerar resumo.' });
    }
  }

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
}

/**
 * Lógica do DELETE
 */
async function handleDelete(req, res) {
  // 3. Verifica token Firebase
  try {
    await verifyToken(req);
  } catch (authErr) {
    res.status(authErr.statusCode || 401).json({ error: authErr.message });
    return;
  }

  const { execucao_id, run_number, deleteAll } = req.query || parseQuery(req.url);

  if (!execucao_id && !run_number && String(deleteAll) !== "true") {
    return res.status(400).json({ error: "execucao_id, run_number ou deleteAll=true é obrigatório para exclusão." });
  }

  try {
    let sql = "";
    let params = [];

    if (String(deleteAll) === "true") {
      sql = `DELETE FROM recebimentos`;
    } else {
      sql = `DELETE FROM recebimentos WHERE execucao_id = $1 OR execucao_id = $2`;
      params = [execucao_id, String(run_number || execucao_id)];
    }

    const result = await query(sql, params);

    res.status(200).json({
      message: `Sucesso ao excluir registros.`,
      deletedCount: result.rowCount,
    });
  } catch (dbErr) {
    console.error("[recebimentos] Erro ao excluir:", dbErr);
    res.status(500).json({ error: "Erro interno ao excluir registros." });
  }
}

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
