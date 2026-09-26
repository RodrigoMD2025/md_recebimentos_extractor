const { query } = require("./_lib/db");
const { verifyToken, cors } = require("./_lib/auth");

// Colunas permitidas para ordenação (whitelist contra SQL injection)
const ORDER_BY_WHITELIST = new Set([
  "prioridade",
  "dias_sem_contrato",
  "dias_atraso",
  "cliente",
  "codigo",
  "valor_parcela",
  "valor_referencia",
  "valor_em_aberto",
  "parcelas_em_aberto",
  "parcelas_vencidas",
  "valor_vencido",
  "ultimo_pagamento",
  "ultimo_vencimento",
]);

// Segmentos do ciclo real do negócio (ver v_sem_atualizacao)
const SITUACOES = new Set([
  "todos",
  "atraso",
  "ciclo_encerrado",
  "nunca_pagou",
  "sem_faturamento",
  "cliente_ativo",
  "nao_ativo",
  "corte_antecipado",
]);

// Janelas de tempo: "parado há mais de N dias" (o ciclo é anual, então a
// pergunta útil é desde o fim do contrato, não desde o último pagamento).
const DIAS_OPCOES = [90, 180, 365, 730];

const SELECT_FIELDS = [
  "cliente",
  "contratante",
  "codigo",
  "alias_matriz",
  "status_contrato",
  "data_inicio",
  "data_termino",
  "forma_envio",
  "duracao_dias",
  "encerrado_cedo",
  "total_parcelas",
  "ultimo_pagamento",
  "ultimo_vencimento",
  "valor_parcela",
  "valor_referencia",
  "parcelas_em_aberto",
  "valor_em_aberto",
  "parcelas_vencidas",
  "valor_vencido",
  "ciclo_fechado",
  "reassinou_depois",
  "inicio_novo_contrato",
  "fim_contrato",
  "dias_sem_contrato",
  "dias_atraso",
  "situacao",
  "prioridade",
  "duracao_dias",
  "cancelado_confirmado",
].join(", ");

const RESUMO_FIELDS = `
  COUNT(DISTINCT cliente) AS clientes,
  COUNT(*) AS contratos,
  COUNT(DISTINCT cliente) FILTER (WHERE situacao = 'atraso') AS clientes_atraso,
  COUNT(DISTINCT cliente) FILTER (WHERE situacao = 'nao_ativo') AS clientes_nao_ativos,
  COUNT(DISTINCT cliente) FILTER (WHERE situacao = 'corte_antecipado') AS clientes_corte_antecipado,
  COUNT(DISTINCT cliente) FILTER (WHERE situacao = 'ciclo_encerrado') AS clientes_ciclo_encerrado,
  COUNT(DISTINCT cliente) FILTER (WHERE situacao = 'nunca_pagou') AS clientes_nunca_pagou,
  COUNT(DISTINCT cliente) FILTER (WHERE situacao = 'sem_faturamento') AS clientes_sem_faturamento,
  COALESCE(SUM(parcelas_em_aberto), 0) AS parcelas_aberto,
  COALESCE(SUM(valor_em_aberto), 0) AS valor_aberto,
  COALESCE(SUM(parcelas_vencidas), 0) AS parcelas_vencidas,
  COALESCE(SUM(valor_vencido), 0) AS valor_vencido,
  COALESCE(SUM(valor_referencia), 0) AS valor_referencia
`;

const VIEW = "v_sem_atualizacao";

/**
 * Handler principal do endpoint /api/sem-atualizacao
 *
 * Lista clientes que exigem ação, segmentados pelo ciclo do negócio:
 *   atraso  ainda dentro do contrato e com parcelas em aberto (cobrança)
 *   ciclo_encerrado  o ciclo acabou e o cliente não assinou outro (renegociação)
 *   nao_ativo       não tem contrato em vigor, pagou conosco e está na carência
 *                   (a única parcela em aberto é a final, da janela de aviso)
 *   corte_antecipado saiu no meio do ciclo, sem cumprir o prazo
 *   nunca_pagou      tem parcelas emitidas e nenhuma paga
 *   sem_faturamento  contrato Ativo que nunca emitiu uma parcela
 *
 * Cliente que já assinou outro contrato depois (reassinou_depois) sai da lista
 * por padrão: ele voltou, não é lead nem caso perdido.
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
    dias: diasRaw,
    situacao: situacaoRaw,
    status_contrato,
    contratante,
    incluir_reativados,
    incluir_ativos,
    page: pageRaw = "1",
    limit: limitRaw = "50",
    order_by: orderByRaw = "prioridade",
    order_dir: orderDirRaw = "ASC",
  } = req.query || {};

  const page = Math.max(1, parseInt(pageRaw, 10) || 1);
  const limit = Math.min(500, Math.max(1, parseInt(limitRaw, 10) || 50));
  const offset = (page - 1) * limit;

  const diasNum = parseInt(diasRaw, 10);
  const dias = DIAS_OPCOES.includes(diasNum) ? diasNum : 0;
  const situacao = SITUACOES.has(situacaoRaw) ? situacaoRaw : "todos";

  const orderBy = ORDER_BY_WHITELIST.has(orderByRaw) ? orderByRaw : "prioridade";
  const orderDir = String(orderDirRaw).toUpperCase() === "DESC" ? "DESC" : "ASC";

  const incluirReativados = incluir_reativados === "1" || incluir_reativados === "true";

  // "cliente_ativo" nao exige acao: esta dentro do prazo e pagando. Fica fora
  // da lista por padrao porque a cobranca e mensal antecipada com liquidacao
  // anual, e parcela vencida em aberto dentro do ciclo e o comportamento normal.
  const incluirAtivos = incluir_ativos === "1" || incluir_ativos === "true";

  const conditions = [];
  const params = [];

  // Cliente que a gestao ja confirmou como cancelado nao e alvo de acao: nao ha
  // o que cobrar nem o que renegociar. Entra aqui uma unica vez, fora de todos os
  // filtros, para nao depender de cada combinacao -- injetar a condicao dentro
  // dos filtros ja vazou uma vez num OR, porque AND liga antes que OR.
  conditions.push("NOT cancelado_confirmado");

  // A lista e so dos segmentos acionaveis. "todos" = os quatro.
  if (situacao === "todos") {
    if (incluirAtivos) {
      conditions.push(
        `(situacao IN ('atraso','nao_ativo','corte_antecipado','ciclo_encerrado','nunca_pagou','sem_faturamento')` +
        ` OR situacao = 'cliente_ativo')`
      );
    } else {
      conditions.push(
        `situacao IN ('atraso','nao_ativo','corte_antecipado','ciclo_encerrado','nunca_pagou','sem_faturamento')`
      );
    }
  } else {
    params.push(situacao);
    conditions.push(`situacao = $${params.length}`);
  }

  // "Parado ha" so faz sentido para ciclo encerrado e contrato sem
  // faturamento. Atraso e nunca-pagou sao cobranca de contrato vigente e nao
  // devem sumir da lista quando o filtro de tempo aumenta.
  if (dias > 0) {
    params.push(dias);
    conditions.push(
      `(situacao NOT IN ('nao_ativo','corte_antecipado','ciclo_encerrado','sem_faturamento')` +
      ` OR (dias_sem_contrato IS NOT NULL AND dias_sem_contrato >= $${params.length}))`
    );
  }

  if (status_contrato === "Ativo" || status_contrato === "Inativo") {
    params.push(status_contrato);
    conditions.push(`status_contrato = $${params.length}`);
  }

  if (contratante) {
    params.push(`%${contratante}%`);
    conditions.push(`cliente ILIKE $${params.length}`);
  }

  // Cliente que já voltou a ser cliente: só entra se explicitamente pedido.
  if (!incluirReativados) {
    conditions.push(`NOT reassinou_depois`);
  }

  const whereClause = `WHERE ${conditions.join(" AND ")}`;

  // Os cards contam sempre os quatro segmentos, ignorando o filtro de segmento,
  // busca e status: eles são a navegação da tela e precisam continuar mostrando
  // para onde dá para ir. Só a janela de tempo e o toggle de reativados pesam.
  const cardConditions = [];
  const cardParams = [];
  // "Parado ha" so faz sentido para cliente nao ativo, ciclo encerrado e contrato
  // sem faturamento. Atraso e nunca-pagou sao cobranca de contrato vigente e
  // nao devem sumir da lista quando o filtro de tempo aumenta.
  if (dias > 0) {
    cardParams.push(dias);
    cardConditions.push(
      `(situacao NOT IN ('nao_ativo','corte_antecipado','ciclo_encerrado','sem_faturamento')` +
      ` OR (dias_sem_contrato IS NOT NULL AND dias_sem_contrato >= $${cardParams.length}))`
    );
  }
  if (!incluirReativados) {
    cardConditions.push(`NOT reassinou_depois`);
  }
  // Mesma supressao da lista: os cards contam navegacao, e um cancelado
  // confirmado nao pode inflar nenhum deles.
  cardConditions.push(`NOT cancelado_confirmado`);
  const cardWhere = `WHERE situacao IN ('atraso','nao_ativo','corte_antecipado','ciclo_encerrado','nunca_pagou','sem_faturamento')${
    cardConditions.length ? " AND " + cardConditions.join(" AND ") : ""
  }`;

  // Prioridade = ordem de acao, e nao de gravidade do cliente: 0 cliente ativo
  // (nada a fazer), 1 cobranca, 2 renovacao pendente (papelada), 3 corte
  // antecipado, 4 ciclo encerrado (churn, o unico detector validado), 5 nunca
  // pagou, 6 contrato sem faturamento. Dentro do grupo, o lead mais recente vem
  // primeiro - e o que ainda esta dentro da janela de retorno.
  const secondary = orderBy === "prioridade" ? "dias_sem_contrato ASC NULLS LAST" : `${orderBy} ${orderDir} NULLS LAST`;
  // NULLS LAST explicito: com DESC o Postgres colocaria vazios primeiro, e
  // "linhas sem atraso" no topo da lista de cobrança seria o oposto do útil.
  const orderExpr = `${orderBy} ${orderDir} NULLS LAST, ${secondary}, cliente ASC`;

  try {
    const [resumoResult, cardsResult] = await Promise.all([
      query(`SELECT ${RESUMO_FIELDS} FROM ${VIEW} ${whereClause}`, params),
      query(`SELECT ${RESUMO_FIELDS} FROM ${VIEW} ${cardWhere}`, cardParams),
    ]);

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
    const cards = cardsResult.rows[0] || {};
    res.status(200).json({
      data: dataResult.rows,
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
      filtros: {
        dias,
        situacao,
        status_contrato: status_contrato || "",
        contratante: contratante || "",
        incluir_reativados: incluirReativados,
      },
      resumo: {
        clientes: Number(resumo.clientes) || 0,
        contratos: Number(resumo.contratos) || 0,
        // Navegacao: sempre os quatro segmentos,independentemente do filtro aplicado.
        clientes_atraso: Number(cards.clientes_atraso) || 0,
        clientes_nao_ativos: Number(cards.clientes_nao_ativos) || 0,
        clientes_corte_antecipado: Number(cards.clientes_corte_antecipado) || 0,
        clientes_ciclo_encerrado: Number(cards.clientes_ciclo_encerrado) || 0,
        clientes_nunca_pagou: Number(cards.clientes_nunca_pagou) || 0,
        clientes_sem_faturamento: Number(cards.clientes_sem_faturamento) || 0,
        parcelas_vencidas: Number(cards.parcelas_vencidas) || 0,
        valor_vencido: Number(cards.valor_vencido) || 0,
        // Detalhe da lista filtrada.
        parcelas_aberto: Number(resumo.parcelas_aberto) || 0,
        valor_aberto: Number(resumo.valor_aberto) || 0,
        valor_referencia: Number(resumo.valor_referencia) || 0,
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
