const { verifyToken, cors } = require("./_lib/auth");
const { getGithubConfig } = require("./_lib/github");

module.exports = async function handler(req, res) {
  cors(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "GET") {
    res.status(405).json({ error: "Metodo nao permitido. Use GET." });
    return;
  }

  try {
    await verifyToken(req);
  } catch (authErr) {
    res
      .status(authErr.statusCode || 401)
      .json({ error: authErr.message });
    return;
  }

  const config = getGithubConfig();

  res.status(200).json({
    owner: config.owner,
    repo: config.repo,
    workflowId: config.workflowId,
    hasToken: config.hasToken,
  });
};
