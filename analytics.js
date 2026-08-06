const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
const numberFormat = new Intl.NumberFormat("ja-JP");

function setText(selector, value) { const element = $(selector); if (element) element.textContent = value; }
function formatNumber(value) { return value === null || value === undefined ? "—" : numberFormat.format(value); }
function formatDate(value) { if (!value) return "—"; const date = new Date(`${value}T00:00:00+09:00`); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "short", day: "numeric" }).format(date); }
function formatYen(millionYen) {
  if (millionYen === null || millionYen === undefined) return "—";
  if (millionYen >= 1000000) return `${(millionYen / 1000000).toFixed(1)}兆円`;
  if (millionYen >= 100) return `${formatNumber(Math.round(millionYen / 100))}億円`;
  return `${formatNumber(millionYen)}百万円`;
}
function width(value, max) { return `${Math.max(2, Math.round((Number(value || 0) / Math.max(1, max)) * 100))}%`; }

function rankList(selector, rows, empty = "データがありません") {
  const element = $(selector);
  if (!element) return;
  if (!rows?.length) { element.innerHTML = `<p class="data-empty">${escapeHtml(empty)}</p>`; return; }
  const max = Math.max(...rows.map((row) => Number(row.count || 0)), 1);
  element.innerHTML = rows.map((row, index) => `<div class="rank-row"><div class="rank-label"><span class="rank-no">${String(index + 1).padStart(2, "0")}</span><span>${escapeHtml(row.label)}</span><b>${formatNumber(row.count)}</b></div><div class="rank-track"><i style="width:${width(row.count, max)}"></i></div></div>`).join("");
}

function renderMonthly(rows) {
  const element = $("#monthly-chart");
  if (!element || !rows?.length) { if (element) element.innerHTML = `<p class="data-empty">月別データがありません</p>`; return; }
  const visible = rows.slice(-18);
  const max = Math.max(...visible.map((row) => row.count), 1);
  element.innerHTML = visible.map((row) => `<div class="month-column"><span class="month-value">${row.count}</span><div class="month-track"><i style="height:${Math.max(4, Math.round((row.count / max) * 100))}%"></i></div><span class="month-label">${escapeHtml(row.month.slice(2).replace("-", "/"))}</span></div>`).join("");
}

function renderThemes(rows) {
  const element = $("#theme-list");
  if (!element || !rows?.length) { if (element) element.innerHTML = `<p class="data-empty">テーマデータがありません</p>`; return; }
  const max = Math.max(...rows.map((row) => row.count), 1);
  element.innerHTML = rows.map((row) => `<div class="theme-chip"><span>${escapeHtml(row.label)}</span><b>${formatNumber(row.count)}</b><i style="width:${width(row.count, max)}"></i></div>`).join("");
}

function renderMoney(rows, unit) {
  const element = $("#money-chart");
  if (!element || !rows?.length) { if (element) element.innerHTML = `<p class="data-empty">研究費データを取得できませんでした</p>`; return; }
  const keys = ["internal_research_expenditure_million_yen", "incoming_research_funds_million_yen", "external_research_expenditure_million_yen"];
  const max = Math.max(...rows.flatMap((row) => keys.map((key) => Number(row[key] || 0))), 1);
  element.innerHTML = rows.map((row) => `<div class="flow-row"><div class="flow-label"><strong>${escapeHtml(row.name)}</strong><small>${formatNumber(row.organizations)}組織</small></div><div class="flow-lines">${keys.map((key, index) => `<div class="flow-line"><span class="flow-line-label">${["内部", "受入", "外部"][index]}</span><div class="flow-track"><i class="flow-${["internal", "incoming", "outgoing"][index]}" style="width:${width(row[key], max)}"></i></div><b>${formatYen(row[key])}</b></div>`).join("")}</div></div>`).join("");
}

function renderPeople(rows) {
  const element = $("#people-chart");
  if (!element || !rows?.length) { if (element) element.innerHTML = `<p class="data-empty">研究者データを取得できませんでした</p>`; return; }
  const max = Math.max(...rows.flatMap((row) => [Number(row.recruitment_and_transfer || 0), Number(row.outgoing_researchers || 0)]), 1);
  element.innerHTML = rows.map((row) => `<div class="people-row"><div class="people-label"><strong>${escapeHtml(row.name)}</strong><small>採用・転入 ${formatNumber(row.recruitment_and_transfer)}人</small></div><div class="people-lines"><div><span>採用・転入</span><div class="flow-track"><i class="flow-internal" style="width:${width(row.recruitment_and_transfer, max)}"></i></div><b>${formatNumber(row.recruitment_and_transfer)}</b></div><div><span>転出</span><div class="flow-track"><i class="flow-outgoing" style="width:${width(row.outgoing_researchers, max)}"></i></div><b>${formatNumber(row.outgoing_researchers)}</b></div></div></div>`).join("");
}

function renderSources(sources) {
  const element = $("#source-cards");
  if (!element) return;
  element.innerHTML = (sources || []).map((source) => `<a class="source-card" href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer"><span class="source-card-id">${escapeHtml(source.id || "OFFICIAL")}</span><strong>${escapeHtml(source.title)}</strong><small>e-Stat / 2025年 / ${source.status === "ok" ? "取得済み" : "未取得"} ↗</small></a>`).join("");
}

function render(payload) {
  const policy = payload.policy || {};
  const reality = payload.reality || {};
  const money = reality.money || {};
  const people = reality.people || {};
  setText("#policy-count", formatNumber(policy.item_count));
  setText("#policy-top-type", policy.document_type_counts?.[0]?.label || "—");
  setText("#policy-period", policy.period?.from && policy.period?.to ? `${policy.period.from.slice(0, 7)} — ${policy.period.to.slice(0, 7)}` : "—");
  setText("#survey-year", `${reality.survey_year || 2025}年`);
  const generatedAt = payload.generated_at ? new Date(payload.generated_at) : null;
  setText("#hero-meta", generatedAt && !Number.isNaN(generatedAt.getTime()) ? `最終生成 ${new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", dateStyle: "medium", timeStyle: "short" }).format(generatedAt)} / JST` : "生成日時不明");
  setText("#header-status", `${money.status === "ok" && people.status === "ok" ? "統計2表 / " : ""}${formatNumber(policy.item_count)}件を観測`);
  renderMonthly(policy.monthly_activity);
  rankList("#document-type-list", policy.document_type_counts);
  rankList("#source-list", policy.source_counts);
  renderThemes(policy.theme_counts);
  renderMoney(money.rows, money.unit);
  renderPeople(people.rows);
  renderSources(reality.sources);
}

async function load() {
  try {
    const response = await fetch("data/analytics.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    render(await response.json());
    document.body.classList.add("is-ready");
  } catch (error) {
    console.error(error);
    setText("#header-status", "観測データを取得できません");
    document.querySelectorAll("[id$='-chart'], .rank-list, .theme-grid").forEach((element) => { element.innerHTML = `<p class="data-empty">データを読み込めませんでした</p>`; });
  }
  setText("#footer-year", String(new Date().getFullYear()));
}

load();
