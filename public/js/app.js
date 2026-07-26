/**
 * MD Recebimentos — Dashboard App
 * GitHub Actions + Neon + Firebase Auth
 */

"use strict";

const WORKFLOW_ID = "recebimentos.yml";
const STORE_KEY = "md_rcb_config";
const STORE_KEY_LAST_EXECUCAO = "md_rcb_last_execucao_anos"; // Guarda anos da última execução

let cfg = {
  owner: "RodrigoMD2025",
  repo: "md_extractor",
  workflowId: WORKFLOW_ID,
  hasGithubToken: false,
  years: ["2024", "2025"],
  theme: "light",
  apiUrl: "",
};

let appUser = null;
let allRuns = [];
let execucaoYearsMap = {};
let donutChart = null;
let barChart = null;
let cardChartAnos = null;
let cardChartPlaylist = null;
let cardChartFinanceiro = null;
let cardChartExecucao = null;
let cachedStatsData = null;
let dadosPagAtual = 1;
let dadosFiltros = {
  ano: "",
  contratante: "",
  status_pagamento: "",
  status_playlist: "",
};
let dadosTotal = 0;
let dadosTotalPags = 1;
let debounceTimer = null;
let dadosInicializado = false;
let progressMonitorInterval = null;

// Mensagens de debug visível na UI (ajuda sem abrir DevTools)
function debugMsg(msg) {
  try {
    const el = document.getElementById('debug-log');
    if (!el) return;
    const time = new Date().toLocaleTimeString();
    const line = document.createElement('div');
    line.textContent = `${time} — ${msg}`;
    el.insertBefore(line, el.firstChild);
    // manter apenas últimas 8 linhas
    while (el.childNodes.length > 8) el.removeChild(el.lastChild);
  } catch (_) {}
}

Auth.init(function (user) {
  appUser = user;
  setUserUI(user);
  init();
});

async function init() {
  loadConfig();
  applyTheme(cfg.theme);
  initNav();
  buildYearTags();
  bindFiltroEvents();
  await loadGithubConfig();
  await loadRuns();
  console.debug('[init] chamando carregarStats()'); debugMsg('init: chamando carregarStats()');
  await carregarStats();
  console.debug('[init] carregarStats() finalizado'); debugMsg('init: carregarStats() finalizado');
}

function apiBase() {
  const base = (cfg.apiUrl || "").trim();
  if (!base) return "";
  return base.endsWith("/") ? base.slice(0, -1) : base;
}

function buildApiUrl(path, params) {
  const base = apiBase();
  const url = new URL(base ? `${base}${path}` : path, window.location.origin);
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== "" && v !== null && v !== undefined) url.searchParams.set(k, v);
  });
  return url.toString().replace(window.location.origin, "");
}

async function loadExecucaoYears(execucaoIds = []) {
  if (!execucaoIds.length) return {};

  // Não aplique os anos salvos no localStorage para todas as execuções.
  // Isso evita que uma nova seleção de 2 anos replique a droplist em execuções antigas.
  return {};
}

function setUserUI(user) {
  const email = user?.email || "";
  const avatar = document.getElementById("user-avatar");
  const emailEl = document.getElementById("user-email");
  const cfgEmail = document.getElementById("cfg-user-email");
  if (avatar) avatar.textContent = email ? email.charAt(0).toUpperCase() : "?";
  if (emailEl) emailEl.textContent = email;
  if (cfgEmail) cfgEmail.textContent = email || "--";
}

function loadConfig() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      cfg = {
        ...cfg,
        years: saved.years || cfg.years,
        theme: saved.theme || cfg.theme,
        apiUrl: saved.apiUrl || "",
      };
    }
  } catch (_) {}

  const savedTheme = localStorage.getItem("theme");
  if (savedTheme === "dark" || savedTheme === "light") {
    cfg.theme = savedTheme;
  }

  syncFormFields();
}

function persistConfig() {
  const payload = {
    years: cfg.years,
    theme: cfg.theme,
    apiUrl: cfg.apiUrl,
  };
  localStorage.setItem(STORE_KEY, JSON.stringify(payload));
  localStorage.setItem("theme", cfg.theme);
}

function syncFormFields() {
  setVal("cfg-years", (cfg.years || []).join(", "));
  setVal("cfg-api-url", cfg.apiUrl || "");
}

function toggleTheme() {
  const next = document.documentElement.classList.contains("dark")
    ? "light"
    : "dark";
  applyTheme(next);
  cfg.theme = next;
  persistConfig();
  if (allRuns.length) renderCharts(allRuns);
}

function applyTheme(t) {
  document.documentElement.classList.toggle("dark", t === "dark");
  const iconSun = document.getElementById("icon-sun");
  const iconMoon = document.getElementById("icon-moon");
  if (iconSun && iconMoon) {
    iconSun.classList.toggle("hidden", t !== "dark");
    iconMoon.classList.toggle("hidden", t === "dark");
  }
}

async function loadGithubConfig() {
  try {
    const data = await githubApiFetch("/api/github-config");
    cfg.owner = data.owner || cfg.owner;
    cfg.repo = data.repo || cfg.repo;
    cfg.workflowId = data.workflowId || cfg.workflowId || WORKFLOW_ID;
    cfg.hasGithubToken = Boolean(data.hasToken);
    setGithubConfigUI();
  } catch (err) {
    setGithubConfigUI(err.message);
    toast(`Erro ao carregar configuracao do GitHub: ${err.message}`, "error");
  }
}

function setGithubConfigUI(errorMessage = "") {
  const repoName = document.getElementById("github-repo-name");
  const repoDetails = document.getElementById("github-repo-details");
  const tokenBadge = document.getElementById("github-token-badge");

  if (repoName) {
    repoName.textContent = `${cfg.owner}/${cfg.repo}`;
  }

  if (repoDetails) {
    repoDetails.textContent = errorMessage
      ? `Falha ao carregar configuracao: ${errorMessage}`
      : `Workflow ${cfg.workflowId || WORKFLOW_ID}`;
  }

  if (tokenBadge) {
    tokenBadge.textContent = cfg.hasGithubToken
      ? "Token configurado"
      : "Somente leitura";
    tokenBadge.className = cfg.hasGithubToken
      ? "text-[11px] px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
      : "text-[11px] px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300";
  }
}

function initNav() {
  document.querySelectorAll(".nav-item").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      navigateTo(el.dataset.section);
    });
  });
}

function navigateTo(section) {
  document
    .querySelectorAll(".nav-item")
    .forEach((el) =>
      el.classList.toggle("active", el.dataset.section === section),
    );
  document
    .querySelectorAll(".section-content")
    .forEach((el) => el.classList.add("hidden"));
  const target = document.getElementById(`section-${section}`);
  if (target) target.classList.remove("hidden");

  const titles = {
    dashboard: "Dashboard",
    run: "Executar Extração",
    history: "Histórico",
    dados: "Dados",
    settings: "Configurações",
  };
  const titleEl = document.getElementById("page-title");
  if (titleEl) titleEl.textContent = titles[section] || section;

  if (section === "history") loadRuns(true);
  if (section === "settings") syncFormFields();
  if (section === "run") {
    checkGithubConnection();
    loadLastContratosRelatorio();
  }
  if (section === "dados") {
    if (!dadosInicializado) {
      carregarStats();
      carregarDados(1);
      dadosInicializado = true;
    }
  }

  if (window.innerWidth < 1024) closeSidebar();
}

function toggleSidebar() {
  const sb = document.getElementById("sidebar");
  const ovl = document.getElementById("sidebar-overlay");
  const open = sb.classList.toggle("-translate-x-full");
  ovl.classList.toggle("hidden", open);
}

function closeSidebar() {
  document.getElementById("sidebar")?.classList.add("-translate-x-full");
  document.getElementById("sidebar-overlay")?.classList.add("hidden");
}

function buildYearTags() {
  const wrap = document.getElementById("year-checkboxes");
  if (!wrap) return;
  wrap.innerHTML = (cfg.years || [])
    .map(
      (y) => `
    <label class="year-tag selected" id="ytag-${y}">
      <input type="checkbox" value="${y}" checked onchange="toggleYearTag(this, '${y}')">
      <span>${y}</span>
    </label>
  `,
    )
    .join("");

}

function toggleYearTag(cb, year) {
  const label = document.getElementById(`ytag-${year}`);
  label?.classList.toggle("selected", cb.checked);
}

// Cliente simplificado para chamadas à API do backend usando headers de Auth
async function githubApiFetch(path, opts = {}) {
  const headers = (opts && opts.headers) || (await Auth.headers());
  const url = buildApiUrl(path, opts.params || {});
  
  // Se houver body e for um objeto, stringify para JSON
  let body = opts.body;
  if (body && typeof body === "object" && !(body instanceof FormData)) {
    body = JSON.stringify(body);
  }

  const response = await fetch(url, { 
    method: opts.method || "GET", 
    headers, 
    body 
  });

  if (response.status === 204) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `HTTP ${response.status}`);
  }
  return payload;
}

async function loadRuns(forHistory = false) {
  spinRefresh(true);
  setStatus("loading", "Conectando…");
  console.debug('[loadRuns] iniciando carga de runs'); debugMsg('loadRuns: iniciando');

  try {
    // Passa with_inputs=true para enriquecer as runs com os anos processados
    const data = await githubApiFetch("/api/github-runs", {
      params: { per_page: 50, page: 1, with_inputs: "true" },
    });
    cfg.owner = data.owner || cfg.owner;
    cfg.repo = data.repo || cfg.repo;
    cfg.workflowId = data.workflowId || cfg.workflowId;
    cfg.hasGithubToken = Boolean(data.hasToken);
    setGithubConfigUI();
    allRuns = data?.workflow_runs ?? [];

    updateStats(allRuns);
    renderCharts(allRuns);
    fillTable(
      allRuns.slice(0, 6),
      "dash-tbody",
      "dash-table",
      "dash-table-placeholder",
      false,
    );

    if (forHistory) {
      execucaoYearsMap = await loadExecucaoYears(
        allRuns.map((run) => String(run.run_number)).filter(Boolean),
      );

      fillTable(
        allRuns,
        "history-tbody",
        "history-table",
        "history-placeholder",
        true,
        execucaoYearsMap,
      );
      document.getElementById("load-more-wrap")?.classList.remove("hidden");
    }

    setStatus("ok", "Conectado");
    console.debug('[loadRuns] runs carregadas:', allRuns.length); debugMsg(`loadRuns: runs carregadas ${allRuns.length}`);
  } catch (err) {
    setStatus("error", "Erro de conexão");
    toast(`Erro ao buscar dados: ${err.message}`, "error");
  } finally {
    spinRefresh(false);
  }
}

function refreshData() {
  loadRuns();
}

function updateStats(runs) {
  const total = runs.length;
  const success = runs.filter((r) => r.conclusion === "success").length;
  const failed = runs.filter((r) => r.conclusion === "failure").length;
  const cancelled = runs.filter((r) => r.conclusion === "cancelled").length;

  setTxt("stat-total", total);
  setTxt("stat-success", success);
  setTxt("stat-failed", failed);
  setTxt("stat-cancelled", cancelled);

  // Update progress bars
  const successPercent = total > 0 ? (success / total) * 100 : 0;
  const failedPercent = total > 0 ? (failed / total) * 100 : 0;
  setVal("status-success-count", success);
  setVal("status-failed-count", failed);
  const successBar = document.getElementById("status-success-bar");
  const failedBar = document.getElementById("status-failed-bar");
  if (successBar) successBar.style.width = successPercent + "%";
  if (failedBar) failedBar.style.width = failedPercent + "%";

  if (runs.length > 0) {
    const last = runs[0];
    const d = new Date(last.created_at);
    setTxt("stat-last-date", d.toLocaleDateString("pt-BR"));
  } else {
    setTxt("stat-last-date", "--");
  }
}

function renderCharts(runs) {
  renderDashboardCards(runs, cachedStatsData);
  renderDonut(runs);
  renderBar(runs);
}

function isDark() {
  return document.documentElement.classList.contains("dark");
}

function labelColor() {
  return isDark() ? "#9ca3af" : "#6b7280";
}

function renderDonut(runs) {
  const canvas = document.getElementById("chart-donut");
  const empty = document.getElementById("chart-donut-empty");
  if (!canvas) return;

  if (donutChart) {
    donutChart.destroy();
    donutChart = null;
  }

  const success = runs.filter((r) => r.conclusion === "success").length;
  const failure = runs.filter((r) => r.conclusion === "failure").length;
  const cancelled = runs.filter((r) => r.conclusion === "cancelled").length;
  const other = runs.length - success - failure - cancelled;

  if (runs.length === 0) {
    canvas.classList.add("hidden");
    empty?.classList.remove("hidden");
    return;
  }
  canvas.classList.remove("hidden");
  empty?.classList.add("hidden");

  donutChart = new Chart(canvas, {
    type: "doughnut",
    data: {
      labels: ["Sucesso", "Falha", "Cancelado", "Outros"],
      datasets: [
        {
          data: [success, failure, cancelled, other],
          backgroundColor: ["#059669", "#dc2626", "#9ca3af", "#d97706"],
          borderWidth: 0,
          hoverOffset: 6,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      cutout: "68%",
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            font: { size: 11 },
            color: labelColor(),
            padding: 14,
            usePointStyle: true,
            pointStyleWidth: 8,
          },
        },
      },
    },
  });
}

function renderBar(runs) {
  const canvas = document.getElementById("chart-bar");
  const empty = document.getElementById("chart-bar-empty");
  if (!canvas) return;

  if (barChart) {
    barChart.destroy();
    barChart = null;
  }

  const recent = [...runs].reverse().slice(-10);
  if (recent.length === 0) {
    canvas.classList.add("hidden");
    empty?.classList.remove("hidden");
    return;
  }
  canvas.classList.remove("hidden");
  empty?.classList.add("hidden");

  const colors = recent.map((r) => {
    if (r.conclusion === "success") return "#059669";
    if (r.conclusion === "failure") return "#dc2626";
    if (r.conclusion === "cancelled") return "#9ca3af";
    if (r.status === "in_progress") return "#3b82f6";
    return "#d97706";
  });

  barChart = new Chart(canvas, {
    type: "bar",
    data: {
      labels: recent.map((r) => `#${r.run_number}`),
      datasets: [
        {
          data: recent.map(() => 1),
          backgroundColor: colors,
          borderRadius: 5,
          borderWidth: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: labelColor(), font: { size: 10 } },
        },
        y: { display: false, max: 1.6 },
      },
    },
  });
}

function renderDashboardCards(runs, statsData) {
  // Palette for year slices
  const yearPalette = [
    "#8b5cf6", "#6366f1", "#a78bfa", "#c084fc",
    "#7c3aed", "#4f46e5", "#818cf8", "#e879f9",
  ];

  // Helper: build custom legend HTML
  function buildLegend(containerId, items) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = items
      .map(
        (it) =>
          `<span class="inline-flex items-center gap-1"><span class="inline-block w-2 h-2 rounded-full" style="background:${it.color}"></span>${it.label} <b>${it.pct}%</b></span>`,
      )
      .join("");
  }

  // ── Card 01: Anos (pie) ──────────────────────────────────────────────────
  {
    const canvas = document.getElementById("card-chart-anos");
    const empty = document.getElementById("card-chart-anos-empty");
    if (canvas) {
      if (cardChartAnos) { cardChartAnos.destroy(); cardChartAnos = null; }

      const stats = statsData?.stats_por_ano || [];
      const totalAll = stats.reduce((a, s) => a + Number(s.total || 0), 0);

      if (totalAll === 0) {
        canvas.classList.add("hidden");
        empty?.classList.remove("hidden");
        buildLegend("card-anos-legend", []);
      } else {
        canvas.classList.remove("hidden");
        empty?.classList.add("hidden");

        const labels = stats.map((s) => String(s.ano));
        const data = stats.map((s) => Number(s.total || 0));
        const colors = labels.map((_, i) => yearPalette[i % yearPalette.length]);

        cardChartAnos = new Chart(canvas, {
          type: "doughnut",
          data: {
            labels,
            datasets: [{ data, backgroundColor: colors, borderWidth: 0, hoverOffset: 6 }],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: "65%",
            plugins: {
              legend: { display: false },
              tooltip: {
                callbacks: {
                  label: (ctx) => {
                    const pct = totalAll ? ((ctx.parsed / totalAll) * 100).toFixed(1) : "0";
                    return `${ctx.label}: ${ctx.parsed} (${pct}%)`;
                  },
                },
              },
            },
          },
        });

        buildLegend(
          "card-anos-legend",
          labels.map((l, i) => ({
            label: l,
            color: colors[i],
            pct: ((data[i] / totalAll) * 100).toFixed(1),
          })),
        );
      }
    }
  }

  // ── Card 02: Playlist (pie) ──────────────────────────────────────────────
  {
    const canvas = document.getElementById("card-chart-playlist");
    const empty = document.getElementById("card-chart-playlist-empty");
    if (canvas) {
      if (cardChartPlaylist) { cardChartPlaylist.destroy(); cardChartPlaylist = null; }

      const stats = statsData?.stats_por_ano || [];
      const comPl = stats.reduce((a, s) => a + Number(s.com_playlist || 0), 0);
      const semPl = stats.reduce((a, s) => a + Number(s.sem_playlist || 0), 0);
      const totalPl = comPl + semPl;

      if (totalPl === 0) {
        canvas.classList.add("hidden");
        empty?.classList.remove("hidden");
        buildLegend("card-playlist-legend", []);
      } else {
        canvas.classList.remove("hidden");
        empty?.classList.add("hidden");

        cardChartPlaylist = new Chart(canvas, {
          type: "doughnut",
          data: {
            labels: ["Com Playlist", "Sem Playlist"],
            datasets: [{
              data: [comPl, semPl],
              backgroundColor: ["#3b82f6", "#94a3b8"],
              borderWidth: 0,
              hoverOffset: 6,
            }],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: "65%",
            plugins: {
              legend: { display: false },
              tooltip: {
                callbacks: {
                  label: (ctx) => {
                    const pct = totalPl ? ((ctx.parsed / totalPl) * 100).toFixed(1) : "0";
                    return `${ctx.label}: ${ctx.parsed} (${pct}%)`;
                  },
                },
              },
            },
          },
        });

        buildLegend("card-playlist-legend", [
          { label: "Com Playlist", color: "#3b82f6", pct: ((comPl / totalPl) * 100).toFixed(1) },
          { label: "Sem Playlist", color: "#94a3b8", pct: ((semPl / totalPl) * 100).toFixed(1) },
        ]);
      }
    }
  }

  // ── Card 03: Financeiro (pie) ────────────────────────────────────────────
  {
    const canvas = document.getElementById("card-chart-financeiro");
    const empty = document.getElementById("card-chart-financeiro-empty");
    if (canvas) {
      if (cardChartFinanceiro) { cardChartFinanceiro.destroy(); cardChartFinanceiro = null; }

      const stats = statsData?.stats_por_ano || [];
      const pagos = stats.reduce((a, s) => a + Number(s.pagos || 0), 0);
      const pendentes = stats.reduce((a, s) => a + Number(s.pendentes || 0), 0);
      const totalFin = pagos + pendentes;

      if (totalFin === 0) {
        canvas.classList.add("hidden");
        empty?.classList.remove("hidden");
        buildLegend("card-financeiro-legend", []);
      } else {
        canvas.classList.remove("hidden");
        empty?.classList.add("hidden");

        cardChartFinanceiro = new Chart(canvas, {
          type: "doughnut",
          data: {
            labels: ["Pagos", "Não Pagos"],
            datasets: [{
              data: [pagos, pendentes],
              backgroundColor: ["#059669", "#f59e0b"],
              borderWidth: 0,
              hoverOffset: 6,
            }],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: "65%",
            plugins: {
              legend: { display: false },
              tooltip: {
                callbacks: {
                  label: (ctx) => {
                    const pct = totalFin ? ((ctx.parsed / totalFin) * 100).toFixed(1) : "0";
                    return `${ctx.label}: ${ctx.parsed} (${pct}%)`;
                  },
                },
              },
            },
          },
        });

        buildLegend("card-financeiro-legend", [
          { label: "Pagos", color: "#059669", pct: ((pagos / totalFin) * 100).toFixed(1) },
          { label: "Não Pagos", color: "#f59e0b", pct: ((pendentes / totalFin) * 100).toFixed(1) },
        ]);
      }
    }
  }

  // ── Card 04: Execução (bar chart) ────────────────────────────────────────
  {
    const canvas = document.getElementById("card-chart-execucao");
    const empty = document.getElementById("card-chart-execucao-empty");
    if (canvas) {
      if (cardChartExecucao) { cardChartExecucao.destroy(); cardChartExecucao = null; }

      const total = runs.length;
      const success = runs.filter((r) => r.conclusion === "success").length;
      const failure = runs.filter((r) => r.conclusion === "failure").length;
      const cancelled = runs.filter((r) => r.conclusion === "cancelled").length;

      if (total === 0) {
        canvas.classList.add("hidden");
        empty?.classList.remove("hidden");
        buildLegend("card-execucao-legend", []);
      } else {
        canvas.classList.remove("hidden");
        empty?.classList.add("hidden");

        const labels = ["Execuções", "Sucesso", "Erros", "Cancelados"];
        const data = [total, success, failure, cancelled];
        const colors = ["#6366f1", "#059669", "#dc2626", "#9ca3af"];

        cardChartExecucao = new Chart(canvas, {
          type: "bar",
          data: {
            labels,
            datasets: [{
              data,
              backgroundColor: colors,
              borderRadius: 6,
              borderWidth: 0,
              barPercentage: 0.6,
              categoryPercentage: 0.7,
            }],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
              tooltip: {
                callbacks: {
                  label: (ctx) => {
                    const pct = total ? ((ctx.parsed.y / total) * 100).toFixed(1) : "0";
                    return `${ctx.label}: ${ctx.parsed.y} (${pct}%)`;
                  },
                },
              },
            },
            scales: {
              x: {
                grid: { display: false },
                ticks: { color: labelColor(), font: { size: 10 } },
              },
              y: {
                beginAtZero: true,
                grid: { color: isDark() ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)" },
                ticks: { color: labelColor(), font: { size: 10 }, stepSize: 1 },
              },
            },
          },
        });

        buildLegend("card-execucao-legend", [
          { label: "Total", color: "#6366f1", pct: "100" },
          { label: "Sucesso", color: "#059669", pct: ((success / total) * 100).toFixed(1) },
          { label: "Erros", color: "#dc2626", pct: ((failure / total) * 100).toFixed(1) },
          { label: "Cancelados", color: "#9ca3af", pct: ((cancelled / total) * 100).toFixed(1) },
        ]);
      }
    }
  }
}

function fillTable(runs, tbodyId, tableId, placeholderId, withTrigger, execucaoYearsMap = {}) {
  const tbody = document.getElementById(tbodyId);
  const table = document.getElementById(tableId);
  const holder = document.getElementById(placeholderId);
  if (!tbody) return;

  if (runs.length === 0) {
    if (holder) {
      holder.textContent = "Nenhuma execução encontrada";
      holder.classList.remove("hidden");
    }
    table?.classList.add("hidden");
    return;
  }

  holder?.classList.add("hidden");
  table?.classList.remove("hidden");

  tbody.innerHTML = runs
    .map((run) => {
      const start = new Date(run.created_at);
      const end = run.updated_at ? new Date(run.updated_at) : null;
      const dur = end ? fmtDuration(end - start) : "…";
      const state = run.conclusion || run.status;
      const badge = `<span class="badge badge-${state}">${statusEmoji(state)} ${statusLabel(state)}</span>`;
      
      let displayTitle = run.display_title || run.name || run.head_commit?.message?.split("\n")[0] || "—";
      const yearsFromTitleMatch = displayTitle.match(/Ano\(s\):\s*([\d,\s]+)/i);
      displayTitle = displayTitle.split(/ - Ano\(s\):/i)[0].trim();
      
      const title = esc(displayTitle);
      const dateStr = start.toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
      const triggerCell = withTrigger
        ? `<td class="px-5 py-3.5 text-gray-500">${triggerLabel(run.event)}</td>`
        : "";

      // Extrair anos dos inputs da execução ou do título, priorizando dados do banco
      const execucaoId = String(run.run_number || "");
      const dbYears = execucaoYearsMap[execucaoId] || [];
      let yearsArr = [];
      const runInputs = run.inputs || {};
      const anosInput = runInputs.anos || runInputs.ano || (yearsFromTitleMatch ? yearsFromTitleMatch[1] : null);

      if (dbYears.length > 0) {
        yearsArr = dbYears;
      } else if (anosInput) {
        yearsArr = String(anosInput).split(",").map((y) => y.trim()).filter(Boolean);
      }

      let yearsContent = "";
      if (yearsArr.length > 1) {
        // Mais de um ano: cria um select (droplist) conforme sugerido
        yearsContent = `
          <select class="text-[11px] font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 border-none rounded-full px-2 py-0.5 focus:ring-0 cursor-pointer outline-none">
            <option selected disabled>${yearsArr.length} Anos...</option>
            ${yearsArr.map(y => `<option style="color:#000 !important; background:#fff !important;">${y}</option>`).join("")}
          </select>
        `;
      } else if (yearsArr.length === 1) {
        // Apenas um ano: badge simples
        yearsContent = `<span class="text-[11px] font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">${esc(yearsArr[0])}</span>`;
      } else {
        // Fallback para Agendado/Auto/Vazio
        let fallback = "—";
        if (run.event === "schedule") fallback = "Agendado";
        else if (run.event === "push") fallback = "Auto";
        
        yearsContent = `<span class="text-xs text-gray-400">${esc(fallback)}</span>`;
      }

      const yearsCell = `<td class="px-5 py-3.5" data-run="${run.run_number}">
        <div class="flex items-center">
          ${yearsContent}
        </div>
      </td>`;

      // Debug visível no console
      console.log(`[Table Render] Run #${run.run_number} | anosInput: ${anosInput} | Count: ${yearsArr.length}`);


      const deleteBtn = `<button onclick="deleteRun('${run.id}', '${run.run_number}')" class="text-red-500 hover:text-red-700 ml-2" title="Excluir execução e dados">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      </button>`;

      return `
        <tr>
          <td class="px-5 py-3.5">#${run.run_number}</td>
          <td class="px-5 py-3.5">${title}</td>
          ${yearsCell}
          ${triggerCell}
          <td class="px-5 py-3.5">${badge}</td>
          <td class="px-5 py-3.5 text-gray-500 text-xs">${dateStr}</td>
          <td class="px-5 py-3.5 text-gray-500 text-xs">${dur}</td>
          <td class="px-5 py-3.5">
            <div class="flex items-center">
              <a class="text-xs text-blue-600" href="${run.html_url}" target="_blank" rel="noopener">Abrir</a>
              ${deleteBtn}
            </div>
          </td>
        </tr>
      `;
    })
    .join("");
}

async function deleteRun(runId, runNumber) {
  if (!confirm(`Tem certeza que deseja excluir a execução #${runNumber} e TODOS os dados associados a ela no banco de dados?`)) {
    return;
  }

  try {
    toast(`Excluindo execução #${runNumber}...`, "info");
    
    // 1. Excluir dados no banco (usando runId e runNumber para garantir limpeza)
    await githubApiFetch(`/api/recebimentos?execucao_id=${runId}&run_number=${runNumber}`, {
      method: "DELETE"
    });

    // 2. Excluir run no GitHub
    await githubApiFetch(`/api/github-runs?id=${runId}`, {
      method: "DELETE"
    });

    toast(`Execução #${runNumber} excluída com sucesso`, "success");
    await loadRuns(true); // Recarregar histórico
    try { await carregarStats(); } catch (_) {}
  } catch (err) {
    console.error("Erro ao excluir execução:", err);
    toast(`Erro ao excluir: ${err.message}`, "error");
  }
}

function loadMoreRuns() {
  fillTable(
    allRuns,
    "history-tbody",
    "history-table",
    "history-placeholder",
    true,
    execucaoYearsMap,
  );
  document.getElementById("load-more-wrap")?.classList.add("hidden");
}

function applyFilter() {
  const status = document.getElementById("filter-status")?.value || "all";
  const filtered =
    status === "all"
      ? allRuns
      : allRuns.filter((r) => (r.conclusion || r.status) === status);
  fillTable(
    filtered,
    "history-tbody",
    "history-table",
    "history-placeholder",
    true,
    execucaoYearsMap,
  );
}

// Vincula eventos dos filtros (não aplica automaticamente ano/status)
function bindFiltroEvents() {
  const contratante = document.getElementById("filtro-contratante");
  if (contratante) {
    contratante.addEventListener("input", () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {}, 400);
    });
  }
}

async function triggerWorkflow() {
  const branch = "main";

  const selectedYears = [];
  document.querySelectorAll("#year-checkboxes input:checked").forEach((cb) => {
    selectedYears.push(cb.value);
  });

  if (selectedYears.length === 0) {
    toast("Selecione pelo menos um ano para processar", "error");
    return;
  }

  const btn = document.getElementById("run-btn");
  if (btn) btn.disabled = true;

  try {
    const body = { ref: branch, inputs: {} };
    body.inputs.anos = selectedYears.join(",");

    await githubApiFetch("/api/github-dispatch", {
      method: "POST",
      body,
    });

    toast("Workflow iniciado com sucesso! 🚀", "success");

    localStorage.setItem(STORE_KEY_LAST_EXECUCAO, JSON.stringify({
      anos: selectedYears,
      timestamp: new Date().toISOString(),
    }));

    document.getElementById("active-monitor")?.classList.remove("hidden");
    startProgressMonitor(selectedYears.length);
    setTimeout(() => loadRuns(true), 4000);
  } catch (err) {
    toast(`Erro ao iniciar workflow: ${err.message}`, "error");
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function triggerWorkflowContratos() {
  const btn = document.getElementById("run-contratos-btn");
  const errorEl = document.getElementById("error-monitor-contratos");
  const lastReportEl = document.getElementById("last-contratos-report");
  if (btn) btn.disabled = true;
  if (errorEl) { errorEl.classList.add("hidden"); errorEl.innerHTML = ""; }

  try {
    await githubApiFetch("/api/github-dispatch-contratos", {
      method: "POST",
      body: { ref: "main", inputs: {} },
    });

    toast("Extração de contratos iniciada! 🚀", "success");

    // Esconde relatório anterior e mostra monitor ao vivo
    if (lastReportEl) { lastReportEl.classList.add("hidden"); lastReportEl.innerHTML = ""; }
    const monitor = document.getElementById("active-monitor-contratos");
    if (monitor) {
      monitor.classList.remove("hidden");
    }
    startProgressMonitorContratos();
  } catch (err) {
    const msg = err.message || "Erro desconhecido";
    toast(`Erro: ${msg}`, "error");
    if (errorEl) {
      errorEl.classList.remove("hidden");
      errorEl.innerHTML = `
        <div class="flex items-start gap-3">
          <span class="text-red-500 text-lg">⚠️</span>
          <div class="text-sm">
            <p class="font-semibold text-red-600 mb-1">Falha ao disparar extração</p>
            <p class="text-red-500">${msg}</p>
            <p class="text-gray-500 mt-2 text-xs">Verifique se o GITHUB_TOKEN está configurado nas variáveis de ambiente da Vercel.</p>
          </div>
        </div>
      `;
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

function saveSettings() {
  cfg.apiUrl = getVal("cfg-api-url").trim();

  const raw = getVal("cfg-years");
  cfg.years = raw
    .split(",")
    .map((y) => y.trim())
    .filter(Boolean);
  if (!cfg.years.length) cfg.years = ["2024", "2025"];

  persistConfig();
  buildYearTags();
  toast("Configurações salvas!", "success");
  loadRuns();
}

async function testConnection() {
  try {
    const data = await githubApiFetch("/api/github-runs", {
      params: { per_page: 1, page: 1 },
    });
    cfg.owner = data.owner || cfg.owner;
    cfg.repo = data.repo || cfg.repo;
    cfg.hasGithubToken = Boolean(data.hasToken);
    setGithubConfigUI();
    toast(`GitHub conectado: ${cfg.owner}/${cfg.repo}`, "success");
  } catch (err) {
    toast(`Erro ao verificar GitHub: ${err.message}`, "error");
  }
}

async function checkGithubConnection() {
  const statusEl = document.getElementById("github-status");
  const iconEl = document.getElementById("gh-status-icon");
  const textEl = document.getElementById("gh-status-text");
  if (!statusEl || !iconEl || !textEl) return;

  statusEl.classList.remove("hidden");
  iconEl.className = "w-3 h-3 rounded-full bg-gray-400";
  textEl.textContent = "Verificando conexão GitHub...";

  try {
    const data = await githubApiFetch("/api/github-config");
    if (data.hasToken) {
      iconEl.className = "w-3 h-3 rounded-full bg-green-500";
      textEl.textContent = `GitHub conectado: ${data.owner}/${data.repo}`;
    } else {
      iconEl.className = "w-3 h-3 rounded-full bg-red-500";
      textEl.innerHTML = `<strong>Token GitHub não configurado!</strong> Adicione GITHUB_TOKEN nas variáveis de ambiente da Vercel.`;
    }
  } catch (err) {
    iconEl.className = "w-3 h-3 rounded-full bg-red-500";
    textEl.textContent = `Erro ao verificar GitHub: ${err.message}`;
  }
}

function clearSettings() {
  if (!confirm("Limpar preferencias salvas da interface?")) return;
  localStorage.removeItem(STORE_KEY);
  localStorage.removeItem("theme");
  cfg = {
    owner: "RodrigoMD2025",
    repo: "md_extractor",
    workflowId: WORKFLOW_ID,
    hasGithubToken: false,
    years: ["2024", "2025"],
    theme: "light",
    apiUrl: "",
  };
  applyTheme(cfg.theme);
  syncFormFields();
  buildYearTags();
  setGithubConfigUI();
  toast("Preferencias da interface limpas", "info");
}

function startProgressMonitor(totalJobs) {
  if (progressMonitorInterval) {
    clearInterval(progressMonitorInterval);
  }

  const monitorEl = document.getElementById("active-monitor");
  if (!monitorEl) return;

  let completedJobs = 0;
  let startTime = Date.now();

  monitorEl.innerHTML = `
    <div class="space-y-3">
      <div class="flex items-center justify-between text-sm">
        <span>Execução em andamento...</span>
        <span id="progress-text">0/${totalJobs} anos concluídos</span>
      </div>
      <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5">
        <div id="progress-bar" class="bg-lime-500 h-2.5 rounded-full transition-all duration-500" style="width: 0%"></div>
      </div>
      <div id="progress-eta" class="text-xs text-gray-500">Estimando tempo...</div>
    </div>
  `;

  progressMonitorInterval = setInterval(async () => {
    try {
      const data = await githubApiFetch("/api/github-runs", {
        params: { per_page: 1, page: 1 },
      });
      const latestRun = data?.workflow_runs?.[0];

      if (latestRun) {
        const status = latestRun.conclusion || latestRun.status;
        if (status === "success" || status === "failure" || status === "cancelled") {
          completedJobs = totalJobs;
          updateProgress(completedJobs, totalJobs, startTime);
          clearInterval(progressMonitorInterval);
          setTimeout(() => {
            monitorEl.classList.add("hidden");
            loadRuns();
          }, 2000);
          return;
        }

        const elapsed = (Date.now() - startTime) / 1000;
        const estimatedTotal = totalJobs * 180;
        const estimatedProgress = Math.min(100, (elapsed / estimatedTotal) * 100);
        updateProgress(estimatedProgress, totalJobs, startTime, elapsed);
      }
    } catch (err) {
      console.error("Erro ao monitorar progresso:", err);
    }
  }, 3000);
}

let progressMonitorContratosInterval = null;
let progressMonitorContratosTimer = null;

function formatDurationHMS(totalSeconds) {
  const sec = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) {
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function setContratosMonitorProgress(percent, barClass) {
  const barEl = document.getElementById("ct-progress-bar");
  if (!barEl) return;
  const pct = Math.max(0, Math.min(100, Number(percent) || 0));
  barEl.style.width = `${pct}%`;
  if (barClass) {
    barEl.className = `${barClass} h-2.5 rounded-full transition-all duration-500`;
  }
}

function stopContratosMonitors() {
  if (progressMonitorContratosInterval) {
    clearInterval(progressMonitorContratosInterval);
    progressMonitorContratosInterval = null;
  }
  if (progressMonitorContratosTimer) {
    clearInterval(progressMonitorContratosTimer);
    progressMonitorContratosTimer = null;
  }
}

async function fetchContratosRelatorio({ runNumber, sinceIso, attempts = 8, delayMs = 2500 }) {
  for (let i = 0; i < attempts; i++) {
    try {
      const params = { relatorio: "1" };
      if (runNumber) params.run_number = String(runNumber);
      if (sinceIso) params.since = sinceIso;
      const res = await githubApiFetch("/api/contratos", { params });
      if (res?.data) return res.data;
    } catch (err) {
      console.warn("Relatório de contratos ainda indisponível:", err.message);
    }
    if (i < attempts - 1) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return null;
}

function buildContratosRelatorioHtml(relatorio, opts = {}) {
  const inserts = Number(relatorio?.inserts) || 0;
  const updates = Number(relatorio?.updates) || 0;
  const total = Number(relatorio?.total_extraidos) || inserts + updates;
  const wallMs = opts.wallElapsedSec != null ? Math.round(opts.wallElapsedSec) : null;
  const scriptMs = relatorio?.duracao_segundos != null ? Math.round(relatorio.duracao_segundos) : null;
  const duracao =
    wallMs != null
      ? formatDurationHMS(wallMs)
      : scriptMs != null
        ? formatDurationHMS(scriptMs)
        : "--:--";
  const duracaoExtra =
    wallMs != null && scriptMs != null && wallMs !== scriptMs
      ? `execução: ${formatDurationHMS(scriptMs)}`
      : "";
  const mensagem = relatorio?.mensagem || "";
  const hasNew = inserts > 0;
  const title = opts.title || "Relatório da extração";
  const run = opts.run || null;
  const criadoEm = relatorio?.criado_em
    ? new Date(relatorio.criado_em).toLocaleString("pt-BR")
    : null;
  const runNumber = relatorio?.github_run_number || run?.run_number || "";

  return `
    <div class="ct-report-box">
      <div class="flex items-center justify-between gap-2 mb-3">
        <div class="min-w-0">
          <p class="text-sm font-semibold text-gray-800 dark:text-gray-100">${title}</p>
          ${criadoEm ? `<p class="text-[11px] text-gray-400 mt-0.5">${criadoEm}${runNumber ? ` · run #${runNumber}` : ""}</p>` : ""}
        </div>
        <span class="text-[11px] text-gray-400 flex-shrink-0">duração ${duracao}${duracaoExtra ? `<br><span class="text-[10px]">${duracaoExtra}</span>` : ""}</span>
      </div>
      <div class="grid grid-cols-3 gap-2 mb-3">
        <div class="ct-stat-pill ${hasNew ? "ct-stat-new" : ""}">
          <p class="ct-stat-label">Novos</p>
          <p class="ct-stat-value">${inserts}</p>
        </div>
        <div class="ct-stat-pill">
          <p class="ct-stat-label">Atualizados</p>
          <p class="ct-stat-value">${updates}</p>
        </div>
        <div class="ct-stat-pill">
          <p class="ct-stat-label">Extraídos</p>
          <p class="ct-stat-value">${total}</p>
        </div>
      </div>
      <p class="text-xs ${hasNew ? "text-emerald-600 dark:text-emerald-400" : "text-gray-500 dark:text-gray-400"}">
        ${
          hasNew
            ? `✅ ${inserts} contrato(s) novo(s) incluído(s) na base.`
            : "ℹ️ Nenhum contrato novo — registros existentes foram revalidados/atualizados."
        }
      </p>
      ${mensagem ? `<p class="text-[11px] text-gray-400 mt-1">${mensagem}</p>` : ""}
      ${
        run?.html_url
          ? `<a href="${run.html_url}" target="_blank" rel="noopener" class="inline-flex items-center gap-1 mt-3 text-xs text-indigo-600 dark:text-indigo-400 hover:underline">
              Ver run #${run.run_number || runNumber || ""} no GitHub ↗
            </a>`
          : ""
      }
    </div>
  `;
}

function renderContratosRelatorioFinal(relatorio, run, wallElapsedSec) {
  const lastEl = document.getElementById("last-contratos-report");
  if (!lastEl) return;
  lastEl.classList.remove("hidden");
  lastEl.innerHTML = buildContratosRelatorioHtml(relatorio, {
    title: "Relatório da extração",
    run,
    wallElapsedSec,
  });
}

async function loadLastContratosRelatorio() {
  const lastEl = document.getElementById("last-contratos-report");
  if (!lastEl) return;
  // Não sobrescreve se o monitor ao vivo estiver aberto
  const live = document.getElementById("active-monitor-contratos");
  if (live && !live.classList.contains("hidden") && live.querySelector("#ct-elapsed")) {
    return;
  }
  try {
    const res = await githubApiFetch("/api/contratos", { params: { relatorio: "1" } });
    if (!res?.data) {
      lastEl.classList.add("hidden");
      lastEl.innerHTML = "";
      return;
    }
    lastEl.classList.remove("hidden");
    lastEl.innerHTML = buildContratosRelatorioHtml(res.data, {
      title: "Última extração de contratos",
    });
  } catch (err) {
    console.warn("Não foi possível carregar o último relatório de contratos:", err.message);
  }
}

function startProgressMonitorContratos() {
  stopContratosMonitors();

  const monitorEl = document.getElementById("active-monitor-contratos");
  if (!monitorEl) return;

  const startTime = Date.now();
  let runStartTime = null;
  const sinceIso = new Date(startTime - 15000).toISOString();
  let trackedRunId = null;
  let trackedRunNumber = null;
  let finished = false;
  let baselineTotal = null;

  // Snapshot do total atual (para reforçar se houve inclusão)
  githubApiFetch("/api/contratos", { params: { stats: "1" } })
    .then((s) => {
      baselineTotal = Number(s?.total) || 0;
    })
    .catch(() => {});

  monitorEl.classList.remove("hidden");
  monitorEl.innerHTML = `
    <div class="space-y-4">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <p class="text-sm font-semibold text-gray-800 dark:text-gray-100">Extração de contratos</p>
          <p id="ct-run-meta" class="text-[11px] text-gray-400 mt-0.5">Aguardando run no GitHub Actions...</p>
        </div>
        <div class="text-right flex-shrink-0">
          <span id="ct-progress-status" class="ct-status-badge ct-status-wait">aguardando</span>
          <p id="ct-elapsed" class="text-xs font-mono text-gray-500 dark:text-gray-400 mt-1">00:00</p>
        </div>
      </div>

      <div>
        <div class="flex items-center justify-between text-[11px] text-gray-500 mb-1.5">
          <span id="ct-current-step">Preparando...</span>
          <span id="ct-progress-pct">0%</span>
        </div>
        <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5 overflow-hidden">
          <div id="ct-progress-bar" class="bg-indigo-500 h-2.5 rounded-full transition-all duration-500" style="width: 4%"></div>
        </div>
      </div>

      <div id="ct-live-info" class="text-xs text-gray-500 dark:text-gray-400">
        Disparo enviado. Buscando a execução no repositório...
      </div>
    </div>
  `;

  // Timer contínuo desde o clique no botão (startTime)
  progressMonitorContratosTimer = setInterval(() => {
    const elapsedEl = document.getElementById("ct-elapsed");
    if (elapsedEl) {
      elapsedEl.textContent = formatDurationHMS((Date.now() - startTime) / 1000);
    }
  }, 200);

  const setStatusBadge = (label, kind) => {
    const el = document.getElementById("ct-progress-status");
    if (!el) return;
    el.textContent = label;
    el.className = `ct-status-badge ct-status-${kind || "wait"}`;
  };

  const finalize = async (run, kind) => {
    if (finished) return;
    finished = true;
    stopContratosMonitors();

    const wallElapsed = (Date.now() - startTime) / 1000;
    const elapsedEl = document.getElementById("ct-elapsed");
    if (elapsedEl) elapsedEl.textContent = formatDurationHMS(wallElapsed);

    if (kind === "success") {
      setStatusBadge("concluído", "ok");
      setContratosMonitorProgress(100, "bg-emerald-500");
      const pctEl = document.getElementById("ct-progress-pct");
      if (pctEl) pctEl.textContent = "100%";
      const stepEl = document.getElementById("ct-current-step");
      if (stepEl) stepEl.textContent = "Finalizado";
      const liveEl = document.getElementById("ct-live-info");
      if (liveEl) {
        liveEl.textContent = "Workflow concluído. Carregando relatório de inserts/updates...";
      }

      const relatorio = await fetchContratosRelatorio({
        runNumber: run?.run_number || trackedRunNumber,
        sinceIso,
        attempts: 10,
        delayMs: 2000,
      });

      let reportData = relatorio;
      if (!reportData && baselineTotal != null) {
        try {
          const stats = await githubApiFetch("/api/contratos", { params: { stats: "1" } });
          const newTotal = Number(stats?.total) || 0;
          const delta = Math.max(0, newTotal - baselineTotal);
          reportData = {
            inserts: delta,
            updates: 0,
            total_extraidos: delta,
            mensagem:
              delta > 0
                ? `Detectados ~${delta} registro(s) a mais na base (relatório detalhado ainda indisponível).`
                : "Sem variação no total da base (relatório detalhado ainda indisponível).",
            duracao_segundos: Math.round(wallElapsed),
          };
        } catch (_) {
          reportData = {
            inserts: 0,
            updates: 0,
            total_extraidos: 0,
            mensagem: "Relatório detalhado ainda não disponível. Tente atualizar em instantes.",
            duracao_segundos: Math.round(wallElapsed),
          };
        }
      }

      // Esconde monitor e mostra relatório no card persistente
      monitorEl.classList.add("hidden");
      renderContratosRelatorioFinal(reportData, run, wallElapsed);
      return;
    }

    // failure / cancelled
    monitorEl.classList.add("hidden");
    setStatusBadge(kind === "failure" ? "falhou" : "cancelado", "fail");
    const liveEl = document.getElementById("ct-live-info");
    if (liveEl) {
      liveEl.innerHTML = kind === "failure"
        ? `A execução falhou. ${run?.html_url ? `<a class="text-indigo-600 underline" href="${run.html_url}" target="_blank" rel="noopener">Abrir no GitHub</a>` : "Verifique o GitHub Actions."}`
        : "A execução foi cancelada.";
    }
    fetchContratosRelatorio({
      runNumber: run?.run_number || trackedRunNumber,
      sinceIso,
      attempts: 3,
      delayMs: 1500,
    }).then((rel) => {
      if (rel) renderContratosRelatorioFinal(rel, run, wallElapsed);
    });
  };

  const tick = async () => {
    if (finished) return;
    try {
      const data = await githubApiFetch("/api/github-runs", {
        params: {
          per_page: 3,
          page: 1,
          workflow_id: "contratos.yml",
          include_jobs: "1",
        },
      });

      const runs = data?.workflow_runs || [];
      // Preferir a run que iniciou após o disparo (ou a mais recente)
      let run =
        runs.find((r) => trackedRunId && String(r.id) === String(trackedRunId)) ||
        runs.find((r) => {
          const created = new Date(r.created_at || r.run_started_at || 0).getTime();
          return created >= startTime - 60000;
        }) ||
        runs[0] ||
        null;

      if (!run) {
        setStatusBadge("na fila", "wait");
        const liveEl = document.getElementById("ct-live-info");
        if (liveEl) {
          liveEl.textContent = "Aguardando a execução aparecer no GitHub Actions...";
        }
        setContratosMonitorProgress(6, "bg-indigo-500");
        return;
      }

      trackedRunId = run.id;
      trackedRunNumber = run.run_number;

      // Registra o momento em que a run apareceu no GitHub (informativo)
      const runStarted = new Date(run.started_at || run.created_at || run.run_started_at).getTime();
      if (!isNaN(runStarted) && runStarted > 0) {
        runStartTime = runStarted;
      }

      const metaEl = document.getElementById("ct-run-meta");
      if (metaEl) {
        const eventLabel = run.event || "dispatch";
        metaEl.innerHTML = `Run <strong>#${run.run_number}</strong> · ${eventLabel}${
          run.html_url
            ? ` · <a href="${run.html_url}" target="_blank" rel="noopener" class="text-indigo-600 dark:text-indigo-400 hover:underline">abrir ↗</a>`
            : ""
        }`;
      }

      const summary = run.job_summary || null;
      const conclusion = run.conclusion;
      const status = conclusion || run.status;

      if (conclusion === "success") {
        await finalize(run, "success");
        return;
      }
      if (conclusion === "failure" || conclusion === "cancelled" || conclusion === "timed_out") {
        await finalize(run, conclusion === "cancelled" ? "cancelled" : "failure");
        return;
      }

      // Em andamento
      const isQueued = status === "queued" || status === "waiting" || status === "requested";
      setStatusBadge(isQueued ? "na fila" : "executando", isQueued ? "wait" : "run");

      let percent = 8;
      if (summary && summary.steps_total > 0) {
        percent = Math.min(
          92,
          Math.round((summary.steps_done / summary.steps_total) * 100)
        );
        // Se há step em andamento, mostra progresso parcial do step atual
        if (summary.current_step && summary.steps_done < summary.steps_total) {
          percent = Math.min(92, percent + Math.round(100 / summary.steps_total / 2));
        }
      } else {
        // fallback por tempo (estimativa ~15 min)
        const elapsed = (Date.now() - startTime) / 1000;
        percent = Math.min(85, 8 + (elapsed / 900) * 77);
      }

      setContratosMonitorProgress(percent, "bg-indigo-500");
      const pctEl = document.getElementById("ct-progress-pct");
      if (pctEl) pctEl.textContent = `${Math.round(percent)}%`;

      const stepEl = document.getElementById("ct-current-step");
      if (stepEl) {
        stepEl.textContent = summary?.current_step
          ? `Etapa: ${summary.current_step}`
          : isQueued
            ? "Na fila do GitHub Actions..."
            : "Workflow em execução...";
      }

      const liveEl = document.getElementById("ct-live-info");
      if (liveEl) {
        const parts = [];
        if (summary?.job_name) parts.push(`Job: ${summary.job_name}`);
        if (summary?.steps_total) {
          parts.push(`Passos: ${summary.steps_done}/${summary.steps_total}`);
        }
        if (summary?.current_step) parts.push(summary.current_step);
        liveEl.textContent = parts.length
          ? parts.join(" · ")
          : "Executando no GitHub Actions...";
      }
    } catch (err) {
      console.error("Erro ao monitorar contratos:", err);
      const liveEl = document.getElementById("ct-live-info");
      if (liveEl) {
        liveEl.textContent = `Erro ao consultar GitHub: ${err.message}`;
      }
    }
  };

  // Primeiro tick imediato + poll a cada 4s
  tick();
  progressMonitorContratosInterval = setInterval(tick, 4000);
}

function updateProgress(progress, total, startTime, elapsed) {
  const progressBar = document.getElementById("progress-bar");
  const progressText = document.getElementById("progress-text");
  const progressEta = document.getElementById("progress-eta");

  if (progressBar) {
    const percentage = typeof progress === "number" ? progress : (progress / total) * 100;
    progressBar.style.width = `${percentage}%`;
  }

  if (progressText) {
    if (typeof progress === "number") {
      progressText.textContent = `${Math.round(progress)}% concluído`;
    } else {
      progressText.textContent = `${progress}/${total} anos concluídos`;
    }
  }

  if (progressEta && elapsed) {
    const estimatedTotal = total * 180;
    const remaining = Math.max(0, estimatedTotal - elapsed);
    const minutes = Math.floor(remaining / 60);
    const seconds = Math.floor(remaining % 60);
    progressEta.textContent = `Tempo estimado restante: ${minutes}m ${seconds}s`;
  }
}

function setStatus(type, text = "") {
  const dot = document.getElementById("status-dot");
  const txt = document.getElementById("status-text");
  const sdot = document.getElementById("sidebar-status-dot");
  const stxt = document.getElementById("sidebar-status-text");

  const map = {
    ok: "bg-emerald-500",
    error: "bg-red-500",
    loading: "bg-blue-500 animate-pulse",
    none: "bg-gray-300",
  };
  const cls = map[type] || "bg-gray-300";

  [dot, sdot].forEach((el) => {
    if (el) el.className = `w-2 h-2 rounded-full ${cls}`;
  });
  [txt, stxt].forEach((el) => {
    if (el) el.textContent = text || (type === "none" ? "Sem conexão" : type);
  });
}

function spinRefresh(on) {
  document.getElementById("refresh-icon")?.classList.toggle("spinning", on);
}

async function carregarStats() {
  console.debug('[carregarStats] iniciando'); debugMsg('carregarStats: iniciando');
  try {
    const headers = await Auth.headers();
    const url = buildApiUrl("/api/stats", { ano: dadosFiltros.ano || "" });
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    // Cache stats data for dashboard card charts
    cachedStatsData = data;

    const stats = data.stats_por_ano || [];
    const anos = data.anos_disponiveis || [];

    // Re-render dashboard cards with fresh stats
    if (allRuns.length) renderDashboardCards(allRuns, cachedStatsData);

    const total = stats.reduce((acc, s) => acc + Number(s.total || 0), 0);
    const pagos = stats.reduce((acc, s) => acc + Number(s.pagos || 0), 0);
    const pendentes = stats.reduce(
      (acc, s) => acc + Number(s.pendentes || 0),
      0,
    );
    const comPlaylist = stats.reduce(
      (acc, s) => acc + Number(s.com_playlist || 0),
      0,
    );

    setTxt("stat-db-total", total);
    setTxt("stat-db-pagos", pagos);
    setTxt("stat-db-pendentes", pendentes);
    setTxt("stat-db-playlist", comPlaylist);

    // Dashboard - Banco de Dados (Será sobrescrito abaixo se houver última execução)
    setTxt("db-total", total);
    setTxt("db-pagos", pagos);
    setTxt("db-pendentes", pendentes);
    setTxt("db-playlist", comPlaylist);

    setTxt("neon-prev-total", total);
    const pctPagos = total ? ((pagos / total) * 100).toFixed(1) : "0.0";
    const pctPlaylist = total
      ? ((comPlaylist / total) * 100).toFixed(1)
      : "0.0";
    setTxt("neon-prev-pagos", `${pctPagos}%`);
    setTxt("neon-prev-playlist", `${pctPlaylist}%`);
    setTxt("neon-prev-anos", anos.join(", ") || "--");

    // Se tivermos uma execução recente, buscar resumo dos registros dessa execução
    try {
      if (allRuns && allRuns.length > 0) {
        const lastRun = allRuns[0];
        let execStats = null;
        let execTotal = 0;

        const queryExecucao = async (idValue, label) => {
          const urlExec = buildApiUrl("/api/recebimentos", { execucao_id: idValue, summary: "1" });
          debugMsg(`carregarStats: buscando resumo ${label}=${idValue}`);
          const execRes = await fetch(urlExec, { headers });
          if (!execRes.ok) {
            console.warn("[carregarStats] resumo da execução retornou HTTP", execRes.status, idValue);
            debugMsg(`carregarStats: resumo ${label} HTTP ${execRes.status}`);
            return null;
          }
          const stats = await execRes.json();
          debugMsg(`carregarStats: resumo ${label} retornou ${JSON.stringify(stats)}`);
          return stats;
        };

        execStats = await queryExecucao(lastRun.id, "id");
        execTotal = Number(execStats?.total || 0);

        if (execTotal === 0 && lastRun.run_number && String(lastRun.run_number) !== String(lastRun.id)) {
          const retryStats = await queryExecucao(lastRun.run_number, "run_number");
          if (retryStats && Number(retryStats.total || 0) > 0) {
            execStats = retryStats;
            execTotal = Number(execStats.total || 0);
          }
        }

        if (execStats) {
          // Dashboard - Banco de Dados (Sempre mostra a ÚLTIMA EXECUÇÃO conforme solicitado)
          setTxt("db-total", Number(execStats.total || 0));
          setTxt("db-pagos", Number(execStats.pagos || 0));
          setTxt("db-pendentes", Number(execStats.pendentes || 0));
          setTxt("db-playlist", Number(execStats.com_playlist || 0));

          // Nota: stat-db-* (Menu Dados) permanecem com os valores filtrados por ano/filtros
        }
      }
    } catch (err) {
      console.error("Erro ao buscar resumo da última execução:", err);
      debugMsg(`carregarStats: erro ao buscar resumo da última execução: ${err.message}`);
      console.debug('[carregarStats] fallback aplicado após erro no resumo da execução');
      debugMsg('carregarStats: fallback zeros aplicado');
    }
    console.debug('[carregarStats] finalizado'); debugMsg('carregarStats: finalizado');

    const selAno = document.getElementById("filtro-ano");
    if (selAno && selAno.options.length <= 1) {
      anos.forEach((a) => {
        const opt = document.createElement("option");
        opt.value = a;
        opt.textContent = a;
        selAno.appendChild(opt);
      });
    }
  } catch (err) {
    toast(`Erro ao carregar stats: ${err.message}`, "error");
  }
}

// Tentativa extra de auto-refresh ao carregar a página (fallback caso init não dispare)
window.addEventListener("load", () => {
  try {
    debugMsg("window.load: agendando auto-refresh");
    setTimeout(() => {
      try {
        refreshData();
        carregarStats();
        debugMsg("auto-refresh: refreshData() e carregarStats() chamados");
      } catch (e) {
        debugMsg("auto-refresh: erro ao chamar refreshData/carregarStats");
        console.error(e);
      }
    }, 700);
  } catch (_) {}
});

async function carregarDados(pagina = 1) {
  try {
    const headers = await Auth.headers();
    const params = {
      page: pagina,
      limit: 50,
      ano: dadosFiltros.ano,
      contratante: dadosFiltros.contratante,
      status_pagamento: dadosFiltros.status_pagamento,
      status_playlist: dadosFiltros.status_playlist,
    };
    const url = buildApiUrl("/api/recebimentos", params);

    document.getElementById("dados-loading")?.classList.remove("hidden");
    document.getElementById("dados-table")?.classList.add("hidden");

    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    dadosPagAtual = data.page || pagina;
    dadosTotal = data.total || 0;
    dadosTotalPags = data.pages || 1;

    renderTabelaDados(data.data || []);
    renderPaginacao(dadosTotal, dadosPagAtual, dadosTotalPags);
  } catch (err) {
    toast(`Erro ao carregar dados: ${err.message}`, "error");
  } finally {
    document.getElementById("dados-loading")?.classList.add("hidden");
    document.getElementById("dados-table")?.classList.remove("hidden");
  }
}

function renderTabelaDados(rows) {
  const tbody = document.getElementById("dados-tbody");
  if (!tbody) return;

  if (!rows.length) {
    tbody.innerHTML = `<tr><td class="px-5 py-6 text-center text-gray-400" colspan="9">Nenhum dado encontrado</td></tr>`;
    return;
  }

  tbody.innerHTML = rows
    .map((r, idx) => {
      const zebra = idx % 2 === 0 ? "bg-gray-50 dark:bg-gray-800/30" : "";
      const status = String(r.status_pagamento || "").toLowerCase();
      let statusClass = "badge-neutral";
      if (status.includes("pago") || status.includes("receb"))
        statusClass = "badge-success";
      else if (status.includes("pend")) statusClass = "badge-queued";
      else if (status.includes("canc")) statusClass = "badge-cancelled";

      const pl = r.status_playlist || "";
      const plClass =
        pl === "Com Playlist" ? "badge-in_progress" : "badge-neutral";

      return `
        <tr class="${zebra}">
          <td class="px-5 py-3.5">${esc(trunc(r.contratante, 20))}</td>
          <td class="px-5 py-3.5">${esc(r.codigo_contrato || "")}</td>
          <td class="px-5 py-3.5">${esc(r.vencimento || "")}</td>
          <td class="px-5 py-3.5">${esc(r.valor_parcela || "")}</td>
          <td class="px-5 py-3.5"><span class="badge ${statusClass}">${esc(r.status_pagamento || "")}</span></td>
          <td class="px-5 py-3.5">${esc(r.pago_em || "")}</td>
          <td class="px-5 py-3.5"><span class="badge ${plClass}">${esc(pl || "-")}</span></td>
          <td class="px-5 py-3.5">${esc(r.faixas || "")}</td>
          <td class="px-5 py-3.5">${esc(r.periodo || "")}</td>
        </tr>
      `;
    })
    .join("");
}

function renderPaginacao(total, page, pages) {
  const start = total === 0 ? 0 : (page - 1) * 50 + 1;
  const end = Math.min(page * 50, total);
  setTxt("pag-info", `Mostrando ${start}-${end} de ${total} registros`);
  setTxt("pag-paginas", `${page} / ${pages}`);
  document
    .getElementById("btn-anterior")
    ?.toggleAttribute("disabled", page <= 1);
  document
    .getElementById("btn-proximo")
    ?.toggleAttribute("disabled", page >= pages);
  setTxt("dados-total-info", `${total} registros`);
}

function mudarPagina(delta) {
  const nova = Math.max(1, Math.min(dadosTotalPags, dadosPagAtual + delta));
  if (nova === dadosPagAtual) return;
  carregarDados(nova);
}

function aplicarFiltros() {
  dadosFiltros = {
    ano: getVal("filtro-ano"),
    contratante: getVal("filtro-contratante").trim(),
    status_pagamento: getVal("filtro-status"),
    status_playlist: getVal("filtro-playlist"),
  };
  dadosPagAtual = 1;
  carregarDados(1);
  carregarStats();
}

function limparFiltros() {
  setVal("filtro-ano", "");
  setVal("filtro-contratante", "");
  setVal("filtro-status", "");
  setVal("filtro-playlist", "");
  aplicarFiltros();
}

async function exportarCSV() {
  try {
    const headers = await Auth.headers();
    const params = {
      page: 1,
      limit: 5000,
      ano: dadosFiltros.ano,
      contratante: dadosFiltros.contratante,
      status_pagamento: dadosFiltros.status_pagamento,
      status_playlist: dadosFiltros.status_playlist,
    };
    const url = buildApiUrl("/api/recebimentos", params);
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const rows = data.data || [];
    const headersCsv = [
      "Contratante",
      "Codigo",
      "Vencimento",
      "Valor",
      "Status",
      "Pago Em",
      "Playlist",
      "Faixas",
      "Periodo",
    ];
    const csv = [headersCsv.join(",")]
      .concat(
        rows.map((r) =>
          [
            csvEsc(r.contratante),
            csvEsc(r.codigo_contrato),
            csvEsc(r.vencimento),
            csvEsc(r.valor_parcela),
            csvEsc(r.status_pagamento),
            csvEsc(r.pago_em),
            csvEsc(r.status_playlist),
            csvEsc(r.faixas),
            csvEsc(r.periodo),
          ].join(","),
        ),
      )
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `recebimentos_${dadosFiltros.ano || "todos"}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } catch (err) {
    toast(`Erro ao exportar CSV: ${err.message}`, "error");
  }
}

async function exportarXLSX() {
  try {
    toast("Preparando planilha...", "info");
    const headers = await Auth.headers();
    const params = {
      limit: 10000,
      ano: dadosFiltros.ano,
      contratante: dadosFiltros.contratante,
      status_pagamento: dadosFiltros.status_pagamento,
      status_playlist: dadosFiltros.status_playlist,
    };
    const url = buildApiUrl("/api/recebimentos", params);
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const rows = data.data || [];

    const excelData = rows.map((r) => ({
      Contratante: r.contratante,
      Código: r.codigo_contrato,
      Vencimento: r.vencimento,
      Valor: r.valor_parcela,
      Status: r.status_pagamento,
      "Pago Em": r.pago_em,
      Playlist: r.status_playlist,
      Faixas: r.faixas,
      Período: r.periodo,
    }));

    const worksheet = XLSX.utils.json_to_sheet(excelData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Recebimentos");
    XLSX.writeFile(workbook, `recebimentos_${dadosFiltros.ano || "todos"}.xlsx`);
    toast("Excel exportado com sucesso", "success");
  } catch (err) {
    toast(`Erro ao exportar Excel: ${err.message}`, "error");
  }
}

async function exportarPDF() {
  try {
    toast("Gerando PDF...", "info");
    const headers = await Auth.headers();
    const params = {
      limit: 10000,
      ano: dadosFiltros.ano,
      contratante: dadosFiltros.contratante,
      status_pagamento: dadosFiltros.status_pagamento,
      status_playlist: dadosFiltros.status_playlist,
    };
    const url = buildApiUrl("/api/recebimentos", params);
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const rows = data.data || [];

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF("l", "mm", "a4");

    doc.setFontSize(16);
    doc.text(`Relatório de Recebimentos - ${dadosFiltros.ano || "Todos os Anos"}`, 14, 15);
    doc.setFontSize(10);
    doc.text(`Gerado em: ${new Date().toLocaleString()}`, 14, 22);

    const tableHeaders = [
      ["Contratante", "Código", "Vencimento", "Valor", "Status", "Pago Em", "Playlist", "Faixas"],
    ];

    const tableData = rows.map((r) => [
      r.contratante,
      r.codigo_contrato,
      r.vencimento,
      r.valor_parcela,
      r.status_pagamento,
      r.pago_em,
      r.status_playlist,
      r.faixas,
    ]);

    doc.autoTable({
      head: tableHeaders,
      body: tableData,
      startY: 30,
      theme: "grid",
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [37, 99, 235] },
    });

    doc.save(`recebimentos_${dadosFiltros.ano || "todos"}.pdf`);
    toast("PDF exportado com sucesso", "success");
  } catch (err) {
    toast(`Erro ao exportar PDF: ${err.message}`, "error");
  }
}

async function confirmarApagarBase() {
  if (!confirm("ATENÇÃO: Isso apagará TODOS os dados de recebimentos do banco de dados permanentemente. Deseja continuar?")) {
    return;
  }

  const senha = prompt("Para confirmar esta operação crítica, informe sua senha de acesso:");
  if (!senha) return;

  try {
    toast("Verificando autenticação...", "info");
    // 1. Reautenticar para validar a senha
    await Auth.reauthenticate(senha);
    
    toast("Senha validada. Apagando base de dados...", "info");
    
    // 2. Chamar API para apagar tudo
    const headers = await Auth.headers();
    const url = buildApiUrl("/api/recebimentos", { deleteAll: "true" });
    const res = await fetch(url, { method: "DELETE", headers });
    
    if (!res.ok) {
      const errorData = await res.json();
      throw new Error(errorData.error || `HTTP ${res.status}`);
    }

    const result = await res.json();
    toast(`Sucesso! ${result.deletedCount} registros removidos.`, "success");
    
    // 3. Atualizar UI
    carregarDados(1);
    try { await carregarStats(); } catch (_) {}
    
  } catch (err) {
    console.error("Erro ao apagar base:", err);
    let msg = err.message;
    if (msg.includes("auth/wrong-password")) msg = "Senha incorreta.";
    toast(`Erro: ${msg}`, "error");
  }
}

async function testarAPI() {
  try {
    const headers = await Auth.headers();
    const url = buildApiUrl("/api/stats", {});
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    toast("API OK ✅", "success");
  } catch (err) {
    toast(`Erro na API: ${err.message}`, "error");
  }
}

function togglePwd(id) {
  const el = document.getElementById(id);
  if (el) el.type = el.type === "password" ? "text" : "password";
}

function toast(msg, type = "info") {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const icons = { success: "✅", error: "❌", info: "ℹ️", warning: "⚠️" };
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.innerHTML = `<span>${icons[type] || ""}</span><span>${esc(msg)}</span>`;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add("toast-exit");
    setTimeout(() => el.remove(), 350);
  }, 4500);
}

function fmtDuration(ms) {
  if (!ms || ms < 0) return "--";
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function statusLabel(s) {
  return (
    {
      success: "Sucesso",
      failure: "Falha",
      cancelled: "Cancelado",
      in_progress: "Em andamento",
      queued: "Na fila",
      waiting: "Aguardando",
      skipped: "Ignorado",
      neutral: "Neutro",
      stale: "Desatualizado",
    }[s] ||
    s ||
    "Desconhecido"
  );
}

function statusEmoji(s) {
  return (
    {
      success: "✅",
      failure: "❌",
      cancelled: "⏹️",
      in_progress: "⏳",
      queued: "⌛",
      waiting: "⏸️",
      skipped: "⏭️",
    }[s] || "•"
  );
}

function triggerLabel(ev) {
  return (
    {
      workflow_dispatch: "▶️ Manual",
      schedule: "📅 Agendado",
      push: "📌 Push",
      pull_request: "🔀 PR",
      repository_dispatch: "🔌 API",
    }[ev] ||
    ev ||
    "--"
  );
}

function esc(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
}

function csvEsc(val) {
  const s = String(val ?? "");
  if (s.includes(",") || s.includes("\n") || s.includes('"')) {
    return `"${s.replace(/\"/g, '""')}"`;
  }
  return s;
}

function trunc(str, n) {
  const s = String(str || "");
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function getVal(id) {
  return document.getElementById(id)?.value ?? "";
}

function setVal(id, v) {
  const el = document.getElementById(id);
  if (el) el.value = v;
}

function setTxt(id, v) {
  const el = document.getElementById(id);
  if (el) el.textContent = v;
}

// Helper para chamadas à API de contratos
async function contratosApiFetch(path) {
  const headers = await Auth.headers();
  const url = buildApiUrl(path);
  return fetch(url, { headers });
}

// =============================================================================
// CONTRATOS — Variáveis globais
// =============================================================================
let contratosPagAtual = 1;
let contratosFiltros = { status: "", contratante: "", data_inicio: "", data_termino: "" };
let contratosTotal = 0;
let contratosTotalPags = 1;
let contratosInicializado = false;
let chartContratosMes = null;

// Atualizar navigateTo para incluir contratos
const _originalNavigateTo = navigateTo;
navigateTo = function(section) {
  _originalNavigateTo(section);

  const titles = {
    dashboard: "Dashboard",
    run: "Executar Extração",
    history: "Histórico",
    dados: "Dados",
    contratos: "Contratos",
    settings: "Configurações",
  };
  const titleEl = document.getElementById("page-title");
  if (titleEl) titleEl.textContent = titles[section] || section;

  if (section === "contratos" && !contratosInicializado) {
    carregarAlertasContratos();
    carregarGraficoContratos();
    carregarContratos(1);
    contratosInicializado = true;
  }
};

// =============================================================================
// CONTRATOS — Carregar alertas (cards)
// =============================================================================
async function carregarAlertasContratos() {
  try {
    const hoje = new Date();
    const dia = hoje.getDay();
    const domingo = new Date(hoje);
    domingo.setDate(hoje.getDate() - dia);
    const sabado = new Date(domingo);
    sabado.setDate(domingo.getDate() + 6);
    const fmt = (d) => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
    const labelEl = document.getElementById("alerta-semana-label");
    if (labelEl) labelEl.textContent = `Esta Semana (${fmt(domingo)} a ${fmt(sabado)})`;

    const respSemana = await contratosApiFetch("/api/contratos?semana=1");
    if (respSemana.ok) {
      const resultSemana = await respSemana.json();
      setTxt("alerta-semana", Number(resultSemana.data?.[0]?.total || 0));
    }

    const resp = await contratosApiFetch("/api/contratos?alerta=1");
    if (!resp.ok) return;
    const result = await resp.json();
    const alertas = result.data || [];

    setTxt("alerta-30", alertas.filter(a => a.alerta === "Vence em 30 dias").length);
    setTxt("alerta-60", alertas.filter(a => a.alerta === "Vence em 60 dias").length);
    setTxt("alerta-90", alertas.filter(a => a.alerta === "Vence em 90 dias").length);
  } catch (e) {
    console.error("[contratos] Erro ao carregar alertas:", e);
  }
}

// =============================================================================
// CONTRATOS — Gráfico de vencimentos por mês
// =============================================================================
async function carregarGraficoContratos() {
  try {
    const resp = await contratosApiFetch("/api/contratos?grafico=1");
    if (!resp.ok) return;
    const result = await resp.json();
    const dados = result.data || [];

    const canvas = document.getElementById("chart-contratos-mes");
    const emptyEl = document.getElementById("chart-contratos-mes-empty");

    if (!dados.length) {
      if (emptyEl) emptyEl.classList.remove("hidden");
      return;
    }
    if (emptyEl) emptyEl.classList.add("hidden");

    const labels = dados.map(d => d.mes_label);
    const values = dados.map(d => Number(d.total));

    if (chartContratosMes) chartContratosMes.destroy();

    const isDark = document.documentElement.classList.contains("dark");

    chartContratosMes = new Chart(canvas, {
      type: "bar",
      data: {
        labels,
        datasets: [{
          label: "Contratos",
          data: values,
          backgroundColor: isDark
            ? "rgba(99,102,241,0.6)"
            : "rgba(99,102,241,0.7)",
          borderColor: isDark
            ? "rgba(99,102,241,1)"
            : "rgba(99,102,241,1)",
          borderWidth: 1,
          borderRadius: 6,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        onClick: (e, elements) => {
          if (elements.length === 0) return;
          const idx = elements[0].index;
          const mesLabel = labels[idx];
          contratosFiltros.data_termino_mes = contratosFiltros.data_termino_mes === mesLabel ? "" : mesLabel;
          const lbl = document.getElementById("ct-filtro-mes-label");
          if (lbl) lbl.textContent = contratosFiltros.data_termino_mes ? `Mês: ${contratosFiltros.data_termino_mes}` : "";
          carregarContratos(1);
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.parsed.y} contratos`,
            },
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              stepSize: 1,
              color: isDark ? "#9ca3af" : "#6b7280",
            },
            grid: {
              color: isDark ? "rgba(75,85,99,0.3)" : "rgba(229,231,235,0.8)",
            },
          },
          x: {
            ticks: { color: isDark ? "#9ca3af" : "#6b7280" },
            grid: { display: false },
          },
        },
      },
    });
  } catch (e) {
    console.error("[contratos] Erro ao carregar gráfico:", e);
  }
}

// =============================================================================
// CONTRATOS — Carregar tabela paginada
// =============================================================================
async function carregarContratos(page) {
  contratosPagAtual = page || 1;

  contratosFiltros.status = getVal("filtro-ct-status");
  contratosFiltros.contratante = getVal("filtro-ct-contratante").trim();
  contratosFiltros.data_inicio = getVal("filtro-ct-data-inicio");
  contratosFiltros.data_termino = getVal("filtro-ct-data-termino");

  const loadingEl = document.getElementById("contratos-loading");
  const tableEl = document.getElementById("contratos-table");
  const tbody = document.getElementById("contratos-tbody");

  if (loadingEl) loadingEl.classList.remove("hidden");
  if (tableEl) tableEl.classList.add("hidden");

  try {
    const params = new URLSearchParams({
      page: contratosPagAtual,
      limit: 50,
      order_by: "data_termino",
      order_dir: "DESC",
    });

    if (contratosFiltros.status) params.set("status", contratosFiltros.status);
    if (contratosFiltros.contratante) params.set("contratante", contratosFiltros.contratante);
    if (contratosFiltros.data_inicio) params.set("data_inicio", contratosFiltros.data_inicio);
    if (contratosFiltros.data_termino) params.set("data_termino", contratosFiltros.data_termino);
    if (contratosFiltros.data_termino_mes) params.set("mes", contratosFiltros.data_termino_mes);

    const resp = await contratosApiFetch(`/api/contratos?${params.toString()}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const result = await resp.json();
    const data = result.data || [];
    contratosTotal = result.total || 0;
    contratosTotalPags = result.pages || 1;

    tbody.innerHTML = data.map(c => `
      <tr>
        <td class="px-5 py-3 font-mono text-xs font-semibold">${esc(c.codigo)}</td>
        <td class="px-5 py-3">${esc(c.contratante)}</td>
        <td class="px-5 py-3 text-xs text-gray-500">${esc(c.alias_matriz)}</td>
        <td class="px-5 py-3 text-xs">${esc(c.data_inicio)}</td>
        <td class="px-5 py-3 text-xs">${esc(c.data_termino)}</td>
        <td class="px-5 py-3 text-xs">${esc(c.forma_envio)}</td>
        <td class="px-5 py-3">
          <span class="badge ${c.status === 'Ativo' ? 'badge-success' : 'badge-neutral'}">${esc(c.status)}</span>
        </td>
      </tr>
    `).join("");

    if (loadingEl) loadingEl.classList.add("hidden");
    if (tableEl) tableEl.classList.remove("hidden");

    // Paginação
    setTxt("ct-pag-info", `${contratosTotal} contratos`);
    setTxt("ct-pag-paginas", `${contratosPagAtual} / ${contratosTotalPags}`);

    const btnAnt = document.getElementById("ct-btn-anterior");
    const btnProx = document.getElementById("ct-btn-proximo");
    if (btnAnt) btnAnt.disabled = contratosPagAtual <= 1;
    if (btnProx) btnProx.disabled = contratosPagAtual >= contratosTotalPags;
  } catch (e) {
    console.error("[contratos] Erro ao carregar:", e);
    if (loadingEl) loadingEl.textContent = "Erro ao carregar contratos.";
  }
}

function mudarPaginaContratos(delta) {
  const novaPag = contratosPagAtual + delta;
  if (novaPag < 1 || novaPag > contratosTotalPags) return;
  carregarContratos(novaPag);
}

function limparFiltrosContratos() {
  contratosFiltros = { status: "", contratante: "", data_inicio: "", data_termino: "", data_termino_mes: "" };
  setVal("filtro-ct-status", "");
  setVal("filtro-ct-contratante", "");
  setVal("filtro-ct-data-inicio", "");
  setVal("filtro-ct-data-termino", "");
  const lbl = document.getElementById("ct-filtro-mes-label");
  if (lbl) lbl.textContent = "";
  carregarContratos(1);
}

// =============================================================================
// CONTRATOS — Exportação CSV
// =============================================================================
function exportarContratosCSV() {
  contratosApiFetch("/api/contratos?limit=10000").then(r => r.json()).then(result => {
    const data = result.data || [];
    if (!data.length) return toast("Nenhum dado para exportar", "warning");

    const headers = ["Código", "Contratante", "Alias/Matriz", "Início", "Término", "Forma Envio", "Status"];
    const rows = data.map(c => [
      csvEsc(c.codigo), csvEsc(c.contratante), csvEsc(c.alias_matriz),
      csvEsc(c.data_inicio), csvEsc(c.data_termino), csvEsc(c.forma_envio), csvEsc(c.status),
    ].join(","));

    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    downloadBlob(blob, "contratos.csv");
    toast("CSV exportado!", "success");
  }).catch(e => toast("Erro ao exportar: " + e.message, "error"));
}

// =============================================================================
// CONTRATOS — Exportação XLSX
// =============================================================================
function exportarContratosXLSX() {
  contratosApiFetch("/api/contratos?limit=10000").then(r => r.json()).then(result => {
    const data = result.data || [];
    if (!data.length) return toast("Nenhum dado para exportar", "warning");

    const ws = XLSX.utils.json_to_sheet(data.map(c => ({
      "Código": c.codigo,
      "Contratante": c.contratante,
      "Alias/Matriz": c.alias_matriz,
      "Início": c.data_inicio,
      "Término": c.data_termino,
      "Forma Envio": c.forma_envio,
      "Status": c.status,
    })));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Contratos");
    XLSX.writeFile(wb, "contratos.xlsx");
    toast("XLSX exportado!", "success");
  }).catch(e => toast("Erro ao exportar: " + e.message, "error"));
}
