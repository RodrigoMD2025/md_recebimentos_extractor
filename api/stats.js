const { query } = require("./_lib/db");
const { verifyToken, cors } = require("./_lib/auth");

/**
 * Handler principal do endpoint /api/stats
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

  // Lê query param "ano"
  const { ano } = req.query || parseQuery(req.url);

  try {
    // 4. Executa TRÊS queries em paralelo
    const [statsResult, distResult, anosResult] = await Promise.all([
      // a) Estatísticas agregadas por ano
      buildStatsQuery(ano),

      // b) Distribuição de status
      buildDistQuery(ano),

      // c) Lista de anos disponíveis
      query(
        "SELECT DISTINCT ano FROM recebimentos ORDER BY ano DESC",
        []
      ),
    ]);

    // 5. Monta e retorna resposta
    res.status(200).json({
      stats_por_ano: statsResult.rows,
      status_distribuicao: distResult.rows,
      anos_disponiveis: anosResult.rows.map((r) => r.ano),
    });
  } catch (dbErr) {
    console.error("[stats] Erro de banco de dados:", dbErr);
    res.status(500).json({
      error: "Erro interno ao consultar estatísticas.",
      detail: process.env.NODE_ENV !== "production" ? dbErr.message : undefined,
    });
  }
};

// ---------------------------------------------------------------------------
// Helpers de query
// ---------------------------------------------------------------------------

/**
 * Consulta a view v_stats_por_ano, opcionalmente filtrando por ano.
 *
 * @param {string|undefined} ano
 * @returns {Promise<import("pg").QueryResult>}
 */
function buildStatsQuery(ano) {
  if (ano) {
    return query(
      "SELECT * FROM v_stats_por_ano WHERE ano = $1",
      [parseInt(ano, 10)]
    );
  }
  return query("SELECT * FROM v_stats_por_ano", []);
}

/**
 * Consulta a view v_status_distribuicao, opcionalmente filtrando por ano.
 *
 * @param {string|undefined} ano
 * @returns {Promise<import("pg").QueryResult>}
 */
function buildDistQuery(ano) {
  if (ano) {
    return query(
      "SELECT * FROM v_status_distribuicao WHERE ano = $1",
      [parseInt(ano, 10)]
    );
  }
  return query("SELECT * FROM v_status_distribuicao", []);
}

// ---------------------------------------------------------------------------
// Utilitário: parse manual de query string (fallback fora do runtime Vercel)
// ---------------------------------------------------------------------------
function parseQuery(url = "") {
  const idx = url.indexOf("?");
  if (idx === -1) return {};
  const qs = url.slice(idx + 1);
  return Object.fromEntries(new URLSearchParams(qs));
}
