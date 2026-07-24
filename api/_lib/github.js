const GH_API = "https://api.github.com";
const DEFAULT_OWNER = "RodrigoMD2025";
const DEFAULT_REPO = "md_recebimentos_extractor";
const DEFAULT_WORKFLOW_ID = "recebimentos.yml";

function getGithubConfig() {
  return {
    owner: process.env.GITHUB_OWNER || DEFAULT_OWNER,
    repo: process.env.GITHUB_REPO || DEFAULT_REPO,
    workflowId: process.env.GITHUB_WORKFLOW_ID || DEFAULT_WORKFLOW_ID,
    hasToken: Boolean(process.env.GITHUB_TOKEN),
  };
}

function githubHeaders(extraHeaders = {}) {
  const headers = {
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "User-Agent": "md-recebimentos-dashboard",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  return {
    ...headers,
    ...extraHeaders,
  };
}

async function githubRequest(path, options = {}) {
  const res = await fetch(`${GH_API}${path}`, {
    ...options,
    headers: githubHeaders(options.headers),
  });

  if (res.status === 204) {
    return null;
  }

  const payload = await res.json().catch(() => null);

  if (!res.ok) {
    const err = new Error(
      payload?.message || `Falha ao consultar GitHub (${res.status}).`
    );
    err.statusCode = res.status;
    throw err;
  }

  return payload;
}

function ensureGithubToken() {
  if (process.env.GITHUB_TOKEN) {
    return;
  }

  const err = new Error(
    "A variavel GITHUB_TOKEN nao esta configurada no servidor."
  );
  err.statusCode = 500;
  throw err;
}

module.exports = {
  ensureGithubToken,
  getGithubConfig,
  githubRequest,
};
