const d3 = window.d3;

const $ = (selector) => document.querySelector(selector);
const number = (value) => Number(value || 0).toLocaleString("ja-JP");
const yen = (millionYen) => `${Math.round(Number(millionYen || 0) / 100).toLocaleString("ja-JP")}億円`;
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
const safeUrl = (value) => { try { const url = new URL(String(value || ""), window.location.href); return ["http:", "https:"].includes(url.protocol) ? url.href : ""; } catch { return ""; } };
const setText = (selector, value) => { const element = $(selector); if (element) element.textContent = value; };
const formatDate = (value) => { if (!value) return "—"; const date = new Date(value); return Number.isNaN(date.getTime()) ? String(value).slice(0, 10) : new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date); };
const emptyChart = (selector, message) => { const element = $(selector); if (element) element.innerHTML = `<p class="data-empty">${escapeHtml(message)}</p>`; };

const THREADS = [
  { key: "l1", var: "--ai", centerY: 110, amp: 44, period: 260, phase: 0 },
  { key: "l2", var: "--bengara", centerY: 172, amp: 44, period: 300, phase: 1.1 },
  { key: "l3", var: "--yamabuki", centerY: 234, amp: 38, period: 340, phase: 2.4 },
];
const threadY = (thread, x) => thread.centerY + thread.amp * Math.sin((x / thread.period) * 2 * Math.PI + thread.phase);

function renderWeave() {
  const element = $("#opening-map");
  if (!element || !d3) return;
  const width = 1180;
  const height = 300;
  const style = getComputedStyle(document.documentElement);
  const svg = d3.select(element).html("").append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img").attr("aria-label", "審議・制度、予算・支援、発信・検証という3本の糸が交わり結び目をつくる図");
  const line = d3.line().x((point) => point[0]).y((point) => point[1]).curve(d3.curveBasis);
  svg.append("g").selectAll("path").data(THREADS).join("path")
    .attr("class", (thread) => `thread ${thread.key}`)
    .attr("stroke-width", 10)
    .attr("d", (thread) => line(d3.range(-20, width + 21, 8).map((x) => [x, threadY(thread, x)])));
  const knotX = [width * 0.24, width * 0.5, width * 0.76];
  const knots = knotX.map((x, index) => {
    const ys = THREADS.map((thread) => threadY(thread, x));
    const y = d3.mean(ys);
    return { x, y, number: index + 1 };
  });
  const knotGroups = svg.append("g").selectAll("g").data(knots).join("g").attr("transform", (knot) => `translate(${knot.x},${knot.y})`);
  knotGroups.append("circle").attr("class", "knot-ring").attr("r", 13);
  knotGroups.append("text").attr("class", "knot-number").attr("text-anchor", "middle").attr("y", 4).text((knot) => knot.number);
  svg.append("text").attr("class", "thread-label").attr("x", 4).attr("y", threadY(THREADS[0], -4) - 18).attr("fill", style.getPropertyValue("--ai")).text("審議・制度");
  svg.append("text").attr("class", "thread-label").attr("x", 4).attr("y", threadY(THREADS[1], -4) + 30).attr("fill", style.getPropertyValue("--bengara")).text("予算・支援");
  svg.append("text").attr("class", "thread-label").attr("x", 4).attr("y", threadY(THREADS[2], -4) + 34).attr("fill", style.getPropertyValue("--yamabuki")).text("発信・検証");
}

const systemNodes = [
  { id: "government", label: "政府・省庁", role: "RULES / PRIORITIES", x: 70, y: 70, width: 174, description: "政策の優先順位、制度、評価の枠組みをつくる。ここから会議・計画・予算というシグナルが発信される。" },
  { id: "funding", label: "公的資金", role: "RESOURCES", x: 320, y: 70, width: 174, description: "競争的資金、運営費、基金など。資金の形式によって、研究の時間軸や説明責任が変わる。" },
  { id: "universities", label: "大学・研究機関", role: "PLACES", x: 570, y: 70, width: 190, description: "研究、人材育成、設備の維持、組織運営を同時に担う。研究資金と基盤的経費の組み合わせで動く。" },
  { id: "companies", label: "企業", role: "PRIVATE R&D", x: 70, y: 285, width: 174, description: "自社研究、共同研究、委託研究、製品化を通じて科学技術の資源と成果に接続する。" },
  { id: "researchers", label: "研究者・学生", role: "PEOPLE", x: 320, y: 285, width: 174, description: "問いを立て、研究を行い、移動し、知識を共有する。キャリアと雇用の構造は研究の方向にも影響する。" },
  { id: "publishers", label: "出版社・社会", role: "KNOWLEDGE", x: 570, y: 285, width: 190, description: "論文、データ、特許、ソフトウェア、報道や教育を通じて、研究成果を流通させる。" },
  { id: "evaluation", label: "評価・選抜", role: "RECOGNITION", x: 195, y: 470, width: 190, description: "査読、採択、昇進、表彰、指標など。何が価値ある仕事として認識されるかを形づくる。" },
  { id: "society", label: "社会的課題", role: "DEMAND", x: 485, y: 470, width: 190, description: "健康、環境、安全、産業、地域などの課題。研究への期待と資源配分の根拠を与える。" },
];

const systemEdges = [
  ["government", "funding", "配分する"], ["government", "evaluation", "評価する"], ["government", "society", "応答する"],
  ["funding", "universities", "支える"], ["funding", "companies", "投資する"], ["funding", "researchers", "公募する"],
  ["universities", "researchers", "雇用・育成"], ["companies", "researchers", "雇用・共同研究"], ["researchers", "publishers", "成果を出す"],
  ["publishers", "evaluation", "可視化する"], ["evaluation", "funding", "選抜する"], ["society", "government", "要求する"],
];

function renderSystemMap() {
  const element = $("#system-map");
  if (!element || !d3) return;
  const width = 830;
  const height = 560;
  const byId = new Map(systemNodes.map((node) => [node.id, node]));
  const svg = d3.select(element).html("").append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img").attr("aria-label", "科学システムのプレイヤーと関係を示す概念図");
  const defs = svg.append("defs");
  defs.append("marker").attr("id", "arrow").attr("viewBox", "0 -5 10 10").attr("refX", 8).attr("refY", 0).attr("markerWidth", 6).attr("markerHeight", 6).attr("orient", "auto").append("path").attr("d", "M0,-4L10,0L0,4").style("fill", "var(--rule-strong)");
  const edgeData = systemEdges.map(([sourceId, targetId, label]) => ({ source: byId.get(sourceId), target: byId.get(targetId), label }));
  const center = (node) => ({ x: node.x + node.width / 2, y: node.y + 35 });
  const edgePath = (edge) => { const source = center(edge.source); const target = center(edge.target); const curve = Math.max(20, Math.abs(target.x - source.x) * .18); return `M${source.x},${source.y} C${source.x + (target.x > source.x ? curve : -curve)},${source.y} ${target.x - (target.x > source.x ? curve : -curve)},${target.y} ${target.x},${target.y}`; };
  const edges = svg.append("g").selectAll("g").data(edgeData).join("g");
  edges.append("path").attr("class", "system-edge").attr("d", edgePath).append("title").text((edge) => `${edge.source.label} → ${edge.target.label}：${edge.label}`);
  edges.append("text").attr("class", "system-edge-label").attr("x", (edge) => (center(edge.source).x + center(edge.target).x) / 2).attr("y", (edge) => (center(edge.source).y + center(edge.target).y) / 2 - 5).attr("text-anchor", "middle").text((edge) => edge.label);
  const nodes = svg.append("g").selectAll("g").data(systemNodes).join("g").attr("class", "system-node").attr("data-id", (node) => node.id).attr("tabindex", "0").attr("role", "button").attr("aria-label", (node) => `${node.label}：${node.role}`).attr("transform", (node) => `translate(${node.x},${node.y})`);
  nodes.append("rect").attr("width", (node) => node.width).attr("height", 70).attr("rx", 2);
  nodes.append("text").attr("class", "node-title").attr("x", (node) => node.width / 2).attr("y", 29).attr("text-anchor", "middle").text((node) => node.label);
  nodes.append("text").attr("class", "node-role").attr("x", (node) => node.width / 2).attr("y", 49).attr("text-anchor", "middle").text((node) => node.role);
  const detail = (node) => { setText("#system-detail h3", node.label); setText("#system-detail p:last-child", node.description); setText("#system-detail .detail-kicker", node.role); };
  const focus = (node) => { const connected = new Set(systemEdges.flatMap(([source, target]) => source === node.id ? [target] : target === node.id ? [source] : [])); nodes.classed("is-active", (candidate) => candidate.id === node.id).classed("is-dim", (candidate) => candidate.id !== node.id && !connected.has(candidate.id)); edges.classed("is-active", (edge) => edge.source.id === node.id || edge.target.id === node.id).classed("is-dim", (edge) => edge.source.id !== node.id && edge.target.id !== node.id); detail(node); };
  nodes.on("mouseenter", (_, node) => focus(node)).on("click", (_, node) => focus(node)).on("keydown", (event, node) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); focus(node); } });
}

function renderSignals(items) {
  const element = $("#signal-feed");
  if (!element) return;
  const sorted = [...(items || [])].filter((item) => safeUrl(item.url)).sort((a, b) => new Date(b.published_at || 0) - new Date(a.published_at || 0)).slice(0, 9);
  if (!sorted.length) { element.innerHTML = `<p class="data-empty">公式更新がありません。</p>`; return; }
  element.innerHTML = sorted.map((item, index) => `<a class="signal-item" href="${escapeHtml(safeUrl(item.url))}" target="_blank" rel="noopener noreferrer"><span class="signal-knot-no" aria-hidden="true">${index < 3 ? index + 1 : ""}</span><time class="signal-date" datetime="${escapeHtml(item.published_at || "")}">${formatDate(item.published_at)}</time><span class="signal-body"><span class="signal-tags"><span>${escapeHtml(item.category || "未分類")}</span><span>${escapeHtml(item.document_type || "文書")}</span></span><h3>${escapeHtml(item.title)}</h3><span class="signal-source">${escapeHtml(item.source || "政府公式")}</span></span><span class="signal-arrow" aria-hidden="true">↗</span></a>`).join("");
}

function renderPolicyPulse(monthly) {
  const element = $("#policy-pulse");
  if (!element || !d3 || !monthly?.length) { emptyChart("#policy-pulse", "更新データがありません"); return; }
  const data = monthly.map((row) => ({ ...row, date: d3.timeParse("%Y-%m")(row.month), count: Number(row.count || 0) })).filter((row) => row.date);
  const width = 560; const height = 210; const margin = { top: 22, right: 14, bottom: 34, left: 28 };
  const svg = d3.select(element).html("").append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img").attr("aria-label", "公式更新の月別件数");
  const x = d3.scaleTime().domain(d3.extent(data, (row) => row.date)).range([margin.left, width - margin.right]);
  const y = d3.scaleLinear().domain([0, Math.max(1, d3.max(data, (row) => row.count))]).nice().range([height - margin.bottom, margin.top]);
  svg.append("g").attr("class", "chart-grid").attr("transform", `translate(0,${height - margin.bottom})`).call(d3.axisBottom(x).ticks(Math.min(5, data.length)).tickSize(-(height - margin.top - margin.bottom)).tickFormat("")).selectAll("path").remove();
  svg.append("g").attr("class", "chart-axis").attr("transform", `translate(${margin.left},0)`).call(d3.axisLeft(y).ticks(3).tickSize(0)).call((axis) => axis.select(".domain").remove());
  const line = d3.line().x((row) => x(row.date)).y((row) => y(row.count)).curve(d3.curveMonotoneX);
  const area = d3.area().x((row) => x(row.date)).y0(y(0)).y1((row) => y(row.count)).curve(d3.curveMonotoneX);
  svg.append("path").datum(data).attr("class", "pulse-area").attr("d", area); svg.append("path").datum(data).attr("class", "pulse-line").attr("d", line);
  const focus = svg.append("g").style("display", "none"); focus.append("line").attr("class", "pulse-focus").attr("y1", margin.top).attr("y2", height - margin.bottom); focus.append("text").attr("class", "pulse-readout").attr("y", margin.top - 6);
  const dots = svg.append("g").selectAll("circle").data(data).join("circle").attr("class", "pulse-dot").attr("cx", (row) => x(row.date)).attr("cy", (row) => y(row.count)).attr("r", 4).append("title").text((row) => `${row.month} / ${row.count}件`);
  svg.selectAll(".pulse-dot").on("mouseenter", function(event, row) { focus.style("display", null); focus.select("line").attr("x1", x(row.date)).attr("x2", x(row.date)); focus.select("text").attr("x", Math.min(width - 92, x(row.date) + 8)).text(`${row.month} / ${row.count}件`); d3.select(this).classed("is-active", true); }).on("mouseleave", function() { focus.style("display", "none"); d3.select(this).classed("is-active", false); });
}

function renderDocumentRoles(rows) {
  const element = $("#document-roles");
  if (!element || !d3 || !rows?.length) { emptyChart("#document-roles", "文書の役割データがありません"); return; }
  const data = rows.map((row) => ({ label: row.label, count: Number(row.count || 0) })); const width = 560; const rowHeight = 29; const height = data.length * rowHeight + 10; const left = 104; const right = 44; const scale = d3.scaleLinear().domain([0, d3.max(data, (row) => row.count) || 1]).range([0, width - left - right]);
  const svg = d3.select(element).html("").append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img").attr("aria-label", "公式更新の文書タイプ別件数");
  const groups = svg.append("g").selectAll("g").data(data).join("g").attr("class", "role-row").attr("transform", (_, index) => `translate(0,${index * rowHeight})`);
  groups.append("text").attr("x", 0).attr("y", 18).text((row) => row.label); groups.append("rect").attr("class", "role-bar").attr("x", left).attr("y", 5).attr("width", (row) => scale(row.count)).attr("height", 14); groups.append("text").attr("class", "role-count").attr("x", width - right + 8).attr("y", 18).text((row) => `${number(row.count)}件`);
  groups.on("mouseenter", function() { groups.classed("is-dim", true); d3.select(this).classed("is-dim", false).classed("is-active", true); }).on("mouseleave", () => groups.classed("is-dim", false).classed("is-active", false));
}

function renderExpenditure(rows) {
  const element = $("#expenditure-chart");
  if (!element || !d3 || !rows?.length) { emptyChart("#expenditure-chart", "研究費データがありません"); return; }
  const data = [...rows].map((row) => ({ name: row.name, value: Number(row.internal_research_expenditure_million_yen || 0), organizations: Number(row.organizations || 0) })).sort((a, b) => b.value - a.value);
  const width = 680; const rowHeight = 58; const height = data.length * rowHeight + 18; const left = 104; const right = 112; const scale = d3.scaleLinear().domain([0, d3.max(data, (row) => row.value) || 1]).range([0, width - left - right]);
  const svg = d3.select(element).html("").append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img").attr("aria-label", "研究主体別の内部使用研究費");
  const groups = svg.append("g").selectAll("g").data(data).join("g").attr("class", "money-row").attr("transform", (_, index) => `translate(0,${index * rowHeight})`);
  groups.append("text").attr("class", "money-label").attr("x", 0).attr("y", 23).text((row) => row.name); groups.append("text").attr("class", "money-axis").attr("x", 0).attr("y", 41).text((row) => `${number(row.organizations)}組織`); groups.append("line").attr("class", "money-rule").attr("x1", left).attr("x2", width - right).attr("y1", 29).attr("y2", 29); groups.append("rect").attr("class", "money-bar").attr("x", left).attr("y", 20).attr("width", (row) => scale(row.value)).attr("height", 17); groups.append("text").attr("class", "money-value").attr("x", width - right + 9).attr("y", 33).text((row) => yen(row.value));
  groups.on("mouseenter", function() { groups.classed("is-dim", true); d3.select(this).classed("is-dim", false).classed("is-active", true); }).on("mouseleave", () => groups.classed("is-dim", false).classed("is-active", false));
}

function renderPeopleFlow(links) {
  const element = $("#people-flow");
  if (!element || !d3 || !links?.length) { emptyChart("#people-flow", "研究者の移動データがありません"); return; }
  const sources = ["企業", "非営利団体", "公的機関", "大学等", "その他"].filter((name) => links.some((link) => link.source === name));
  const targets = ["企業", "非営利団体", "公的機関", "大学等"].filter((name) => links.some((link) => link.target === name));
  const sourceTotals = Object.fromEntries(sources.map((name) => [name, d3.sum(links.filter((link) => link.source === name), (link) => Number(link.value || 0))]));
  const targetTotals = Object.fromEntries(targets.map((name) => [name, d3.sum(links.filter((link) => link.target === name), (link) => Number(link.value || 0))]));
  const width = 820; const height = 420; const sourceX = 120; const targetX = 680; const nodeWidth = 12; const max = Math.max(...Object.values(sourceTotals), 1); const unit = Math.min(0.006, 130 / max);
  const layout = (names, totals, x) => { const heights = names.map((name) => Math.max(13, totals[name] * unit)); const gap = 25; const totalHeight = d3.sum(heights) + gap * (names.length - 1); let y = Math.max(16, (height - totalHeight) / 2); return Object.fromEntries(names.map((name, index) => { const node = { name, total: totals[name], x, y, height: heights[index] }; y += heights[index] + gap; return [name, node]; })); };
  const sourceNodes = layout(sources, sourceTotals, sourceX); const targetNodes = layout(targets, targetTotals, targetX); const sourceCursor = Object.fromEntries(sources.map((name) => [name, sourceNodes[name].y])); const targetCursor = Object.fromEntries(targets.map((name) => [name, targetNodes[name].y]));
  const pathData = links.filter((link) => sourceNodes[link.source] && targetNodes[link.target]).map((link) => { const source = sourceNodes[link.source]; const target = targetNodes[link.target]; const thickness = Math.max(1.2, Number(link.value || 0) * unit); const sourceY = sourceCursor[link.source] + thickness / 2; const targetY = targetCursor[link.target] + thickness / 2; sourceCursor[link.source] += thickness; targetCursor[link.target] += thickness; return { ...link, source, target, thickness, sourceY, targetY }; });
  const svg = d3.select(element).html("").append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img").attr("aria-label", "研究主体間の研究者の移動フロー");
  svg.append("text").attr("class", "people-label").attr("x", sourceX).attr("y", 14).attr("text-anchor", "middle").text("転入元"); svg.append("text").attr("class", "people-label").attr("x", targetX + nodeWidth).attr("y", 14).attr("text-anchor", "middle").text("転入先");
  const paths = svg.append("g").selectAll("path").data(pathData).join("path").attr("class", "people-link").attr("d", (link) => `M${link.source.x + nodeWidth},${link.sourceY} C330,${link.sourceY} 470,${link.targetY} ${link.target.x},${link.targetY}`).attr("stroke-width", (link) => link.thickness);
  paths.append("title").text((link) => `${link.source.name} → ${link.target.name} / ${number(link.value)}人`);
  const drawNodes = (nodeMap, kind) => { const groups = svg.append("g").selectAll("g").data(Object.values(nodeMap)).join("g").attr("class", `people-node ${kind}`).attr("tabindex", "0").attr("role", "button").attr("aria-label", (node) => `${node.name}：${number(node.total)}人`); groups.append("rect").attr("x", (node) => node.x).attr("y", (node) => node.y).attr("width", nodeWidth).attr("height", (node) => node.height); groups.append("text").attr("x", (node) => kind === "source" ? node.x - 10 : node.x + nodeWidth + 10).attr("y", (node) => node.y + node.height / 2 - 1).attr("text-anchor", kind === "source" ? "end" : "start").text((node) => node.name); groups.append("text").attr("class", "people-value").attr("x", (node) => kind === "source" ? node.x - 10 : node.x + nodeWidth + 10).attr("y", (node) => node.y + node.height / 2 + 14).attr("text-anchor", kind === "source" ? "end" : "start").text((node) => `${number(node.total)}人`); return groups; };
  const sourceGroups = drawNodes(sourceNodes, "source"); const targetGroups = drawNodes(targetNodes, "target");
  const reset = () => { paths.classed("is-dim", false).classed("is-active", false); sourceGroups.classed("is-dim", false); targetGroups.classed("is-dim", false); setText("#people-detail", "線または主体を選ぶと移動の内訳を表示します。"); };
  const focusSource = (name) => { paths.classed("is-dim", (link) => link.source.name !== name).classed("is-active", false); sourceGroups.classed("is-dim", (node) => node.name !== name); targetGroups.classed("is-dim", (node) => !pathData.some((link) => link.source.name === name && link.target.name === node.name)); const detail = pathData.filter((link) => link.source.name === name).sort((a, b) => b.value - a.value).map((link) => `${link.target.name} ${number(link.value)}人`).join(" / "); setText("#people-detail", `${name}からの転入先：${detail}`); };
  const focusTarget = (name) => { paths.classed("is-dim", (link) => link.target.name !== name).classed("is-active", false); sourceGroups.classed("is-dim", (node) => !pathData.some((link) => link.target.name === name && link.source.name === node.name)); targetGroups.classed("is-dim", (node) => node.name !== name); const detail = pathData.filter((link) => link.target.name === name).sort((a, b) => b.value - a.value).map((link) => `${link.source.name} ${number(link.value)}人`).join(" / "); setText("#people-detail", `${name}への転入元：${detail}`); };
  sourceGroups.on("mouseenter", (_, node) => focusSource(node.name)).on("click", (_, node) => focusSource(node.name)).on("keydown", (event, node) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); focusSource(node.name); } }); targetGroups.on("mouseenter", (_, node) => focusTarget(node.name)).on("click", (_, node) => focusTarget(node.name)).on("keydown", (event, node) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); focusTarget(node.name); } }); paths.on("mouseenter", (_, link) => { paths.classed("is-dim", (candidate) => candidate !== link).classed("is-active", (candidate) => candidate === link); setText("#people-detail", `${link.source.name} → ${link.target.name} / ${number(link.value)}人`); });
  $("#people-reset")?.addEventListener("click", reset);
}

function initRail() {
  const links = [...document.querySelectorAll("[data-section-link]")].map((link) => ({ link, section: document.getElementById(link.dataset.sectionLink) })).filter((item) => item.section);
  if ("IntersectionObserver" in window) { const observer = new IntersectionObserver((entries) => entries.forEach((entry) => { if (entry.isIntersecting) links.forEach((item) => item.link.classList.toggle("is-active", item.section === entry.target)); }), { rootMargin: "-24% 0px -65% 0px", threshold: 0 }); links.forEach((item) => observer.observe(item.section)); }
  const update = () => { const max = document.documentElement.scrollHeight - window.innerHeight; const progress = max > 0 ? Math.min(100, window.scrollY / max * 100) : 0; const bar = $("#scroll-progress"); if (bar) bar.style.setProperty("--progress", `${progress}%`); if (bar) bar.style.background = `linear-gradient(to right, var(--bengara) ${progress}%, var(--rule) ${progress}%)`; };
  window.addEventListener("scroll", update, { passive: true }); update();
}

function render(payload, updates) {
  const policy = payload.policy || {}; const reality = payload.reality || {}; const money = reality.money || {}; const people = reality.people || {};
  setText("#header-status", `${number(policy.item_count)}件の公式更新 / ${reality.survey_year || "—"}年統計`); setText("#opening-meta", `更新 ${formatDate(payload.generated_at)} / 統計 ${reality.survey_year || "—"}`); setText("#footer-year", new Date().getFullYear());
  renderWeave(); renderSignals(updates.items); renderPolicyPulse(policy.monthly_activity); renderDocumentRoles(policy.document_type_counts); renderSystemMap(); renderExpenditure(money.rows); renderPeopleFlow(people.links); initRail();
}

async function init() {
  try { const [analyticsResponse, updatesResponse] = await Promise.all([fetch("data/analytics.json", { cache: "no-store" }), fetch("data/updates.json", { cache: "no-store" })]); if (!analyticsResponse.ok || !updatesResponse.ok) throw new Error(`HTTP ${analyticsResponse.status}/${updatesResponse.status}`); render(await analyticsResponse.json(), await updatesResponse.json()); }
  catch (error) { setText("#header-status", "データを取得できません"); setText("#opening-meta", "静的データの読み込みに失敗しました"); ["#opening-map", "#policy-pulse", "#document-roles", "#system-map", "#expenditure-chart", "#people-flow"].forEach((selector) => emptyChart(selector, "データを取得できませんでした")); console.error(error); }
}

init();
