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
  const width = 920; const height = 250; const left = 36; const right = 18; const top = 18; const bottom = 38; const plotWidth = width - left - right; const plotHeight = height - top - bottom; const max = Math.max(...visible.map((row) => Number(row.count || 0)), 1);
  const points = visible.map((row, index) => { const x = left + (index / Math.max(1, visible.length - 1)) * plotWidth; const y = top + plotHeight - (Number(row.count || 0) / max) * plotHeight; return { ...row, x, y }; });
  const line = points.map((point) => `${point.x},${point.y}`).join(" "); const area = `${left},${top + plotHeight} ${line} ${left + plotWidth},${top + plotHeight}`;
  const grid = [0, .25, .5, .75, 1].map((ratio) => { const y = top + plotHeight * (1 - ratio); return `<line class="pulse-grid" x1="${left}" x2="${left + plotWidth}" y1="${y}" y2="${y}" /><text class="pulse-axis-label" x="4" y="${y + 4}">${Math.round(max * ratio)}</text>`; }).join("");
  const labels = points.map((point, index) => index % Math.max(1, Math.ceil(points.length / 8)) === 0 || index === points.length - 1 ? `<text class="pulse-month" x="${point.x}" y="${height - 10}" text-anchor="middle">${escapeHtml(point.month.slice(2).replace("-", "/"))}</text>` : "").join("");
  const marks = points.map((point) => `<circle class="pulse-point" cx="${point.x}" cy="${point.y}" r="4"><title>${escapeHtml(point.month)} / ${formatNumber(point.count)}件</title></circle>`).join("");
  element.innerHTML = `<svg class="pulse-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="月別の公式更新件数"><g>${grid}</g><polygon class="pulse-area" points="${area}" /><polyline class="pulse-line" points="${line}" />${marks}${labels}</svg>`;
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

function renderSankey(links, rows) {
  const element = $("#people-sankey");
  const detail = $("#sankey-detail");
  if (!element || !links?.length) { if (element) element.innerHTML = `<p class="data-empty">研究者の流れを取得できませんでした</p>`; return; }
  const width = 900;
  const height = 440;
  const sourceOrder = ["企業", "非営利団体", "公的機関", "大学等", "その他"];
  const targetOrder = ["企業", "非営利団体", "公的機関", "大学等"];
  const sourceNames = sourceOrder.filter((name) => links.some((link) => link.source === name));
  const targetNames = targetOrder.filter((name) => links.some((link) => link.target === name));
  const sourceTotals = Object.fromEntries(sourceNames.map((name) => [name, links.filter((link) => link.source === name).reduce((sum, link) => sum + Number(link.value || 0), 0)]));
  const targetTotals = Object.fromEntries(targetNames.map((name) => [name, links.filter((link) => link.target === name).reduce((sum, link) => sum + Number(link.value || 0), 0)]));
  const maxTotal = Math.max(...Object.values(sourceTotals), ...Object.values(targetTotals), 1);
  const scale = 108 / maxTotal;
  const makeNodes = (names, totals, x) => {
    const heights = names.map((name) => Math.max(16, totals[name] * scale));
    const totalHeight = heights.reduce((sum, value) => sum + value, 0) + (names.length - 1) * 22;
    let y = Math.max(28, (height - totalHeight) / 2);
    return Object.fromEntries(names.map((name, index) => { const node = { name, x, y, height: heights[index], total: totals[name] }; y += heights[index] + 22; return [name, node]; }));
  };
  const sourceNodes = makeNodes(sourceNames, sourceTotals, 64);
  const targetNodes = makeNodes(targetNames, targetTotals, 820);
  const sourceCursor = Object.fromEntries(sourceNames.map((name) => [name, sourceNodes[name].y]));
  const targetCursor = Object.fromEntries(targetNames.map((name) => [name, targetNodes[name].y]));
  const palette = { "企業": 0, "非営利団体": 1, "公的機関": 2, "大学等": 3, "その他": 4 };
  const paths = links.map((link) => {
    const source = sourceNodes[link.source];
    const target = targetNodes[link.target];
    const thickness = Math.max(2, Number(link.value || 0) * scale);
    const sourceY = sourceCursor[link.source] + thickness / 2;
    const targetY = targetCursor[link.target] + thickness / 2;
    sourceCursor[link.source] += thickness;
    targetCursor[link.target] += thickness;
    return `<path class="sankey-link series-${palette[link.source] ?? 0}" data-source="${escapeHtml(link.source)}" data-target="${escapeHtml(link.target)}" data-value="${link.value}" d="M ${source.x + 16} ${sourceY} C 300 ${sourceY}, 584 ${targetY}, ${target.x} ${targetY}" stroke-width="${thickness}" aria-label="${escapeHtml(link.source)}から${escapeHtml(link.target)}へ${formatNumber(link.value)}人" />`;
  }).join("");
  const nodeMarkup = (node, kind) => {
    const source = kind === "source";
    const labelX = source ? node.x - 13 : node.x + 29;
    const anchor = source ? "end" : "start";
    return `<g class="sankey-node ${kind}" data-kind="${kind}" data-name="${escapeHtml(node.name)}"><rect x="${node.x}" y="${node.y}" width="16" height="${node.height}" rx="8" /><text x="${labelX}" y="${node.y + node.height / 2 + 4}" text-anchor="${anchor}">${escapeHtml(node.name)}</text><text class="node-value" x="${labelX}" y="${node.y + node.height / 2 + 21}" text-anchor="${anchor}">${formatNumber(node.total)}人</text></g>`;
  };
  element.innerHTML = `<svg class="sankey-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet"><g class="sankey-links">${paths}</g><g class="sankey-nodes">${sourceNames.map((name) => nodeMarkup(sourceNodes[name], "source")).join("")}${targetNames.map((name) => nodeMarkup(targetNodes[name], "target")).join("")}</g></svg>`;

  let selected = null;
  const updateDetail = (kind, name) => {
    const row = rows.find((candidate) => candidate.name === name);
    const related = kind === "source" ? links.filter((link) => link.source === name).sort((a, b) => b.value - a.value) : links.filter((link) => link.target === name).sort((a, b) => b.value - a.value);
    const label = kind === "source" ? "転入元としての流れ" : "転入先としての流れ";
    detail.innerHTML = `<span class="detail-prompt">${kind === "source" ? "ORIGIN NODE" : "DESTINATION NODE"} / ${escapeHtml(name)}</span><strong>${escapeHtml(label)}</strong><span class="detail-total">${formatNumber(kind === "source" ? related.reduce((sum, link) => sum + link.value, 0) : row?.incoming_researchers)}人</span><div class="detail-links">${related.slice(0, 5).map((link) => `<span>${escapeHtml(kind === "source" ? link.target : link.source)} <b>${formatNumber(link.value)}人</b></span>`).join("")}</div>`;
  };
  const emphasize = (kind, name) => {
    element.querySelectorAll(".sankey-link").forEach((path) => { path.classList.toggle("is-dim", !(path.dataset.source === name || path.dataset.target === name)); });
    element.querySelectorAll(".sankey-node").forEach((node) => { node.classList.toggle("is-dim", kind === "link" ? node.dataset.name !== name : !(node.dataset.kind === kind && node.dataset.name === name)); });
    setText("#sankey-hover", `${name}の流れを表示中`);
  };
  const clear = () => { if (selected) return; element.querySelectorAll(".is-dim").forEach((item) => item.classList.remove("is-dim")); setText("#sankey-hover", "線を選択"); };
  element.querySelectorAll(".sankey-link").forEach((path) => {
    path.addEventListener("mouseenter", () => { if (!selected) emphasize("link", path.dataset.source); });
    path.addEventListener("mouseleave", clear);
    path.addEventListener("click", () => { selected = { kind: "source", name: path.dataset.source }; updateDetail(selected.kind, selected.name); emphasize(selected.kind, selected.name); });
  });
  element.querySelectorAll(".sankey-node").forEach((node) => {
    node.addEventListener("mouseenter", () => { if (!selected) emphasize(node.dataset.kind, node.dataset.name); });
    node.addEventListener("mouseleave", clear);
    node.addEventListener("click", () => { selected = { kind: node.dataset.kind, name: node.dataset.name }; updateDetail(selected.kind, selected.name); emphasize(selected.kind, selected.name); });
  });
  $("#sankey-reset")?.addEventListener("click", () => { selected = null; clear(); detail.innerHTML = `<span class="selection-empty">—</span>`; });
}

function renderDonut(rows) {
  const element = $("#document-donut");
  const detail = $("#donut-detail");
  if (!element || !rows?.length) { if (element) element.innerHTML = `<p class="data-empty">文書構成を取得できませんでした</p>`; return; }
  const total = rows.reduce((sum, row) => sum + Number(row.count || 0), 0);
  const radius = 92;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  const segments = rows.map((row, index) => { const length = (Number(row.count || 0) / total) * circumference; const segment = `<circle class="donut-segment series-${index % 6}" data-index="${index}" cx="140" cy="140" r="${radius}" stroke-dasharray="${length} ${circumference - length}" stroke-dashoffset="${-offset}" />`; offset += length; return segment; }).join("");
  const legend = rows.map((row, index) => `<button class="donut-legend" type="button" data-index="${index}" aria-pressed="false"><i class="series-${index % 6}"></i><span>${escapeHtml(row.label)}</span><b>${formatNumber(row.count)}</b></button>`).join("");
  element.innerHTML = `<div class="donut-visual"><svg class="donut-svg" viewBox="0 0 280 280" aria-hidden="true"><circle class="donut-base" cx="140" cy="140" r="${radius}" /><g transform="rotate(-90 140 140)">${segments}</g><text x="140" y="134" text-anchor="middle">${formatNumber(total)}</text><text class="donut-center-label" x="140" y="158" text-anchor="middle">公式更新</text></svg></div><div class="donut-legend-list">${legend}</div>`;
  const select = (index) => {
    const row = rows[index];
    element.querySelectorAll(".donut-segment").forEach((segment) => segment.classList.toggle("is-muted", Number(segment.dataset.index) !== index));
    element.querySelectorAll(".donut-legend").forEach((button) => { const active = Number(button.dataset.index) === index; button.classList.toggle("is-selected", active); button.setAttribute("aria-pressed", String(active)); });
    detail.innerHTML = `<span class="detail-prompt">SELECTED ROLE</span><strong>${escapeHtml(row.label)}</strong><span>${formatNumber(row.count)}件 / 全体の${Math.round((row.count / total) * 100)}%</span>`;
  };
  element.querySelectorAll(".donut-segment, .donut-legend").forEach((item) => { item.addEventListener("mouseenter", () => select(Number(item.dataset.index))); });
  element.querySelectorAll(".donut-legend").forEach((button) => button.addEventListener("click", () => select(Number(button.dataset.index))));
  select(0);
}

function renderActorScatter(moneyRows, peopleRows) {
  const element = $("#actor-scatter");
  if (!element || !moneyRows?.length) { if (element) element.innerHTML = `<p class="data-empty">主体データがありません</p>`; return; }
  const rows = moneyRows.map((money) => ({ ...money, ...(peopleRows?.find((people) => people.name === money.name) || {}) }));
  const width = 620; const height = 300; const left = 46; const right = 28; const top = 16; const bottom = 38; const plotWidth = width - left - right; const plotHeight = height - top - bottom;
  const xMax = Math.max(...rows.map((row) => Number(row.internal_research_expenditure_million_yen || 0)), 1); const yMax = Math.max(...rows.map((row) => Number(row.recruitment_and_transfer || 0)), 1); const maxOrganizations = Math.max(...rows.map((row) => Number(row.organizations || 0)), 1);
  const x = (value) => left + (Number(value || 0) / xMax) * plotWidth; const y = (value) => top + plotHeight - (Number(value || 0) / yMax) * plotHeight; const r = (value) => 7 + Math.sqrt(Number(value || 0) / maxOrganizations) * 20;
  const grid = [0, .25, .5, .75, 1].map((ratio) => { const yPos = top + plotHeight * (1 - ratio); return `<line class="scatter-grid" x1="${left}" x2="${left + plotWidth}" y1="${yPos}" y2="${yPos}" />`; }).join("");
  const points = rows.map((row) => `<circle class="scatter-point" cx="${x(row.internal_research_expenditure_million_yen)}" cy="${y(row.recruitment_and_transfer)}" r="${r(row.organizations)}" aria-label="${escapeHtml(row.name)}"><title>${escapeHtml(row.name)} / ${formatYen(row.internal_research_expenditure_million_yen)} / ${formatNumber(row.recruitment_and_transfer)}人</title></circle><text class="scatter-label" x="${x(row.internal_research_expenditure_million_yen) + r(row.organizations) + 5}" y="${y(row.recruitment_and_transfer) + 4}">${escapeHtml(row.name)}</text>`).join("");
  element.innerHTML = `<svg class="scatter-svg" viewBox="0 0 ${width} ${height}" aria-label="主体別の研究費と採用・転入の散布図"><g>${grid}</g><line class="scatter-axis" x1="${left}" x2="${left}" y1="${top}" y2="${top + plotHeight}" /><line class="scatter-axis" x1="${left}" x2="${left + plotWidth}" y1="${top + plotHeight}" y2="${top + plotHeight}" />${points}<text class="scatter-caption" x="${left + plotWidth}" y="${height - 10}" text-anchor="end">内部使用研究費 →</text><text class="scatter-caption" transform="translate(13 ${top + plotHeight / 2}) rotate(-90)">採用・転入 →</text></svg>`;
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
  const totalInternal = (money.rows || []).reduce((sum, row) => sum + Number(row.internal_research_expenditure_million_yen || 0), 0);
  const totalResearchers = (people.rows || []).reduce((sum, row) => sum + Number(row.recruitment_and_transfer || 0), 0);
  setText("#hero-count", formatNumber(policy.item_count));
  setText("#metric-updates", formatNumber(policy.item_count));
  setText("#metric-spend", formatNumber(Math.round(totalInternal / 100)));
  setText("#metric-researchers", formatNumber(totalResearchers));
  setText("#metric-feeds", formatNumber(policy.source_counts?.length || 0));
  setText("#policy-period", policy.period?.from && policy.period?.to ? `${policy.period.from.slice(0, 7)} — ${policy.period.to.slice(0, 7)}` : "—");
  const generatedAt = payload.generated_at ? new Date(payload.generated_at) : null;
  setText("#hero-meta", generatedAt && !Number.isNaN(generatedAt.getTime()) ? `最終生成 ${new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", dateStyle: "medium", timeStyle: "short" }).format(generatedAt)} / JST` : "生成日時不明");
  setText("#header-status", `${money.status === "ok" && people.status === "ok" ? "統計2表 / " : ""}${formatNumber(policy.item_count)}件を観測`);
  renderMonthly(policy.monthly_activity);
  rankList("#document-type-list", policy.document_type_counts);
  rankList("#source-list", policy.source_counts);
  renderThemes(policy.theme_counts);
  renderMoney(money.rows, money.unit);
  renderPeople(people.rows);
  renderSankey(people.links, people.rows);
  renderDonut(policy.document_type_counts);
  renderActorScatter(money.rows, people.rows);
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
    document.querySelectorAll("[id$='-chart'], .rank-list, .theme-grid, .sankey-stage, .document-donut").forEach((element) => { element.innerHTML = `<p class="data-empty">データを読み込めませんでした</p>`; });
  }
  setText("#footer-year", String(new Date().getFullYear()));
}

load();
