const { query } = require("./_lib/db");
const { verifyToken, cors } = require("./_lib/auth");

// Colunas permitidas para ordenação (whitelist contra SQL injection)
const ORDER_BY_WHITELIST = new Set([
  "meses_sem_atualizacao",
  "contratante",
  "codigo",
  "valor_parcela",
  "valor_em_aberto",
  "parcelas_em_aberto",
  "ultimo_pagamento",
  "ultimo_vencimento",
]);

const MESES_OPCOES = [3, 6, 12, 24];
const SITUACOES = new Set(["todos", "sem_pagamento", "encerrado"]);

const SELECT_FIELDS = [
  "cliente",
  "contratante",
  "codigo",
  "alias_matriz",
  "status_contrato",
  "data_inicio",
  "data_termino",
  "forma_envio",
  "total_parcelas",
  "ultimo_pagamento",
  "ultimo_vencimento",
  "valor_parcela",
  "parcelas_em_aberto",
  "valor_em_aberto",
  "possui_contrato_ativo",
  "situacao",
  "meses_sem_atualizacao",
].join(", ");

const RESUMO_FIELDS = `
  COUNT(DISTINCT cliente) AS clientes,
  COUNT(*) AS contratos,
  COUNT(DISTINCT cliente) FILTER (WHERE status_contrato = 'Inativo') AS clientes_encerrados,
  COUNT(DISTINCT cliente) FILTER (
    WHERE status_contrato = 'Inativo' AND NOT possui_contrato_ativo
  ) AS clientes_encerrados_definitivo,
  COUNT(DISTINCT cliente) FILTER (
    WHERE status_contrato <> 'Inativo' AND ultimo_pagamento IS NULL
  ) AS clientes_nunca_pagaram,
  COALESCE(SUM(valor_parcela), 0) AS valor_mensal,
  COALESCE(SUM(parcelas_em_aberto), 0) AS parcelas_aberto,
  COALESCE(SUM(valor_em_aberto), 0) AS valor_aberto
`;

const VIEW = "v_sem_atualizacao";

/**
 * Handler principal do endpoint /api/sem-atualizacao
 *
 * @param {import("http").IncomingMessage} req
 * @param {import("http").ServerResponse}  res
 */
module.exports = async function handler(req, res) {
  cors(res);

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

  const {
    meses: mesesRaw,
    situacao: situacaoRaw,
    status_contrato,
    contratante,
    sem_contrato_ativo,
    page: pageRaw = "1",
    limit: limitRaw = "50",
    order_by: orderByRaw = "meses_sem_atualizacao",
    order_dir: orderDirRaw = "DESC",
  } = req.query || {};

  const page = Math.max(1, parseInt(pageRaw, 10) || 1);
  const limit = Math.min(500, Math.max(1, parseInt(limitRaw, 10) || 50));
  const offset = (page - 1) * limit;

  const mesesNum = parseInt(mesesRaw, 10);
  const meses = MESES_OPCOES.includes(mesesNum) ? mesesNum : 6;
  const situacao = SITUACOES.has(situacaoRaw) ? situacaoRaw : "todos";

  const orderBy = ORDER_BY_WHITELIST.has(orderByRaw) ? orderByRaw : "meses_sem_atualizacao";
  const orderDir = String(orderDirRaw).toUpperCase() === "ASC" ? "ASC" : "DESC";
  // NULL = nunca pagou, então precisa vir primeiro no topo da lista
  // Encerrados vão para o fim; dentro de cada grupo o mais antigo primeiro.
  const orderExpr =
    orderBy === "meses_sem_atualizacao"
      ? `(status_contrato = 'Inativo') ASC, meses_sem_atualizacao ${orderDir} NULLS FIRST, cliente ASC`
      : `${orderBy} ${orderDir} NULLS LAST, cliente ASC`;

  const conditions = [];
  const params = [];

  // "Sem pagamento" só vale para contratos Ativos que possuem histórico de
  // faturamento — contrato sem histórico não é evidência de inadimplência.
  // O parâmetro de meses só é enviado quando a condição realmente o usa.
  let condSemPagamento = null;
  if (situacao !== "encerrado") {
    params.push(meses);
    condSemPagamento =
      `(status_contrato <> 'Inativo' AND total_parcelas > 0` +
      ` AND (ultimo_pagamento IS NULL OR COALESCE(meses_sem_atualizacao, 999) >= $${params.length}))`;
  }

  if (situacao === "encerrado") {
    conditions.push(`status_contrato = 'Inativo'`);
  } else if (situacao === "sem_pagamento") {
    conditions.push(condSemPagamento);
  } else {
    conditions.push(`(${condSemPagamento} OR status_contrato = 'Inativo')`);
  }

  if (status_contrato === "Ativo" || status_contrato === "Inativo") {
    params.push(status_contrato);
    conditions.push(`status_contrato = $${params.length}`);
  }

  if (sem_contrato_ativo === "1" || sem_contrato_ativo === "true") {
    conditions.push(`NOT possui_contrato_ativo`);
  }

  if (contratante) {
    params.push(`%${contratante}%`);
    conditions.push(`cliente ILIKE $${params.length}`);
  }

  const whereClause = `WHERE ${conditions.join(" AND ")}`;

  try {
    const resumoResult = await query(
      `SELECT ${RESUMO_FIELDS} FROM ${VIEW} ${whereClause}`,
      params
    );

    const countResult = await query(
      `SELECT COUNT(*) AS total FROM ${VIEW} ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].total, 10);

    const dataResult = await query(
      `SELECT ${SELECT_FIELDS} FROM ${VIEW} ${whereClause}
       ORDER BY ${orderExpr}
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );

    const resumo = resumoResult.rows[0] || {};
    res.status(200).json({
      data: dataResult.rows,
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
      filtros: { meses, situacao, status_contrato: status_contrato || "", contratante: contratante || "" },
      resumo: {
        clientes: Number(resumo.clientes) || 0,
        contratos: Number(resumo.contratos) || 0,
        clientes_encerrados: Number(resumo.clientes_encerrados) || 0,
        clientes_encerrados_definitivo: Number(resumo.clientes_encerrados_definitivo) || 0,
        clientes_nunca_pagaram: Number(resumo.clientes_nunca_pagaram) || 0,
        valor_mensal: Number(resumo.valor_mensal) || 0,
        parcelas_aberto: Number(resumo.parcelas_aberto) || 0,
        valor_aberto: Number(resumo.valor_aberto) || 0,
      },
    });
  } catch (dbErr) {
    if (dbErr.code === "42P01" || dbErr.code === "42703") {
      return res.status(200).json({
        data: null,
        pending_schema: true,
        error: `View ${VIEW} ausente no banco. Execute sql/schema.sql para criar.`,
      });
    }
    console.error("[sem-atualizacao] Erro de banco de dados:", dbErr);
    res.status(500).json({
      error: "Erro interno ao consultar clientes sem atualização.",
      detail: process.env.NODE_ENV !== "production" ? dbErr.message : undefined,
    });
  }
};
