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
  const includeJobs =
    query.include_jobs === "1" ||
    query.include_jobs === "true" ||
    String(query.include_jobs).toLowerCase() === "yes";
  const workflowId = query.workflow_id || config.workflowId;

  try {
    const data = await githubRequest(
      `/repos/${config.owner}/${config.repo}/actions/workflows/${workflowId}/runs?per_page=${perPage}&page=${page}`
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

    // Enriquecer com jobs/steps (usado pelo monitor de Contratos)
    if (includeJobs && workflow_runs.length) {
      // Limita a N runs para não estourar rate limit (monitor pede 1–3)
      const runsToEnrich = workflow_runs.slice(0, Math.min(workflow_runs.length, 5));
      await Promise.all(
        runsToEnrich.map(async (run) => {
          try {
            const jobsData = await githubRequest(
              `/repos/${config.owner}/${config.repo}/actions/runs/${run.id}/jobs?per_page=100`
            );
            const jobs = (jobsData?.jobs || []).map((job) => ({
              id: job.id,
              name: job.name,
              status: job.status,
              conclusion: job.conclusion,
              started_at: job.started_at,
              completed_at: job.completed_at,
              html_url: job.html_url,
              steps: (job.steps || []).map((step) => ({
                name: step.name,
                status: step.status,
                conclusion: step.conclusion,
                number: step.number,
                started_at: step.started_at,
                completed_at: step.completed_at,
              })),
            }));
            run.jobs = jobs;

            // Resumo útil para o monitor: etapa atual e progresso dos steps
            const primaryJob = jobs[0] || null;
            if (primaryJob) {
              const steps = primaryJob.steps || [];
              const done = steps.filter(
                (s) => s.status === "completed" || s.conclusion
              ).length;
              const current =
                steps.find((s) => s.status === "in_progress") ||
                steps.find((s) => s.status === "queued") ||
                null;
              run.job_summary = {
                job_name: primaryJob.name,
                job_status: primaryJob.status,
                job_conclusion: primaryJob.conclusion,
                steps_total: steps.length,
                steps_done: done,
                current_step: current ? current.name : null,
                html_url: primaryJob.html_url || run.html_url || null,
              };
            }
          } catch (jobsErr) {
            run.jobs = [];
            run.job_summary = null;
          }
        })
      );
    }

    res.status(200).json({
      owner: config.owner,
      repo: config.repo,
      workflowId: workflowId,
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
