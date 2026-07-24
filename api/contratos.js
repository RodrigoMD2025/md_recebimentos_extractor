const { query } = require("./_lib/db");
const { verifyToken, cors } = require("./_lib/auth");

const ORDER_BY_WHITELIST = new Set([
  "codigo",
  "contratante",
  "alias_matriz",
  "data_inicio",
  "data_termino",
  "status",
  "criado_em",
]);

const SELECT_FIELDS = [
  "id",
  "codigo",
  "contratante",
  "alias_matriz",
  "data_inicio",
  "data_termino",
  "forma_envio",
  "status",
  "criado_em",
].join(", ");

module.exports = async function handler(req, res) {
  cors(res, undefined, "GET, DELETE, OPTIONS");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method === "GET") {
    return handleGet(req, res);
  } else if (req.method === "DELETE") {
    return handleDelete(req, res);
  } else {
    res.status(405).json({ error: "Método não permitido." });
  }
};

async function handleGet(req, res) {
  try {
    await verifyToken(req);
  } catch (authErr) {
    res.status(authErr.statusCode || 401).json({ error: authErr.message });
    return;
  }

  const {
    status,
    alerta,
    contratante,
    page: pageRaw = "1",
    limit: limitRaw = "100",
    order_by: orderByRaw = "data_termino",
    order_dir: orderDirRaw = "ASC",
  } = req.query || parseQuery(req.url);

  const page = Math.max(1, parseInt(pageRaw, 10) || 1);
  const limit = Math.min(500, Math.max(1, parseInt(limitRaw, 10) || 100));
  const offset = (page - 1) * limit;

  const orderBy = ORDER_BY_WHITELIST.has(orderByRaw) ? orderByRaw : "data_termino";
  const orderDir = orderDirRaw.toUpperCase() === "DESC" ? "DESC" : "ASC";

  // Rota especial: /api/contratos?alerta=1 retorna apenas a view de alertas
  if (String(alerta) === "1" || String(alerta) === "true") {
    try {
      const alertResult = await query("SELECT * FROM v_contratos_alerta", []);
      return res.status(200).json({ data: alertResult.rows });
    } catch (dbErr) {
      console.error("[contratos] Erro ao buscar alertas:", dbErr);
      return res.status(500).json({ error: "Erro interno ao consultar alertas." });
    }
  }

  // Rota especial: /api/contratos?grafico=1 retorna v_contratos_por_mes
  if (req.query && (String(req.query.grafico) === "1" || String(req.query.grafico) === "true")) {
    try {
      const graficoResult = await query("SELECT * FROM v_contratos_por_mes", []);
      return res.status(200).json({ data: graficoResult.rows });
    } catch (dbErr) {
      console.error("[contratos] Erro ao buscar dados do gráfico:", dbErr);
      return res.status(500).json({ error: "Erro interno ao consultar gráfico." });
    }
  }

  // Rota especial: /api/contratos?stats=1 retorna contadores
  if (req.query && (String(req.query.stats) === "1" || String(req.query.stats) === "true")) {
    try {
      const statsResult = await query(`
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE status = 'Ativo') AS ativos,
          COUNT(*) FILTER (WHERE status = 'Inativo') AS inativos
        FROM contratos
      `, []);
      return res.status(200).json(statsResult.rows[0] || { total: 0, ativos: 0, inativos: 0 });
    } catch (dbErr) {
      console.error("[contratos] Erro ao buscar stats:", dbErr);
      return res.status(500).json({ error: "Erro interno ao consultar estatísticas." });
    }
  }

  const conditions = [];
  const params = [];

  if (status) {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }

  if (contratante) {
    params.push(`%${contratante}%`);
    conditions.push(`contratante ILIKE $${params.length}`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  try {
    const countSql = `SELECT COUNT(*) AS total FROM contratos ${whereClause}`;
    const countResult = await query(countSql, params);
    const total = parseInt(countResult.rows[0].total, 10);

    const dataSql = `
      SELECT ${SELECT_FIELDS}
      FROM contratos
      ${whereClause}
      ORDER BY ${orderBy} ${orderDir}
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;
    const dataResult = await query(dataSql, [...params, limit, offset]);

    const pages = Math.ceil(total / limit);

    res.status(200).json({
      data: dataResult.rows,
      total,
      page,
      limit,
      pages,
    });
  } catch (dbErr) {
    console.error("[contratos] Erro de banco de dados:", dbErr);
    res.status(500).json({
      error: "Erro interno ao consultar contratos.",
      detail: process.env.NODE_ENV !== "production" ? dbErr.message : undefined,
    });
  }
}

async function handleDelete(req, res) {
  try {
    await verifyToken(req);
  } catch (authErr) {
    res.status(authErr.statusCode || 401).json({ error: authErr.message });
    return;
  }

  const { codigo, deleteAll } = req.query || parseQuery(req.url);

  if (!codigo && String(deleteAll) !== "true") {
    return res.status(400).json({ error: "codigo ou deleteAll=true é obrigatório para exclusão." });
  }

  try {
    let sql = "";
    let params = [];

    if (String(deleteAll) === "true") {
      sql = `DELETE FROM contratos`;
    } else {
      sql = `DELETE FROM contratos WHERE codigo = $1`;
      params = [codigo];
    }

    const result = await query(sql, params);

    res.status(200).json({
      message: "Sucesso ao excluir registros.",
      deletedCount: result.rowCount,
    });
  } catch (dbErr) {
    console.error("[contratos] Erro ao excluir:", dbErr);
    res.status(500).json({ error: "Erro interno ao excluir registros." });
  }
}

function parseQuery(url = "") {
  const idx = url.indexOf("?");
  if (idx === -1) return {};
  const qs = url.slice(idx + 1);
  return Object.fromEntries(new URLSearchParams(qs));
}
