const { query } = require("./_lib/db");
const { verifyToken, cors } = require("./_lib/auth");

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

  const { ids } = req.query || parseQuery(req.url);
  if (!ids) {
    return res.status(400).json({ error: "Parâmetro ids é obrigatório." });
  }

  const execucaoIds = String(ids)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (!execucaoIds.length) {
    return res.status(400).json({ error: "Parâmetro ids deve conter ao menos um valor." });
  }

  try {
    const sql = `
      SELECT execucao_id, ARRAY_AGG(DISTINCT ano ORDER BY ano) AS anos
      FROM recebimentos
      WHERE execucao_id = ANY($1)
      GROUP BY execucao_id
    `;
    const result = await query(sql, [execucaoIds]);

    const years_by_execucao_id = result.rows.reduce((acc, row) => {
      acc[row.execucao_id] = row.anos || [];
      return acc;
    }, {});

    res.status(200).json({ years_by_execucao_id });
  } catch (dbErr) {
    console.error("[execucao-anos] Erro de banco de dados:", dbErr);
    res.status(500).json({
      error: "Erro interno ao consultar anos por execução.",
      detail: process.env.NODE_ENV !== "production" ? dbErr.message : undefined,
    });
  }
};

function parseQuery(url = "") {
  const idx = url.indexOf("?");
  if (idx === -1) return {};
  return Object.fromEntries(new URLSearchParams(url.slice(idx + 1)));
}
