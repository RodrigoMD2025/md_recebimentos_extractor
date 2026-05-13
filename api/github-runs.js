const { verifyToken, cors } = require("./_lib/auth");
const { getGithubConfig, githubRequest } = require("./_lib/github");

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
  const query = req.query || parseQuery(req.url);
  const perPage = Math.min(100, Math.max(1, Number(query.per_page) || 50));
  const page = Math.max(1, Number(query.page) || 1);
  const withInputs = query.with_inputs === "true";

  try {
    const data = await githubRequest(
      `/repos/${config.owner}/${config.repo}/actions/runs?per_page=${perPage}&page=${page}`
    );

    let workflow_runs = data?.workflow_runs || [];

    if (withInputs && page === 1) {
      const runsToFetch = workflow_runs.slice(0, 6);
      await Promise.all(
        runsToFetch.map(async (run) => {
          try {
            const runDetails = await githubRequest(
              `/repos/${config.owner}/${config.repo}/actions/runs/${run.id}`
            );
            run.inputs = runDetails?.inputs || {};
          } catch (e) {
            run.inputs = {};
          }
        })
      );
    }

    res.status(200).json({
      owner: config.owner,
      repo: config.repo,
      workflowId: config.workflowId,
      hasToken: config.hasToken,
      workflow_runs: workflow_runs,
      total_count: data?.total_count || 0,
    });
  } catch (githubErr) {
    res.status(githubErr.statusCode || 500).json({
      error: githubErr.message,
    });
  }
};

function parseQuery(url = "") {
  const idx = url.indexOf("?");
  if (idx === -1) return {};
  return Object.fromEntries(new URLSearchParams(url.slice(idx + 1)));
}
