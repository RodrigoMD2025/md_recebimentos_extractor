/**
 * MD Recebimentos — Dashboard App
 * GitHub Actions + Neon + Firebase Auth
 */

"use strict";

const GH_API = "https://api.github.com";
const WORKFLOW_ID = "recebimentos.yml";
const STORE_KEY = "md_rcb_config";
const STORE_KEY_LAST_EXECUCAO = "md_rcb_last_execucao_anos"; // Guarda anos da última execução

let cfg = {
  token: "",
  owner: "",
  repo: "md_recebimentos_extractor",
  years: ["2024", "2025"],
  theme: "light",
  apiUrl: "",
};

let appUser = null;
let allRuns = [];
let execucaoYearsMap = {};
let donutChart = null;
let barChart = null;
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

Auth.init(function (user) {
  appUser = user;
  setUserUI(user);
  init();
});

function init() {
  loadConfig();
  applyTheme(cfg.theme);
  initNav();
  buildYearTags();
  bindFiltroEvents();

  if (cfg.token && cfg.owner) {
    loadRuns();
  } else {
    showSetupModal();
  }

  carregarStats();
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
    if (raw) cfg = { ...cfg, ...JSON.parse(raw) };
  } catch (_) {}
  syncFormFields();
}

function persistConfig() {
  localStorage.setItem(STORE_KEY, JSON.stringify(cfg));
}

function syncFormFields() {
  setVal("cfg-token", cfg.token);
  setVal("cfg-owner", cfg.owner);
  setVal("cfg-repo", cfg.repo);
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

function bindFiltroEvents() {
  const ano = document.getElementById("filtro-ano");
  const status = document.getElementById("filtro-status");
  const playlist = document.getElementById("filtro-playlist");
  const contratante = document.getElementById("filtro-contratante");

  if (ano) ano.addEventListener("change", aplicarFiltros);
  if (status) status.addEventListener("change", aplicarFiltros);
  if (playlist) playlist.addEventListener("change", aplicarFiltros);
  if (contratante) {
    contratante.addEventListener("input", () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(aplicarFiltros, 400);
    });
  }
}

function ghHeaders() {
  return {
    Authorization: `Bearer ${cfg.token}`,
    Accept: "application/vnd.github.v3+json",
    "Content-Type": "application/json",
  };
}

async function ghFetch(path, opts = {}) {
  const res = await fetch(`${GH_API}${path}`, {
    ...opts,
    headers: ghHeaders(),
  });
  if (res.status === 204) return null;
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `HTTP ${res.status}`);
  }
  return res.json();
}

async function loadRuns(forHistory = false) {
  if (!cfg.token || !cfg.owner) {
    setStatus("none");
    return;
  }

  spinRefresh(true);
  setStatus("loading", "Conectando…");

  try {
    const data = await ghFetch(
      `/repos/${cfg.owner}/${cfg.repo}/actions/runs?per_page=50`,
    );
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
  const failed = runs.filter((r) =>
    ["failure", "cancelled"].includes(r.conclusion),
  ).length;

  setTxt("stat-total", total);
  setTxt("stat-success", success);
  setTxt("stat-failed", failed);

  if (runs.length > 0) {
    const last = runs[0];
    const d = new Date(last.created_at);
    setTxt("stat-last-date", d.toLocaleDateString("pt-BR"));
    setTxt("stat-last-status", statusLabel(last.conclusion || last.status));
  }
}

function renderCharts(runs) {
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
        yearsContent = `
          <select style="color:#000 !important; background:#fff !important;" class="text-[11px] font-medium bg-blue-50 text-black dark:text-black border-none rounded-full px-2 py-0.5 focus:ring-0 cursor-pointer outline-none">
            <option selected disabled style="color:#000 !important; background:#fff !important;">${yearsArr.length} Anos...</option>
            ${yearsArr.map((y) => `<option style="color:#000 !important; background:#fff !important;">${y}</option>`).join("")}
          </select>
        `;
      } else if (yearsArr.length === 1) {
        yearsContent = `<span class="text-[11px] font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">${esc(yearsArr[0])}</span>`;
      } else {
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

      return `
        <tr>
          <td class="px-5 py-3.5">#${run.run_number}</td>
          <td class="px-5 py-3.5">${title}</td>
          ${yearsCell}
          ${triggerCell}
          <td class="px-5 py-3.5">${badge}</td>
          <td class="px-5 py-3.5 text-gray-500 text-xs">${dateStr}</td>
          <td class="px-5 py-3.5 text-gray-500 text-xs">${dur}</td>
          <td class="px-5 py-3.5"><a class="text-xs text-blue-600" href="${run.html_url}" target="_blank" rel="noopener">Abrir</a></td>
        </tr>
      `;
    })
    .join("");
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

async function triggerWorkflow() {
  if (!cfg.token || !cfg.owner) {
    showSetupModal();
    return;
  }

  const branch = document.getElementById("run-branch")?.value || "main";

  // Obter anos selecionados
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

    await ghFetch(
      `/repos/${cfg.owner}/${cfg.repo}/actions/workflows/${WORKFLOW_ID}/dispatches`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    );

    toast("Workflow iniciado com sucesso! 🚀", "success");
    
    // Guardar quais anos foram executados para usá-los no histórico
    localStorage.setItem(STORE_KEY_LAST_EXECUCAO, JSON.stringify({
      anos: selectedYears,
      timestamp: new Date().toISOString(),
    }));
    
    document.getElementById("active-monitor")?.classList.remove("hidden");
    setTimeout(() => loadRuns(true), 4000); // Recarregar histórico para mostrar a nova execução
  } catch (err) {
    toast(`Erro ao iniciar workflow: ${err.message}`, "error");
  } finally {
    if (btn) btn.disabled = false;
  }
}

function saveSettings() {
  cfg.token = getVal("cfg-token").trim();
  cfg.owner = getVal("cfg-owner").trim();
  cfg.repo = getVal("cfg-repo").trim() || "md_recebimentos_extractor";
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
  const token = getVal("cfg-token").trim();
  const owner = getVal("cfg-owner").trim();
  const repo = getVal("cfg-repo").trim() || "md_recebimentos_extractor";
  if (!token || !owner) {
    toast("Preencha token e usuário", "warning");
    return;
  }

  try {
    const res = await fetch(`${GH_API}/repos/${owner}/${repo}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
      },
    });
    if (res.ok) {
      const d = await res.json();
      toast(`✅ Repositório encontrado: ${d.full_name}`, "success");
    } else {
      toast("❌ Repositório não encontrado ou token inválido", "error");
    }
  } catch (e) {
    toast(`❌ Erro: ${e.message}`, "error");
  }
}

function clearSettings() {
  if (!confirm("Limpar todas as configurações salvas?")) return;
  localStorage.removeItem(STORE_KEY);
  cfg = {
    token: "",
    owner: "",
    repo: "md_recebimentos_extractor",
    years: ["2024", "2025"],
    theme: "light",
    apiUrl: "",
  };
  syncFormFields();
  buildYearTags();
  toast("Configurações limpas", "info");
}

function showSetupModal() {
  document.getElementById("setup-modal")?.classList.remove("hidden");
}

function closeSetupModal() {
  document.getElementById("setup-modal")?.classList.add("hidden");
}

function completeSetup() {
  const token = getVal("setup-token").trim();
  const owner = getVal("setup-owner").trim();
  const repo = getVal("setup-repo").trim() || "md_recebimentos_extractor";
  if (!token || !owner) {
    toast("Preencha token e usuário", "warning");
    return;
  }
  cfg.token = token;
  cfg.owner = owner;
  cfg.repo = repo;
  persistConfig();
  closeSetupModal();
  syncFormFields();
  toast("Configuração salva!", "success");
  loadRuns();
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
  try {
    const headers = await Auth.headers();
    const url = buildApiUrl("/api/stats", { ano: dadosFiltros.ano || "" });
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const stats = data.stats_por_ano || [];
    const anos = data.anos_disponiveis || [];

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

    setTxt("neon-prev-total", total);
    const pctPagos = total ? ((pagos / total) * 100).toFixed(1) : "0.0";
    const pctPlaylist = total
      ? ((comPlaylist / total) * 100).toFixed(1)
      : "0.0";
    setTxt("neon-prev-pagos", `${pctPagos}%`);
    setTxt("neon-prev-playlist", `${pctPlaylist}%`);
    setTxt("neon-prev-anos", anos.join(", ") || "--");

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
    contratante: getVal("filtro-contratante"),
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
