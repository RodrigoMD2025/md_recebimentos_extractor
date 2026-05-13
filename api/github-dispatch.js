const { verifyToken, cors } = require("./_lib/auth");
const {
  ensureGithubToken,
  getGithubConfig,
  githubRequest,
} = require("./_lib/github");

module.exports = async function handler(req, res) {
  cors(res, undefined, "POST, OPTIONS");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Metodo nao permitido. Use POST." });
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

  try {
    ensureGithubToken();
    const config = getGithubConfig();
    const body = await readJsonBody(req);

    await githubRequest(
      `/repos/${config.owner}/${config.repo}/actions/workflows/${config.workflowId}/dispatches`,
      {
        method: "POST",
        body: JSON.stringify({
          ref: body.ref || "main",
          inputs: body.inputs || {},
        }),
      }
    );

    res.status(204).end();
  } catch (err) {
    res.status(err.statusCode || 500).json({
      error: err.message || "Falha ao disparar workflow.",
    });
  }
};

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";

    req.on("data", (chunk) => {
      raw += chunk;
    });

    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch (_) {
        const err = new Error("Body JSON invalido.");
        err.statusCode = 400;
        reject(err);
      }
    });

    req.on("error", reject);
  });
}
