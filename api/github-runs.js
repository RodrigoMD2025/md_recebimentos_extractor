const { verifyToken, cors } = require("./_lib/auth");
const { getGithubConfig, githubRequest } = require("./_lib/github");

module.exports = async function handler(req, res) {
  cors(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  // 3. Verifica token Firebase
  try {
    await verifyToken(req);
  } catch (authErr) {
    res.status(authErr.statusCode || 401).json({ error: authErr.message });
    return;
  }

  if (req.method === "GET") {
    return handleGet(req, res);
  } else if (req.method === "DELETE") {
    return handleDelete(req, res);
  } else {
    res.status(405).json({ error: "Metodo nao permitido." });
    return;
  }
};

function extractYearsFromText(text) {
  if (!text || typeof text !== "string") return [];
  return Array.from(new Set((text.match(/\b20\d{2}\b/g) || []).map(String))).sort();
}

async function handleGet(req, res) {
  const config = getGithubConfig();
  const query = req.query || parseQuery(req.url);
  const perPage = Math.min(100, Math.max(1, Number(query.per_page) || 50));
  const page = Math.max(1, Number(query.page) || 1);
  const withInputs = query.with_inputs === "true";

  try {
    const data = await githubRequest(
      `/repos/${config.owner}/${config.repo}/actions/workflows/${config.workflowId}/runs?per_page=${perPage}&page=${page}`
    );

    let workflow_runs = data?.workflow_runs || [];

    if (withInputs) {
      // Enriquecer todas as runs retornadas com inputs (anos processados).
      await Promise.all(
        workflow_runs.map(async (run) => {
          try {
            const runDetails = await githubRequest(
              `/repos/${config.owner}/${config.repo}/actions/runs/${run.id}`
            );

            if (runDetails?.display_title) {
              run.display_title = run.display_title || runDetails.display_title;
            }
            if (runDetails?.name) {
              run.name = run.name || runDetails.name;
            }

            const detailInputs = {
              ...(runDetails?.inputs || {}),
              ...((typeof runDetails?.event === "object" && runDetails.event?.inputs)
                ? runDetails.event.inputs
                : {}),
              ...((runDetails?.workflow_dispatch?.inputs)
                ? runDetails.workflow_dispatch.inputs
                : {}),
              ...((runDetails?.payload?.inputs)
                ? runDetails.payload.inputs
                : {}),
            };

            if (Object.keys(detailInputs).length > 0) {
              run.inputs = { ...run.inputs, ...detailInputs };
            }

            const currentYears = extractYearsFromText(
              run.inputs?.anos || run.inputs?.ano || run.display_title || run.name,
            );

            if (currentYears.length === 0) {
              try {
                const jobsData = await githubRequest(
                  `/repos/${config.owner}/${config.repo}/actions/runs/${run.id}/jobs?per_page=100`,
                );
                const jobYears = Array.from(
                  new Set(
                    (jobsData?.jobs || [])
                      .flatMap((job) => extractYearsFromText(job.name))
                      .filter(Boolean),
                  ),
                );

                if (jobYears.length > 0) {
                  run.inputs = { ...run.inputs, anos: jobYears.join(",") };
                }
              } catch (jobsErr) {
                // Silencioso, se os jobs não estiverem disponíveis.
              }
            }
          } catch (e) {
            // Silencioso
          }
        }),
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
}

async function handleDelete(req, res) {
  const config = getGithubConfig();
  const { id } = req.query || parseQuery(req.url);

  if (!id) {
    return res.status(400).json({ error: "ID da execução é obrigatório." });
  }

  try {
    await githubRequest(
      `/repos/${config.owner}/${config.repo}/actions/runs/${id}`,
      { method: "DELETE" }
    );
    res.status(200).json({ message: "Execução excluída com sucesso do GitHub." });
  } catch (githubErr) {
    res.status(githubErr.statusCode || 500).json({
      error: githubErr.message,
    });
  }
}


function parseQuery(url = "") {
  const idx = url.indexOf("?");
  if (idx === -1) return {};
  return Object.fromEntries(new URLSearchParams(url.slice(idx + 1)));
}
