const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
const numberFormat = new Intl.NumberFormat("ja-JP");
const d3 = window.d3;

function setText(selector, value) { const element = $(selector); if (element) element.textContent = value; }
function formatNumber(value) { return value === null || value === undefined ? "—" : numberFormat.format(value); }
function formatYen(millionYen) {
  if (millionYen === null || millionYen === undefined) return "—";
  if (millionYen >= 1000000) return `${(millionYen / 1000000).toFixed(1)}兆円`;
  return `${formatNumber(Math.round(millionYen / 100))}億円`;
}
function shortMonth(month) { return `${month.slice(2, 4)}/${month.slice(5)}`; }
function emptyChart(selector, message) { const element = $(selector); if (element) element.innerHTML = `<p class="data-empty">${escapeHtml(message)}</p>`; }

function renderActivityCalendar(policy) {
  const element = $("#activity-calendar");
  const grid = policy.activity_grid?.length ? policy.activity_grid : (policy.monthly_activity || []).map((row) => ({ year: row.month.slice(0, 4), month: row.month.slice(5), count: row.count }));
  if (!element || !grid.length || !d3) { emptyChart("#activity-calendar", "活動データがありません"); return; }
  const years = [...new Set(grid.map((row) => row.year))].sort();
  const monthLabels = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];
  const max = Math.max(...grid.map((row) => Number(row.count || 0)), 1);
  const width = 770; const left = 66; const cellWidth = 50; const rowHeight = 42; const height = years.length * rowHeight + 67;
  const svg = d3.select(element).html("").append("svg").attr("class", "calendar-svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img").attr("aria-label", "年と月ごとの公式更新件数");
  svg.append("g").selectAll("text").data(monthLabels).join("text").attr("class", "calendar-month").attr("x", (_, index) => left + index * cellWidth + 18).attr("y", 17).attr("text-anchor", "middle").text((month) => `${month}月`);
  const cells = svg.append("g").selectAll("g").data(grid).join("g").attr("class", "calendar-cell-group");
  cells.append("rect").attr("class", "calendar-cell").attr("data-level", (row) => row.count ? Math.min(3, Math.ceil((row.count / max) * 3)) : 0).attr("x", (row) => left + (Number(row.month) - 1) * cellWidth).attr("y", (row) => 28 + years.indexOf(row.year) * rowHeight).attr("width", cellWidth - 4).attr("height", 28).append("title").text((row) => `${row.year}年${Number(row.month)}月 / ${formatNumber(row.count)}件`);
  cells.append("text").attr("class", "calendar-label").attr("x", (row) => left + (Number(row.month) - 1) * cellWidth + 23).attr("y", (row) => 46 + years.indexOf(row.year) * rowHeight).attr("text-anchor", "middle").text((row) => row.count ? row.count : "");
  svg.append("g").selectAll("text").data(years).join("text").attr("class", "calendar-year").attr("x", 0).attr("y", (_, index) => 47 + index * rowHeight).text((year) => year);
  const detail = svg.append("text").attr("class", "calendar-label").attr("x", left).attr("y", height - 9).text("セルを選択すると月別件数を表示");
  cells.on("mouseenter focus", function(event, row) { d3.select(this).select("rect").classed("is-active", true); detail.text(`${row.year}年${Number(row.month)}月 / ${formatNumber(row.count)}件`); }).on("mouseleave", function() { d3.select(this).select("rect").classed("is-active", false); }).on("click", function(event, row) { cells.select("rect").classed("is-active", false); d3.select(this).select("rect").classed("is-active", true); detail.text(`${row.year}年${Number(row.month)}月 / ${formatNumber(row.count)}件`); });
  setText("#policy-period", `${policy.period?.from || "—"} — ${policy.period?.to || "—"}`);
}

function renderDocumentRoles(rows) {
  const element = $("#document-roles");
  if (!element || !rows?.length || !d3) { emptyChart("#document-roles", "文書の役割データがありません"); return; }
  const data = rows.map((row) => ({ label: row.label, count: Number(row.count || 0) }));
  const width = 480; const rowHeight = 34; const height = data.length * rowHeight + 15; const left = 112; const right = 45; const max = Math.max(...data.map((row) => row.count), 1);
  const svg = d3.select(element).html("").append("svg").attr("class", "matrix-svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img").attr("aria-label", "公式更新の文書の役割");
  const scale = d3.scaleLinear().domain([0, max]).range([0, width - left - right]);
  const groups = svg.append("g").selectAll("g").data(data).join("g").attr("class", "role-row").attr("transform", (_, index) => `translate(0,${index * rowHeight})`);
  groups.append("text").attr("x", 0).attr("y", 21).text((row) => row.label);
  groups.append("rect").attr("class", "role-bar").attr("x", left).attr("y", 8).attr("width", (row) => scale(row.count)).attr("height", 16).attr("rx", 1);
  groups.append("text").attr("class", "role-count").attr("x", width - right + 9).attr("y", 21).text((row) => `${formatNumber(row.count)}件`);
  const detail = svg.append("text").attr("class", "calendar-label").attr("x", 0).attr("y", height - 2).text("行を選択すると件数を確認");
  groups.on("mouseenter", function(event, row) { groups.classed("is-dim", true); d3.select(this).classed("is-dim", false).classed("is-active", true); detail.text(`${row.label} / ${formatNumber(row.count)}件`); }).on("mouseleave", function() { groups.classed("is-dim", false).classed("is-active", false); }).on("click", function(event, row) { groups.classed("is-dim", true); d3.select(this).classed("is-dim", false).classed("is-active", true); detail.text(`${row.label} / ${formatNumber(row.count)}件`); });
}

function renderPolicyMatrix(policy) {
  const element = $("#policy-matrix"); const rows = policy.category_counts || []; const columns = policy.document_type_counts || []; const values = policy.category_document_matrix || [];
  if (!element || !rows.length || !columns.length || !d3) { emptyChart("#policy-matrix", "対応表を作成できません"); return; }
  const cats = rows.slice(0, 7).map((row) => row.label); const roles = columns.slice(0, 7).map((row) => row.label);
  const lookup = new Map(values.map((row) => [`${row.category}|${row.document_type}`, Number(row.count || 0)]));
  const width = 560; const left = 112; const top = 87; const cellWidth = 58; const cellHeight = 31; const height = top + cats.length * cellHeight + 24;
  const svg = d3.select(element).html("").append("svg").attr("class", "matrix-svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img").attr("aria-label", "政策領域と文書の役割の対応表");
  svg.append("g").selectAll("text").data(roles).join("text").attr("class", "matrix-column").attr("x", (_, index) => left + index * cellWidth + 17).attr("y", 8).text((role) => role);
  svg.append("g").selectAll("text").data(cats).join("text").attr("class", "matrix-label").attr("x", 0).attr("y", (_, index) => top + index * cellHeight + 20).text((category) => category);
  const data = cats.flatMap((category) => roles.map((role) => ({ category, role, count: lookup.get(`${category}|${role}`) || 0 })));
  const cells = svg.append("g").selectAll("g").data(data).join("g").attr("class", "matrix-cell-group");
  cells.append("rect").attr("class", "matrix-cell").attr("data-count", (row) => row.count).attr("x", (row) => left + roles.indexOf(row.role) * cellWidth).attr("y", (row) => top + cats.indexOf(row.category) * cellHeight).attr("width", cellWidth - 3).attr("height", cellHeight - 3).append("title").text((row) => `${row.category} × ${row.role} / ${formatNumber(row.count)}件`);
  cells.append("text").attr("class", "matrix-count").attr("x", (row) => left + roles.indexOf(row.role) * cellWidth + 27).attr("y", (row) => top + cats.indexOf(row.category) * cellHeight + 19).attr("text-anchor", "middle").text((row) => row.count || "");
  const detail = svg.append("text").attr("class", "calendar-label").attr("x", 0).attr("y", height - 3).text("セルを選択すると対応を確認");
  cells.on("mouseenter", function(event, row) { cells.select("rect").classed("is-dim", (cell) => cell.category !== row.category && cell.role !== row.role); detail.text(`${row.category} × ${row.role} / ${formatNumber(row.count)}件`); }).on("mouseleave", function() { cells.select("rect").classed("is-dim", false); }).on("click", function(event, row) { cells.select("rect").classed("is-active", false); d3.select(this).select("rect").classed("is-active", true); detail.text(`${row.category} × ${row.role} / ${formatNumber(row.count)}件`); });
}

function renderMoneyScale(rows) {
  const element = $("#money-scale");
  if (!element || !rows?.length || !d3) { emptyChart("#money-scale", "研究費データがありません"); return; }
  const data = [...rows].map((row) => ({ ...row, value: Number(row.internal_research_expenditure_million_yen || 0), organizations: Number(row.organizations || 0) })).sort((a, b) => b.value - a.value);
  const width = 700; const left = 116; const right = 114; const rowHeight = 54; const height = data.length * rowHeight + 12; const max = Math.max(...data.map((row) => row.value), 1); const scale = d3.scaleLinear().domain([0, max]).range([0, width - left - right]);
  const svg = d3.select(element).html("").append("svg").attr("class", "money-svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img").attr("aria-label", "主体別の内部使用研究費");
  const groups = svg.append("g").selectAll("g").data(data).join("g").attr("class", "money-row").attr("transform", (_, index) => `translate(0,${index * rowHeight})`);
  groups.append("text").attr("class", "money-label").attr("x", 0).attr("y", 22).text((row) => row.name);
  groups.append("text").attr("class", "money-meta").attr("x", 0).attr("y", 38).text((row) => `${formatNumber(row.organizations)}組織`);
  groups.append("line").attr("class", "money-rule").attr("x1", left).attr("x2", width - right).attr("y1", 28).attr("y2", 28);
  groups.append("rect").attr("class", "money-bar").attr("x", left).attr("y", 20).attr("width", (row) => scale(row.value)).attr("height", 16);
  groups.append("text").attr("class", "money-value").attr("x", width - right + 9).attr("y", 33).text((row) => formatYen(row.value));
  groups.on("mouseenter", function() { groups.classed("is-dim", true); d3.select(this).classed("is-dim", false).classed("is-active", true); }).on("mouseleave", function() { groups.classed("is-dim", false).classed("is-active", false); });
}

function renderMoneyConnection(rows) {
  const element = $("#money-connection");
  if (!element || !rows?.length || !d3) { emptyChart("#money-connection", "外部接続データがありません"); return; }
  const data = [...rows].map((row) => ({ name: row.name, incoming: Number(row.incoming_research_funds_million_yen || 0), outgoing: Number(row.external_research_expenditure_million_yen || 0) }));
  const width = 650; const left = 160; const right = 160; const center = width / 2; const rowHeight = 56; const top = 35; const height = data.length * rowHeight + 72; const max = Math.max(...data.flatMap((row) => [row.incoming, row.outgoing]), 1); const scale = d3.scaleLinear().domain([0, max]).range([0, center - left - 18]);
  const svg = d3.select(element).html("").append("svg").attr("class", "connection-svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img").attr("aria-label", "主体別の受入研究費と外部支出研究費");
  svg.append("text").attr("class", "connection-legend").attr("x", left).attr("y", 15).text("受入研究費"); svg.append("text").attr("class", "connection-legend").attr("x", center + 18).attr("y", 15).text("外部支出研究費");
  svg.append("line").attr("class", "connection-zero").attr("x1", center).attr("x2", center).attr("y1", 26).attr("y2", height - 22);
  const groups = svg.append("g").selectAll("g").data(data).join("g").attr("class", "connection-row").attr("transform", (_, index) => `translate(0,${top + index * rowHeight})`);
  groups.append("rect").attr("class", "connection-bar-in").attr("x", (row) => center - scale(row.incoming)).attr("y", 9).attr("width", (row) => scale(row.incoming)).attr("height", 16);
  groups.append("rect").attr("class", "connection-bar-out").attr("x", center).attr("y", 9).attr("width", (row) => scale(row.outgoing)).attr("height", 16);
  groups.append("text").attr("class", "connection-label").attr("x", center).attr("y", 43).attr("text-anchor", "middle").text((row) => row.name);
  groups.append("text").attr("class", "connection-value").attr("x", (row) => center - scale(row.incoming) - 7).attr("y", 21).attr("text-anchor", "end").text((row) => formatYen(row.incoming));
  groups.append("text").attr("class", "connection-value").attr("x", (row) => center + scale(row.outgoing) + 7).attr("y", 21).text((row) => formatYen(row.outgoing));
}

function renderPeopleFlow(links) {
  const element = $("#people-flow"); const detail = $("#flow-detail");
  if (!element || !links?.length || !d3) { emptyChart("#people-flow", "研究者の移動データがありません"); return; }
  const sourceOrder = ["企業", "非営利団体", "公的機関", "大学等", "その他"]; const targetOrder = ["企業", "非営利団体", "公的機関", "大学等"];
  const sourceNames = sourceOrder.filter((name) => links.some((link) => link.source === name)); const targetNames = targetOrder.filter((name) => links.some((link) => link.target === name));
  const sourceTotals = Object.fromEntries(sourceNames.map((name) => [name, d3.sum(links.filter((link) => link.source === name), (link) => Number(link.value || 0))])); const targetTotals = Object.fromEntries(targetNames.map((name) => [name, d3.sum(links.filter((link) => link.target === name), (link) => Number(link.value || 0))]));
  const width = 820; const height = 430; const nodeWidth = 13; const sourceX = 84; const targetX = 723; const max = Math.max(...Object.values(sourceTotals), ...Object.values(targetTotals), 1); const unit = Math.min(115 / max, 10 / Math.max(...Object.values(sourceTotals), 1));
  const layoutNodes = (names, totals, x) => { const heights = names.map((name) => Math.max(17, totals[name] * unit)); const gap = 23; const allHeight = d3.sum(heights) + gap * (names.length - 1); let y = Math.max(28, (height - allHeight) / 2); return Object.fromEntries(names.map((name, index) => { const node = { name, x, y, height: heights[index], total: totals[name] }; y += heights[index] + gap; return [name, node]; })); };
  const sourceNodes = layoutNodes(sourceNames, sourceTotals, sourceX); const targetNodes = layoutNodes(targetNames, targetTotals, targetX); const sourceCursor = Object.fromEntries(sourceNames.map((name) => [name, sourceNodes[name].y])); const targetCursor = Object.fromEntries(targetNames.map((name) => [name, targetNodes[name].y]));
  const svg = d3.select(element).html("").append("svg").attr("class", "people-svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img").attr("aria-label", "研究主体間の研究者の転入フロー");
  const pathData = links.map((link) => { const source = sourceNodes[link.source]; const target = targetNodes[link.target]; const thickness = Math.max(1.5, Number(link.value || 0) * unit); const sourceY = sourceCursor[link.source] + thickness / 2; const targetY = targetCursor[link.target] + thickness / 2; sourceCursor[link.source] += thickness; targetCursor[link.target] += thickness; return { ...link, source, target, thickness, sourceY, targetY }; });
  svg.append("g").selectAll("path").data(pathData).join("path").attr("class", "people-link").attr("d", (link) => `M${link.source.x + nodeWidth},${link.sourceY} C270,${link.sourceY} 536,${link.targetY} ${link.target.x},${link.targetY}`).attr("stroke-width", (link) => link.thickness).append("title").text((link) => `${link.source.name} → ${link.target.name} / ${formatNumber(link.value)}人`);
  const linkPaths = svg.selectAll(".people-link");
  const drawNodes = (nodes, kind) => { const groups = svg.append("g").selectAll("g").data(Object.values(nodes)).join("g").attr("class", `people-node ${kind}`).attr("data-name", (node) => node.name); groups.append("rect").attr("x", (node) => node.x).attr("y", (node) => node.y).attr("width", nodeWidth).attr("height", (node) => node.height); groups.append("text").attr("x", (node) => kind === "source" ? node.x - 10 : node.x + nodeWidth + 10).attr("y", (node) => node.y + node.height / 2 - 1).attr("text-anchor", kind === "source" ? "end" : "start").text((node) => node.name); groups.append("text").attr("class", "people-value").attr("x", (node) => kind === "source" ? node.x - 10 : node.x + nodeWidth + 10).attr("y", (node) => node.y + node.height / 2 + 14).attr("text-anchor", kind === "source" ? "end" : "start").text((node) => `${formatNumber(node.total)}人`); return groups; };
  const sourceGroups = drawNodes(sourceNodes, "source"); const targetGroups = drawNodes(targetNodes, "target");
  const focusSource = (name) => { linkPaths.classed("is-dim", (link) => link.source.name !== name); svg.selectAll(".people-node").classed("is-dim", (node) => node.attr ? false : false); sourceGroups.classed("is-dim", (node) => node.name !== name); targetGroups.classed("is-dim", (node) => !links.some((link) => link.source === name && link.target === node.name)); setText("#flow-detail", `${name}からの転入先：${links.filter((link) => link.source === name).sort((a, b) => b.value - a.value).map((link) => `${link.target} ${formatNumber(link.value)}人`).join(" / ")}`); };
  const focusTarget = (name) => { linkPaths.classed("is-dim", (link) => link.target.name !== name); sourceGroups.classed("is-dim", (node) => !links.some((link) => link.target === name && link.source === node.name)); targetGroups.classed("is-dim", (node) => node.name !== name); setText("#flow-detail", `${name}への転入元：${links.filter((link) => link.target === name).sort((a, b) => b.value - a.value).map((link) => `${link.source} ${formatNumber(link.value)}人`).join(" / ")}`); };
  sourceGroups.on("mouseenter", (_, node) => focusSource(node.name)).on("click", (_, node) => focusSource(node.name)); targetGroups.on("mouseenter", (_, node) => focusTarget(node.name)).on("click", (_, node) => focusTarget(node.name)); linkPaths.on("mouseenter", (_, link) => { linkPaths.classed("is-dim", (candidate) => candidate !== link); setText("#flow-detail", `<strong>${escapeHtml(link.source.name)} → ${escapeHtml(link.target.name)}</strong> / ${formatNumber(link.value)}人`); }).on("mouseleave", () => resetPeopleFlow());
  function resetPeopleFlow() { linkPaths.classed("is-dim", false).classed("is-active", false); sourceGroups.classed("is-dim", false); targetGroups.classed("is-dim", false); setText("#flow-detail", "線または主体を選ぶと、経路の内訳が表示されます。"); }
  $("#flow-reset")?.addEventListener("click", resetPeopleFlow);
}

function renderPeopleBalance(rows) {
  const element = $("#people-balance");
  if (!element || !rows?.length || !d3) { emptyChart("#people-balance", "転入・転出データがありません"); return; }
  const data = rows.map((row) => ({ name: row.name, incoming: Number(row.incoming_researchers || 0), outgoing: Number(row.outgoing_researchers || 0) })); const width = 500; const height = data.length * 67 + 35; const center = 250; const left = 116; const scale = d3.scaleLinear().domain([0, Math.max(...data.flatMap((row) => [row.incoming, row.outgoing]), 1)]).range([0, 125]);
  const svg = d3.select(element).html("").append("svg").attr("class", "balance-svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img").attr("aria-label", "主体別の研究者の転入と転出");
  svg.append("text").attr("class", "balance-label").attr("x", 0).attr("y", 15).text("転入"); svg.append("text").attr("class", "balance-label").attr("x", width).attr("y", 15).attr("text-anchor", "end").text("転出");
  const groups = svg.append("g").selectAll("g").data(data).join("g").attr("transform", (_, index) => `translate(0,${30 + index * 67})`);
  groups.append("line").attr("class", "balance-rule").attr("x1", left).attr("x2", width - left).attr("y1", 18).attr("y2", 18); groups.append("line").attr("class", "balance-in").attr("x1", center).attr("x2", (row) => center - scale(row.incoming)).attr("y1", 18).attr("y2", 18); groups.append("line").attr("class", "balance-out").attr("x1", center).attr("x2", (row) => center + scale(row.outgoing)).attr("y1", 18).attr("y2", 18); groups.append("text").attr("class", "balance-label").attr("x", center).attr("y", 45).attr("text-anchor", "middle").text((row) => row.name); groups.append("text").attr("class", "balance-value").attr("x", (row) => center - scale(row.incoming) - 7).attr("y", 22).attr("text-anchor", "end").text((row) => formatNumber(row.incoming)); groups.append("text").attr("class", "balance-value").attr("x", (row) => center + scale(row.outgoing) + 7).attr("y", 22).text((row) => formatNumber(row.outgoing));
}

function renderSources(policy, reality) {
  setText("#source-policy-count", formatNumber(policy.item_count));
  const element = $("#source-list"); const sources = policy.source_counts || [];
  if (!element) return;
  element.innerHTML = sources.map((source) => `<div class="source-item"><strong>${escapeHtml(source.label)}</strong><span>${formatNumber(source.count)}件</span></div>`).join("");
  if (!element.innerHTML) element.innerHTML = `<p class="data-empty">取得元データがありません</p>`;
  const status = reality.money?.status === "ok" && reality.people?.status === "ok" ? "統計2表 / 取得済み" : "一部の統計が未取得";
  setText("#header-status", status);
}

function initChapterNav() {
  const sections = [...document.querySelectorAll("[data-section-link]")].map((link) => ({ link, section: document.getElementById(link.dataset.sectionLink) })).filter((item) => item.section);
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => entries.forEach((entry) => { if (entry.isIntersecting) { sections.forEach((item) => item.link.classList.toggle("is-active", item.section === entry.target)); } }), { rootMargin: "-25% 0px -65% 0px", threshold: 0 });
    sections.forEach((item) => observer.observe(item.section));
  }
  const update = () => { const max = document.documentElement.scrollHeight - window.innerHeight; const bar = $("#chapter-progress-bar"); if (bar) bar.style.width = `${max > 0 ? Math.min(100, (window.scrollY / max) * 100) : 0}%`; };
  window.addEventListener("scroll", update, { passive: true }); update();
}

function render(payload) {
  const policy = payload.policy || {}; const reality = payload.reality || {}; const money = reality.money || {}; const people = reality.people || {};
  setText("#hero-meta", `政策更新 ${formatNumber(policy.item_count)}件 / ${reality.survey_year || "—"}年統計`);
  setText("#footer-year", new Date().getFullYear());
  renderActivityCalendar(policy); renderDocumentRoles(policy.document_type_counts); renderPolicyMatrix(policy); renderMoneyScale(money.rows); renderMoneyConnection(money.rows); renderPeopleFlow(people.links); renderPeopleBalance(people.rows); renderSources(policy, reality); initChapterNav();
}

async function init() {
  try { const response = await fetch("data/analytics.json", { cache: "no-store" }); if (!response.ok) throw new Error(`HTTP ${response.status}`); render(await response.json()); }
  catch (error) { setText("#header-status", "データを取得できません"); setText("#hero-meta", "静的データの読み込みに失敗しました"); ["#activity-calendar", "#document-roles", "#policy-matrix", "#money-scale", "#money-connection", "#people-flow", "#people-balance"].forEach((selector) => emptyChart(selector, "データを取得できませんでした")); console.error(error); }
}

init();
