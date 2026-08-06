const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
const formatNumber = (value) => Number(value || 0).toLocaleString("ja-JP");
const formatDate = (iso) => { if (!iso) return "—"; const date = new Date(iso); return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric" }).format(date); };
const safeUrl = (value = "") => /^https:\/\//.test(value) ? value : "#";
const yenOku = (value) => Number(value || 0) / 100;

function renderMoney(rows) {
  const element = $("#money-measures");
  if (!element || !rows?.length) { if (element) element.innerHTML = '<p class="data-empty">研究開発費を取得できませんでした。</p>'; return; }
  const max = Math.max(...rows.flatMap((row) => [row.internal_research_expenditure_million_yen, row.incoming_research_funds_million_yen, row.external_research_expenditure_million_yen].map(Number)), 1);
  const measures = [["内部使用", "internal_research_expenditure_million_yen", ""], ["受入研究費", "incoming_research_funds_million_yen", "violet"], ["外部支出", "external_research_expenditure_million_yen", "orange"]];
  element.innerHTML = rows.map((row) => `<div class="measure-row"><div class="measure-row-head"><strong>${escapeHtml(row.name)}</strong><small>${formatNumber(row.organizations)}組織</small><b>${formatNumber(yenOku(row.internal_research_expenditure_million_yen))}億円</b></div><div class="measure-track">${measures.map(([label, key, tone]) => `<div class="measure-line"><span>${label}</span><div class="measure-bar"><i class="${tone}" style="width:${Math.max(1, (Number(row[key] || 0) / max) * 100)}%"></i></div><b>${formatNumber(yenOku(row[key]))}億円</b></div>`).join("")}</div></div>`).join("");
}

function renderSignals(items) {
  const element = $("#budget-signal-list");
  if (!element) return;
  const terms = ["予算", "概算要求", "基金", "資金", "配分", "投資", "財源"];
  const rows = (items || []).filter((item) => terms.some((term) => JSON.stringify(item).includes(term))).sort((a, b) => String(b.published_at).localeCompare(String(a.published_at))).slice(0, 7);
  element.innerHTML = rows.length ? rows.map((item) => `<a class="signal-item" href="${escapeHtml(safeUrl(item.url))}" target="_blank" rel="noopener noreferrer"><time class="signal-date" datetime="${escapeHtml(item.published_at || "")}">${formatDate(item.published_at)}</time><span class="signal-copy"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.source || "公式ソース")} / ${escapeHtml(item.document_type || "公式更新")}</small></span><span class="signal-arrow" aria-hidden="true">↗</span></a>`).join("") : '<p class="panel-note">予算に関係する更新はまだありません。</p>';
}

function renderSources(sources) {
  const element = $("#budget-source-links");
  if (element) element.innerHTML = (sources || []).map((source) => `<a class="source-chip" href="${escapeHtml(safeUrl(source.url))}" target="_blank" rel="noopener noreferrer"><span>${escapeHtml(source.title)}</span><small>${source.status === "ok" ? "取得済み" : "カタログ"} ↗</small></a>`).join("");
}

async function load() {
  try {
    const [analyticsResponse, updatesResponse] = await Promise.all([fetch("data/analytics.json", { cache: "no-store" }), fetch("data/updates.json", { cache: "no-store" })]);
    if (!analyticsResponse.ok || !updatesResponse.ok) throw new Error("data unavailable");
    const analytics = await analyticsResponse.json(); const updates = await updatesResponse.json(); const money = analytics.reality?.money || {}; const rows = money.rows || [];
    const internalTotal = rows.reduce((sum, row) => sum + yenOku(row.internal_research_expenditure_million_yen), 0); const top = [...rows].sort((a, b) => Number(b.internal_research_expenditure_million_yen || 0) - Number(a.internal_research_expenditure_million_yen || 0))[0]; const signalCount = analytics.policy?.theme_counts?.find((row) => row.label === "予算・資金")?.count || 0;
    $("#total-internal").textContent = formatNumber(Math.round(internalTotal)); $("#top-actor").textContent = top?.name || "—"; $("#top-actor-note").textContent = top ? `${formatNumber(Math.round(yenOku(top.internal_research_expenditure_million_yen)))}億円` : "主体"; $("#survey-year").textContent = `${analytics.reality?.survey_year || "—"}年`; $("#hero-signal-count").textContent = `${formatNumber(signalCount)}件`; $("#hero-survey-year").textContent = `${analytics.reality?.survey_year || "—"} / e-Stat`;
    const generated = analytics.generated_at ? new Date(analytics.generated_at) : null; $("#hero-meta").textContent = generated && !Number.isNaN(generated.getTime()) ? `最終生成 ${new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", dateStyle: "medium", timeStyle: "short" }).format(generated)} / JST` : "生成日時不明"; $("#header-status").textContent = `${rows.length}主体 / 研究開発費を観測`;
    renderMoney(rows); renderSignals(updates.items); renderSources(money.status === "ok" ? analytics.reality.sources : []);
  } catch (error) { console.error(error); $("#header-status").textContent = "資金データを取得できません"; $("#hero-meta").textContent = "データファイルを取得できませんでした"; }
  $("#footer-year").textContent = String(new Date().getFullYear());
}
load();
