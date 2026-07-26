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
    semana,
    mes,
    contratante,
    data_inicio,
    data_termino,
    page: pageRaw = "1",
    limit: limitRaw = "100",
    order_by: orderByRaw = "data_termino",
    order_dir: orderDirRaw = "DESC",
  } = req.query || parseQuery(req.url);

  const page = Math.max(1, parseInt(pageRaw, 10) || 1);
  const limit = Math.min(500, Math.max(1, parseInt(limitRaw, 10) || 100));
  const offset = (page - 1) * limit;

  const orderByRawSafe = ORDER_BY_WHITELIST.has(orderByRaw) ? orderByRaw : "data_termino";
  const orderDir = orderDirRaw.toUpperCase() === "ASC" ? "ASC" : "DESC";
  const orderExpr = orderByRawSafe === "data_termino"
    ? `CASE WHEN data_termino ~ '^\\d{2}/\\d{2}/\\d{4}$' THEN TO_DATE(data_termino, 'DD/MM/YYYY') END ${orderDir} NULLS LAST, CASE WHEN data_termino !~ '^\\d{2}/\\d{2}/\\d{4}$' THEN data_termino END ${orderDir} NULLS LAST`
    : `${orderByRawSafe} ${orderDir}`;

  // Rota especial: /api/contratos?semana=1 retorna contratos vencendo esta semana (dom-sab)
  if (String(req.query?.semana) === "1") {
    try {
      const weekResult = await query(`
        SELECT COUNT(*) AS total FROM contratos
        WHERE status = 'Ativo'
          AND data_termino ~ '^\\d{2}/\\d{2}/\\d{4}$'
          AND TO_DATE(data_termino, 'DD/MM/YYYY') >= CURRENT_DATE - EXTRACT(DOW FROM CURRENT_DATE)::INT
          AND TO_DATE(data_termino, 'DD/MM/YYYY') <= CURRENT_DATE - EXTRACT(DOW FROM CURRENT_DATE)::INT + 6
      `, []);
      return res.status(200).json({ data: weekResult.rows });
    } catch (dbErr) {
      console.error("[contratos] Erro ao buscar semana:", dbErr);
      return res.status(500).json({ error: "Erro interno ao consultar semana." });
    }
  }

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

  // Rota especial: /api/contratos?relatorio=1 — último relatório de extração (ou por run_number)
  if (req.query && (String(req.query.relatorio) === "1" || String(req.query.relatorio) === "true")) {
    try {
      const runNumber = req.query.run_number ? String(req.query.run_number) : "";
      const since = req.query.since ? String(req.query.since) : "";
      const params = [];
      const conditions = [];

      if (runNumber) {
        params.push(runNumber);
        conditions.push(`github_run_number = $${params.length}`);
      }
      if (since) {
        params.push(since);
        conditions.push(`criado_em >= $${params.length}::timestamptz`);
      }

      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      const relatorioResult = await query(
        `
        SELECT
          id, github_run_id, github_run_number, total_extraidos,
          inserts, updates, pages, status, mensagem,
          duracao_segundos, criado_em
        FROM extracoes_contratos
        ${where}
        ORDER BY criado_em DESC
        LIMIT 1
        `,
        params
      );

      if (!relatorioResult.rows.length) {
        return res.status(200).json({ data: null });
      }

      const row = relatorioResult.rows[0];
      return res.status(200).json({
        data: {
          ...row,
          inserts: Number(row.inserts) || 0,
          updates: Number(row.updates) || 0,
          total_extraidos: Number(row.total_extraidos) || 0,
          pages: Number(row.pages) || 0,
          duracao_segundos: Number(row.duracao_segundos) || 0,
        },
      });
    } catch (dbErr) {
      // Tabela ainda não criada: retorna vazio em vez de quebrar o monitor
      if (dbErr.code === "42P01") {
        return res.status(200).json({ data: null, pending_schema: true });
      }
      console.error("[contratos] Erro ao buscar relatório:", dbErr);
      return res.status(500).json({ error: "Erro interno ao consultar relatório de extração." });
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

  if (mes) {
    const parts = mes.split("/");
    if (parts.length === 2) {
      const ano = parseInt(parts[1], 10);
      const mesNum = parseInt(parts[0], 10);
      if (ano > 2000 && mesNum >= 1 && mesNum <= 12) {
        conditions.push(`data_termino ~ '^\\d{2}/\\d{2}/\\d{4}$'`);
        conditions.push(`TO_DATE(data_termino, 'DD/MM/YYYY') >= $${params.length + 1}`);
        conditions.push(`TO_DATE(data_termino, 'DD/MM/YYYY') < $${params.length + 2}`);
        params.push(`${ano}-${String(mesNum).padStart(2, "0")}-01`);
        const nextMes = mesNum === 12 ? `${ano + 1}-01-01` : `${ano}-${String(mesNum + 1).padStart(2, "0")}-01`;
        params.push(nextMes);
      }
    }
  }

  if (data_inicio) {
    conditions.push(`data_termino ~ '^\\d{2}/\\d{2}/\\d{4}$'`);
    conditions.push(`TO_DATE(data_termino, 'DD/MM/YYYY') >= $${params.length + 1}::date`);
    params.push(data_inicio);
  }

  if (data_termino) {
    conditions.push(`data_termino ~ '^\\d{2}/\\d{2}/\\d{4}$'`);
    conditions.push(`TO_DATE(data_termino, 'DD/MM/YYYY') <= $${params.length + 1}::date`);
    params.push(data_termino);
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
      ORDER BY ${orderExpr}
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

  const { codigo, execucao_id, run_number, deleteAll } = req.query || parseQuery(req.url);

  if (!codigo && !execucao_id && !run_number && String(deleteAll) !== "true") {
    return res.status(400).json({ error: "codigo, execucao_id, run_number ou deleteAll=true é obrigatório para exclusão." });
  }

  try {
    let sql = "";
    let params = [];

    if (String(deleteAll) === "true") {
      sql = `DELETE FROM contratos`;
    } else if (codigo) {
      sql = `DELETE FROM contratos WHERE codigo = $1`;
      params = [codigo];
    } else {
      // Exclusão por execucao_id/run_number: limpa o relatório de extração
      const conditions = [];
      if (execucao_id) {
        params.push(execucao_id);
        conditions.push(`github_run_id = $${params.length}`);
      }
      if (run_number) {
        params.push(run_number);
        conditions.push(`github_run_number = $${params.length}`);
      }
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      sql = `DELETE FROM extracoes_contratos ${where}`;
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
