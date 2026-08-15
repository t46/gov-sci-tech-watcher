/* SCIENCE SIGNAL / MONEY — 研究開発資金の観測ページ。obs-core.js の後に読み込む。 */
"use strict";

const choFromMillion = (v) => `${(v / 1e6).toFixed(v >= 1e6 ? 1 : 2)}兆円`;
const okuFromMillion = (v) => `${fmtInt(Math.round(v / 100))}億円`;
const okuFromThousand = (v) => `${fmtInt(Math.round(v / 1e5))}億円`;
const choFromOku = (v) => `${(v / 1e4).toFixed(1)}兆円`;

function baseAxis(g) {
  g.select(".domain").remove();
  g.selectAll("line").attr("stroke", "#16202f").attr("stroke-dasharray", "2 4");
  return g;
}

/* 1つの章の描画失敗が他の章を巻き込まないようにする（章単位の隔離）。想定外のデータ
   形状に対する事前検証は各render関数側にあるが、それをすり抜けた実行時エラーでも
   後続のrender呼び出しが止まらないようにする最後の砦。 */
function safeCall(name, fn) {
  try {
    fn();
  } catch (error) {
    console.error(`[money] ${name} failed`, error);
  }
}

const hoverBox = (id) => {
  const node = $(id);
  return {
    show(html, event, mount) {
      if (!node) return;
      const bounds = mount.getBoundingClientRect();
      node.innerHTML = html;
      node.style.left = `${Math.min(event.clientX - bounds.left + 14, bounds.width - 190)}px`;
      node.style.top = `${event.clientY - bounds.top - 24}px`;
      node.classList.add("is-on");
    },
    hide() { node?.classList.remove("is-on"); },
  };
};

/* ============================================================ 00 flow hero */

function initFlowHero(indicators) {
  const canvas = $("#flow-canvas");
  const funding = indicators?.funding_flow;
  if (!canvas || !funding || funding.status !== "ok") {
    if (canvas) canvas.closest(".flow-stage").innerHTML = '<p class="data-empty" style="padding:30px">資金フローのデータを取得できませんでした。</p>';
    return;
  }
  const links = (funding.links || []).filter((l) => l.value > 0);
  const sourceNames = ["企業", "政府", "大学", "非営利団体", "外国"];
  const targetNames = ["企業", "公的機関", "大学", "非営利団体"];
  const sectorColor = { "企業": "#a7b4cc", "政府": "#4fd8ff", "大学": "#ffb545", "非営利団体": "#8d7fb0", "公的機関": "#5ad8a1", "外国": "#c9a76a" };
  const PER_PARTICLE = 25000;

  let geom = null;
  let focus = null;
  let running = true;
  const particles = [];

  function layout() {
    const { ctx, width, height } = fitCanvas(canvas);
    const pad = { top: 46, bottom: 46 };
    const leftX = width * (MOBILE ? 0.1 : 0.16);
    const rightX = width * (MOBILE ? 0.9 : 0.84);
    const outTotals = sourceNames.map((name) => d3.sum(links.filter((l) => l.source === name), (l) => l.value));
    const inTotals = targetNames.map((name) => d3.sum(links.filter((l) => l.target === name), (l) => l.value));
    const scale = (height - pad.top - pad.bottom - 24 * sourceNames.length) / Math.max(d3.sum(outTotals), d3.sum(inTotals));
    const place = (names, totals, x) => {
      let cursor = pad.top;
      return names.map((name, i) => {
        const h = Math.max(10, totals[i] * scale);
        const node = { name, x, y0: cursor, y1: cursor + h, total: totals[i] };
        cursor += h + 24;
        return node;
      });
    };
    const sources = place(sourceNames, outTotals, leftX);
    const targets = place(targetNames, inTotals, rightX);
    const sOffset = {}, tOffset = {};
    const linkGeo = links.map((l) => {
      const s = sources.find((n) => n.name === l.source);
      const t = targets.find((n) => n.name === l.target);
      const sh = (l.value / s.total) * (s.y1 - s.y0);
      const th = (l.value / t.total) * (t.y1 - t.y0);
      const sy = s.y0 + (sOffset[l.source] = (sOffset[l.source] || 0)) + sh / 2;
      sOffset[l.source] += sh;
      const ty = t.y0 + (tOffset[l.target] = (tOffset[l.target] || 0)) + th / 2;
      tOffset[l.target] += th;
      return { ...l, x0: s.x + 6, y0: sy, x1: t.x - 6, y1: ty, width: Math.max(0.6, sh * 0.9) };
    });
    geom = { ctx, width, height, sources, targets, linkGeo };
    particles.length = 0;
    if (!REDUCED) {
      for (const link of linkGeo) {
        const n = Math.max(1, Math.round(link.value / PER_PARTICLE));
        for (let i = 0; i < Math.min(n, 320); i += 1) {
          particles.push({ link, t: Math.random(), speed: 0.0016 + Math.random() * 0.0022, size: 0.8 + Math.random() * 1.4 });
        }
      }
    }
  }

  const bezier = (link, t) => {
    const cx1 = link.x0 + (link.x1 - link.x0) * 0.42, cx2 = link.x0 + (link.x1 - link.x0) * 0.58;
    const u = 1 - t;
    return [
      u * u * u * link.x0 + 3 * u * u * t * cx1 + 3 * u * t * t * cx2 + t * t * t * link.x1,
      u * u * u * link.y0 + 3 * u * u * t * link.y0 + 3 * u * t * t * link.y1 + t * t * t * link.y1,
    ];
  };

  function drawBase() {
    const { ctx, sources, targets, linkGeo } = geom;
    for (const link of linkGeo) {
      const active = !focus || link.source === focus || link.target === focus;
      ctx.beginPath();
      const cx1 = link.x0 + (link.x1 - link.x0) * 0.42, cx2 = link.x0 + (link.x1 - link.x0) * 0.58;
      ctx.moveTo(link.x0, link.y0);
      ctx.bezierCurveTo(cx1, link.y0, cx2, link.y1, link.x1, link.y1);
      ctx.strokeStyle = active ? "rgba(110,145,195,0.11)" : "rgba(110,145,195,0.04)";
      ctx.lineWidth = link.width;
      ctx.stroke();
    }
    ctx.font = '500 12px "IBM Plex Mono", monospace';
    for (const node of [...sources, ...targets]) {
      const active = !focus || node.name === focus;
      ctx.fillStyle = sectorColor[node.name];
      ctx.globalAlpha = active ? 1 : 0.3;
      const isSource = node.x < geom.width / 2;
      ctx.fillRect(node.x - (isSource ? 4 : 0), node.y0, 4, node.y1 - node.y0);
      ctx.fillStyle = active ? "#e9eef7" : "#4c5a72";
      ctx.textAlign = isSource ? "right" : "left";
      ctx.fillText(node.name, node.x + (isSource ? -12 : 12), (node.y0 + node.y1) / 2 + 4);
      ctx.fillStyle = "#8b96ab";
      ctx.font = '400 10px "IBM Plex Mono", monospace';
      ctx.fillText(choFromMillion(node.total), node.x + (isSource ? -12 : 12), (node.y0 + node.y1) / 2 + 19);
      ctx.font = '500 12px "IBM Plex Mono", monospace';
      ctx.globalAlpha = 1;
    }
    ctx.textAlign = "left";
    ctx.fillStyle = "#4c5a72";
    ctx.font = '500 10px "IBM Plex Mono", monospace';
    ctx.fillText("負担部門", geom.width * 0.05, 26);
    ctx.textAlign = "right";
    ctx.fillText("使用部門", geom.width * 0.95, 26);
    ctx.textAlign = "left";
  }

  function frame() {
    if (!running || !geom) return;
    const { ctx, width, height } = geom;
    ctx.clearRect(0, 0, width, height);
    drawBase();
    ctx.globalCompositeOperation = "lighter";
    for (const p of particles) {
      p.t += p.speed;
      if (p.t > 1) p.t = 0;
      const [px, py] = bezier(p.link, p.t);
      const active = !focus || p.link.source === focus || p.link.target === focus;
      ctx.globalAlpha = active ? 0.75 : 0.08;
      ctx.fillStyle = sectorColor[p.link.source];
      ctx.fillRect(px, py, p.size, p.size);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    requestAnimationFrame(frame);
  }

  function setFocus(name) {
    focus = name;
    const detail = $("#flow-detail");
    if (!detail) return;
    if (!name) { detail.innerHTML = "セクターに触れると、流れの内訳を表示"; return; }
    const outbound = links.filter((l) => l.source === name).sort((a, b) => b.value - a.value);
    const inbound = links.filter((l) => l.target === name).sort((a, b) => b.value - a.value);
    const top = (list, dir) => list.slice(0, 2).map((l) => `${dir === "out" ? l.target : l.source} ${choFromMillion(l.value)}`).join(" / ");
    detail.innerHTML = `<b>${escapeHtml(name)}</b> — 支出先: ${escapeHtml(top(outbound, "out") || "—")}<br>受入元: ${escapeHtml(top(inbound, "in") || "—")}`;
  }

  canvas.addEventListener("pointermove", (event) => {
    if (!geom) return;
    const rect = canvas.getBoundingClientRect();
    const mx = event.clientX - rect.left, my = event.clientY - rect.top;
    const hit = [...geom.sources, ...geom.targets].find((n) => Math.abs(mx - n.x) < 60 && my >= n.y0 - 6 && my <= n.y1 + 6);
    setFocus(hit ? hit.name : null);
    if (REDUCED) { const { ctx, width, height } = geom; ctx.clearRect(0, 0, width, height); drawBase(); }
  });
  canvas.addEventListener("pointerleave", () => {
    setFocus(null);
    if (REDUCED && geom) { const { ctx, width, height } = geom; ctx.clearRect(0, 0, width, height); drawBase(); }
  });

  layout();
  if (REDUCED) { drawBase(); } else {
    const observer = new IntersectionObserver((entries) => {
      const visible = entries[0]?.isIntersecting;
      if (visible && !running) { running = true; frame(); }
      else if (!visible) running = false;
    }, { threshold: 0.05 });
    observer.observe(canvas);
    frame();
  }
  window.addEventListener("resize", () => { layout(); if (REDUCED) drawBase(); }, { passive: true });

  const total = d3.sum(links, (l) => l.value);
  const gov = d3.sum(links.filter((l) => l.source === "政府"), (l) => l.value);
  if (total > 0) {
    setText("#flow-lede", `${funding.year_label}の研究開発費は${choFromMillion(total)}、うち政府負担は${choFromMillion(gov)}（全体の${fmtPct((gov / total) * 100)}）。負担部門から使用部門への流れを描く。粒子1つ＝250億円。`);
  }
  setText("#flow-source", `出典: ${funding.source?.title || ""}。${funding.note || ""}`);
}

/* ===================================================== 01 government stream */

function renderGovStream(indicators) {
  const mount = $("#gov-stream");
  const block = indicators?.gov_spending_dest;
  if (!mount || !block || block.status !== "ok") { if (mount) mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>'; return; }
  mount.innerHTML = "";
  const rows = block.rows;
  const keys = ["大学", "公的機関", "企業", "非営利団体"];
  const colors = { "大学": "#ffb545", "公的機関": "#5ad8a1", "企業": "#a7b4cc", "非営利団体": "#8d7fb0" };
  const width = mount.clientWidth || 1000, height = Math.max(360, Math.min(500, width * 0.42));
  const margin = { top: 26, right: 122, bottom: 34, left: 44 };
  const stack = d3.stack().keys(keys).value((row, key) => row[key] ?? 0);
  const series = stack(rows);
  const x = d3.scaleLinear().domain(d3.extent(rows, (r) => r.year)).range([margin.left, width - margin.right]);
  const y = d3.scaleLinear().domain([0, 100]).range([height - margin.bottom, margin.top]);
  const svg = d3.select(mount).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img")
    .attr("aria-label", "政府負担研究開発費の支出先部門別割合の推移");
  baseAxis(svg.append("g").attr("class", "axis").attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(5).tickFormat((v) => `${v}%`).tickSize(-(width - margin.left - margin.right))));
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).ticks(MOBILE ? 5 : 9).tickFormat(d3.format("d"))).select(".domain").attr("stroke", "#1c2839");
  const area = d3.area().x((d) => x(d.data.year)).y0((d) => y(d[0])).y1((d) => y(d[1])).curve(d3.curveMonotoneX);
  svg.append("g").selectAll("path").data(series).join("path")
    .attr("d", area).attr("fill", (d) => colors[d.key]).attr("opacity", 0.8)
    .attr("stroke", "#06090f").attr("stroke-width", 0.6);
  /* endpoint labels with first→last values */
  const first = rows[0], last = rows[rows.length - 1];
  for (const s of series) {
    const end = s[s.length - 1];
    svg.append("text").attr("x", x(last.year) + 8).attr("y", (y(end[0]) + y(end[1])) / 2 + 4)
      .attr("fill", colors[s.key]).attr("font-size", 11).attr("font-weight", 600)
      .text(`${s.key} ${fmtPct(last[s.key] ?? 0)}`);
  }
  const hover = hoverBox("#gov-hover");
  svg.on("pointermove", (event) => {
    const [mx, my] = d3.pointer(event);
    const year = Math.round(x.invert(mx));
    const row = rows.find((r) => r.year === year);
    if (!row) { hover.hide(); return; }
    const hit = series.find((s) => {
      const d = s.find((p) => p.data.year === year);
      return d && my >= y(d[1]) && my <= y(d[0]);
    });
    if (hit) hover.show(`<b>${escapeHtml(hit.key)}</b><br>${year}年度 ${fmtPct(row[hit.key] ?? 0)}`, event, mount);
    else hover.hide();
  }).on("pointerleave", () => hover.hide());
  setText("#gov-lede", `${first.year}年度、政府資金の${fmtPct(first["大学"])}は大学で使われていた。${last.year}年度は${fmtPct(last["大学"])}。企業へは${fmtPct(first["企業"])}→${fmtPct(last["企業"])}。`);
  setText("#gov-source", `出典: ${block.source?.title || ""}。${block.note || ""}`);
}

/* ======================================================= 02 ministry stream */

function renderMinistryStream(indicators) {
  const mount = $("#ministry-stream");
  const block = indicators?.ministry_budget;
  if (!mount || !block || block.status !== "ok") { if (mount) mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>'; return; }
  mount.innerHTML = "";
  const palette = {
    "文部科学省": "#ffb545", "科学技術庁": "#c98f3a", "文部省": "#a0722f",
    "経済産業省": "#4fd8ff", "通商産業省": "#3aa0bf",
    "厚生労働省": "#5ad8a1", "厚生省": "#48ab80",
    "防衛省": "#e0797a", "防衛庁": "#b3625f",
    "農林水産省": "#8faf6a", "内閣府": "#8d7fb0", "総務省": "#a7b4cc", "国土交通省": "#71809b", "環境省": "#6aa893",
    "その他": "#46536b",
  };
  const bySeries = Object.fromEntries(block.series.map((s) => [s.label, Object.fromEntries(s.values)]));
  const ranked = block.series
    .map((s) => ({ label: s.label, peak: d3.max(s.values, (v) => v[1]) || 0 }))
    .sort((a, b) => b.peak - a.peak);
  const main = ranked.slice(0, 10).map((r) => r.label);
  const years = [...new Set(block.series.flatMap((s) => s.values.map((v) => v[0])))].sort();
  const rows = years.map((year) => {
    const row = { year };
    let others = 0;
    for (const s of block.series) {
      const value = bySeries[s.label][year] ?? 0;
      if (main.includes(s.label)) row[s.label] = value;
      else others += value;
    }
    row["その他"] = others;
    return row;
  });
  const keys = [...main, "その他"];
  const width = mount.clientWidth || 1000, height = Math.max(380, Math.min(540, width * 0.46));
  const margin = { top: 26, right: 24, bottom: 34, left: 24 };
  const stack = d3.stack().keys(keys).value((row, key) => row[key] ?? 0).offset(d3.stackOffsetWiggle).order(d3.stackOrderInsideOut);
  const series = stack(rows);
  const x = d3.scaleLinear().domain(d3.extent(years)).range([margin.left, width - margin.right]);
  const y = d3.scaleLinear().domain([d3.min(series.flat(2)), d3.max(series.flat(2))]).range([height - margin.bottom, margin.top]);
  const svg = d3.select(mount).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img")
    .attr("aria-label", "府省庁別の科学技術関係予算（当初予算）の推移のストリームグラフ");
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).ticks(MOBILE ? 5 : 9).tickFormat(d3.format("d"))).select(".domain").remove();
  const area = d3.area().x((d) => x(d.data.year)).y0((d) => y(d[0])).y1((d) => y(d[1])).curve(d3.curveBasis);
  svg.append("g").selectAll("path").data(series).join("path")
    .attr("d", area).attr("fill", (d) => palette[d.key] || "#59687f").attr("opacity", 0.85)
    .attr("stroke", "#06090f").attr("stroke-width", 0.6);
  for (const s of series) {
    let best = null;
    for (const d of s) {
      const thickness = Math.abs(y(d[0]) - y(d[1]));
      if (!best || thickness > best.thickness) best = { d, thickness };
    }
    if (best && best.thickness > 16) {
      svg.append("text")
        .attr("x", x(best.d.data.year)).attr("y", (y(best.d[0]) + y(best.d[1])) / 2 + 3)
        .attr("text-anchor", "middle").attr("font-size", Math.min(12, 8 + best.thickness * 0.05))
        .attr("fill", "rgba(6,9,15,0.85)").attr("font-weight", 600).attr("pointer-events", "none")
        .text(s.key);
    }
  }
  const hover = hoverBox("#ministry-hover");
  svg.on("pointermove", (event) => {
    const [mx, my] = d3.pointer(event);
    const year = Math.round(x.invert(mx));
    const hit = series.find((s) => {
      const d = s.find((p) => p.data.year === year);
      return d && my >= y(d[1]) && my <= y(d[0]);
    });
    if (hit) {
      const row = rows.find((r) => r.year === year);
      hover.show(`<b>${escapeHtml(hit.key)}</b><br>${year}年度 ${okuFromMillion(row?.[hit.key] ?? 0)}`, event, mount);
    } else hover.hide();
  }).on("pointerleave", () => hover.hide());
  const lastRow = rows[rows.length - 1];
  const mext = lastRow["文部科学省"] ?? 0;
  const totalLast = d3.sum(keys, (k) => lastRow[k] ?? 0);
  setText("#ministry-lede", `${lastRow.year}年度の当初予算${choFromMillion(totalLast)}のうち、文部科学省が${choFromMillion(mext)}（${fmtPct((mext / totalLast) * 100)}）。2001年の省庁再編（科学技術庁＋文部省→文部科学省）が地層の継ぎ目として残る。`);
  setText("#ministry-source", `出典: ${block.source?.title || ""}。${block.note || ""}`);
}

/* ====================================================== 03 industry-academia */

function renderSangaku(indicators) {
  const mountA = $("#sangaku-line");
  const blockA = indicators?.industry_academia;
  if (mountA && blockA?.status === "ok") {
    mountA.innerHTML = "";
    const rows = blockA.rows;
    const keys = [{ key: "総額", color: "#ffb545", w: 2.6 }, { key: "国立大学", color: "#4fd8ff", w: 1.2 }, { key: "私立大学", color: "#8d7fb0", w: 1.2 }, { key: "公立大学", color: "#5ad8a1", w: 1.2 }];
    const width = mountA.clientWidth || 560, height = Math.max(330, width * 0.6);
    const margin = { top: 22, right: 96, bottom: 32, left: 52 };
    const x = d3.scaleLinear().domain(d3.extent(rows, (r) => r.year)).range([margin.left, width - margin.right]);
    const y = d3.scaleLinear().domain([0, d3.max(rows, (r) => r["総額"]) * 1.08]).range([height - margin.bottom, margin.top]);
    const svg = d3.select(mountA).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img")
      .attr("aria-label", "大学等が企業から受け入れた研究費の推移");
    baseAxis(svg.append("g").attr("class", "axis").attr("transform", `translate(${margin.left},0)`)
      .call(d3.axisLeft(y).ticks(5).tickFormat((v) => `${Math.round(v / 100)}億`).tickSize(-(width - margin.left - margin.right))));
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - margin.bottom})`)
      .call(d3.axisBottom(x).ticks(6).tickFormat(d3.format("d"))).select(".domain").attr("stroke", "#1c2839");
    const line = (key) => d3.line().x((r) => x(r.year)).y((r) => y(r[key] ?? 0)).curve(d3.curveMonotoneX)(rows.filter((r) => r[key] != null));
    for (const { key, color, w } of keys) {
      const path = svg.append("path").attr("d", line(key)).attr("fill", "none").attr("stroke", color).attr("stroke-width", w).attr("opacity", key === "総額" ? 1 : 0.75);
      if (key === "総額") path.attr("filter", "drop-shadow(0 0 6px rgba(255,181,69,0.5))");
      if (!REDUCED && gsap) {
        const length = path.node().getTotalLength();
        path.attr("stroke-dasharray", length).attr("stroke-dashoffset", length);
        gsap.to(path.node(), { strokeDashoffset: 0, duration: 1.8, ease: "power2.out", scrollTrigger: { trigger: mountA, start: "top 78%" } });
      }
      const last = rows[rows.length - 1];
      svg.append("text").attr("x", x(last.year) + 7).attr("y", y(last[key] ?? 0) + 4)
        .attr("fill", color).attr("font-size", key === "総額" ? 12 : 10).attr("font-weight", key === "総額" ? 600 : 400)
        .text(`${key} ${okuFromMillion(last[key] ?? 0)}`);
    }
    const first = rows[0], last = rows[rows.length - 1];
    setText("#sangaku-lede", `企業から大学等への研究費は${first.year}年度の${okuFromMillion(first["総額"])}から${last.year}年度の${okuFromMillion(last["総額"])}へ。それでも研究開発費全体22兆円の1%に満たない。`);
    setText("#sangaku-line-source", `出典: ${blockA.source?.title || ""}`);
  } else if (mountA) mountA.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>';

  const mountB = $("#sangaku-joint");
  const blockB = indicators?.joint_research;
  if (mountB && blockB?.status === "ok") {
    mountB.innerHTML = "";
    const colors = { "共同研究": "#ffb545", "受託研究": "#4fd8ff", "治験等": "#8d7fb0" };
    const seriesList = blockB.series.filter((s) => colors[s.label]);
    const width = mountB.clientWidth || 560, height = Math.max(330, width * 0.6);
    const margin = { top: 22, right: 128, bottom: 32, left: 52 };
    const allYears = seriesList.flatMap((s) => s.values.map((v) => v[0]));
    const x = d3.scaleLinear().domain(d3.extent(allYears)).range([margin.left, width - margin.right]);
    const y = d3.scaleLinear().domain([0, d3.max(seriesList.flatMap((s) => s.values.map((v) => v[1]))) * 1.08]).range([height - margin.bottom, margin.top]);
    const svg = d3.select(mountB).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img")
      .attr("aria-label", "共同研究・受託研究・治験等の受入額の推移");
    baseAxis(svg.append("g").attr("class", "axis").attr("transform", `translate(${margin.left},0)`)
      .call(d3.axisLeft(y).ticks(5).tickFormat((v) => `${Math.round(v / 1e5)}億`).tickSize(-(width - margin.left - margin.right))));
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - margin.bottom})`)
      .call(d3.axisBottom(x).ticks(6).tickFormat(d3.format("d"))).select(".domain").attr("stroke", "#1c2839");
    for (const s of seriesList) {
      const path = svg.append("path")
        .attr("d", d3.line().x((v) => x(v[0])).y((v) => y(v[1])).curve(d3.curveMonotoneX)(s.values))
        .attr("fill", "none").attr("stroke", colors[s.label]).attr("stroke-width", s.label === "共同研究" ? 2.4 : 1.3)
        .attr("opacity", s.label === "共同研究" ? 1 : 0.75);
      if (!REDUCED && gsap) {
        const length = path.node().getTotalLength();
        path.attr("stroke-dasharray", length).attr("stroke-dashoffset", length);
        gsap.to(path.node(), { strokeDashoffset: 0, duration: 1.8, ease: "power2.out", scrollTrigger: { trigger: mountB, start: "top 78%" } });
      }
      const last = s.values[s.values.length - 1];
      svg.append("text").attr("x", x(last[0]) + 7).attr("y", y(last[1]) + 4)
        .attr("fill", colors[s.label]).attr("font-size", s.label === "共同研究" ? 12 : 10).attr("font-weight", s.label === "共同研究" ? 600 : 400)
        .text(`${s.label} ${okuFromThousand(last[1])}`);
    }
    setText("#sangaku-joint-source", `出典: ${blockB.source?.title || ""}。${blockB.note || ""}`);
  } else if (mountB) mountB.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>';
}

/* ============================================================ 17 university startups */

function renderUniversityStartups(startups) {
  const block = startups;
  const trendMount = $("#startups-trend");
  const uniMount = $("#startups-universities");
  if (!block || block.status !== "ok") {
    [trendMount, uniMount].forEach((mount) => { if (mount) mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>'; });
    return;
  }
  const trend = block.trend || [];
  if (trendMount && trend.length) {
    const width = trendMount.clientWidth || 560, height = Math.max(300, width * 0.58);
    const margin = { top: 20, right: 22, bottom: 34, left: 52 };
    const svg = d3.select(trendMount).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img").attr("aria-label", "大学発ベンチャー数の推移");
    const x = d3.scaleLinear().domain(d3.extent(trend, (d) => d.year)).range([margin.left, width - margin.right]);
    const y = d3.scaleLinear().domain([0, d3.max(trend, (d) => d.count) * 1.12]).nice().range([height - margin.bottom, margin.top]);
    baseAxis(svg.append("g").attr("transform", `translate(0,${height - margin.bottom})`).call(d3.axisBottom(x).tickFormat(d3.format("d")).ticks(trend.length)));
    baseAxis(svg.append("g").attr("transform", `translate(${margin.left},0)`).call(d3.axisLeft(y).ticks(4).tickFormat((d) => `${d3.format(",")(d)}社`)));
    const line = d3.line().x((d) => x(d.year)).y((d) => y(d.count)).curve(d3.curveMonotoneX);
    svg.append("path").datum(trend).attr("fill", "none").attr("stroke", "#ffb545").attr("stroke-width", 3).attr("d", line);
    svg.selectAll(".startup-dot").data(trend).join("circle").attr("class", "startup-dot").attr("cx", (d) => x(d.year)).attr("cy", (d) => y(d.count)).attr("r", 4).attr("fill", "#ffb545").attr("stroke", "#06090f").attr("stroke-width", 2);
    svg.selectAll(".startup-label").data(trend).join("text").attr("class", "chart-value startup-label").attr("x", (d) => x(d.year)).attr("y", (d) => y(d.count) - 11).attr("text-anchor", "middle").text((d) => d3.format(",")(d.count));
    setText("#startups-trend-years", `${trend[0].year}–${trend.at(-1).year}`);
    setText("#startups-trend-source", `出典: ${block.source.title}。2025年度は${d3.format(",")(trend.at(-1).count)}社（前年比+${d3.format(",")(trend.at(-1).increase)}社）。${block.note}`);
  }
  if (uniMount && (block.universities || []).length) {
    const width = uniMount.clientWidth || 560, height = Math.max(360, width * 0.72);
    const margin = { top: 12, right: 44, bottom: 26, left: MOBILE ? 98 : 126 };
    const rows = block.universities.map((d) => ({ name: d.name, value: d.values.at(-1), previous: d.values.at(-2) })).sort((a, b) => b.value - a.value);
    const x = d3.scaleLinear().domain([0, d3.max(rows, (d) => d.value) * 1.15]).range([margin.left, width - margin.right]);
    const y = d3.scaleBand().domain(rows.map((d) => d.name)).range([margin.top, height - margin.bottom]).padding(0.28);
    const svg = d3.select(uniMount).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img").attr("aria-label", "大学別の大学発ベンチャー数");
    baseAxis(svg.append("g").attr("transform", `translate(0,${height - margin.bottom})`).call(d3.axisBottom(x).ticks(4).tickFormat((d) => `${d}社`)));
    svg.append("g").attr("transform", `translate(${margin.left},0)`).call(d3.axisLeft(y).tickSize(0)).select(".domain").remove();
    svg.selectAll(".startup-bar").data(rows).join("rect").attr("class", "startup-bar").attr("x", margin.left).attr("y", (d) => y(d.name)).attr("width", (d) => x(d.value) - margin.left).attr("height", y.bandwidth()).attr("rx", 2).attr("fill", (d, i) => i < 3 ? "#ffb545" : "#4fd8ff");
    svg.selectAll(".startup-rank-value").data(rows).join("text").attr("class", "chart-value startup-rank-value").attr("x", (d) => x(d.value) + 7).attr("y", (d) => y(d.name) + y.bandwidth() / 2 + 4).text((d) => d3.format(",")(d.value));
    setText("#startups-universities-source", `出典: ${block.source.title}。大学別の企業数は調査回答に基づき、複数大学との関連を重複計上し得る。`);
  }
}

/* ============================================================== 04 kakenhi */

function renderKakenhi(indicators, funders) {
  const mount = $("#kakenhi-chart");
  if (!mount) return;
  /* funders.json の複数年ブロックがあれば最新年度分を優先、無ければ従来の単年表示にフォールバック */
  let block = null;
  const yearsBlock = funders?.kakenhi_years;
  if (yearsBlock?.status === "ok" && Array.isArray(yearsBlock.reiwa_years) && yearsBlock.reiwa_years.length
    && yearsBlock.years_detail && typeof yearsBlock.years_detail === "object") {
    const latestReiwa = yearsBlock.reiwa_years[yearsBlock.reiwa_years.length - 1];
    const detail = yearsBlock.years_detail[`R${latestReiwa}`];
    if (detail && Array.isArray(detail.rows) && detail.rows.length && detail.rows.every((r) => r && typeof r.label === "string" && typeof r.amount === "number")) {
      block = {
        status: "ok", unit: yearsBlock.unit, year_label: detail.year_label,
        source: yearsBlock.source, note: yearsBlock.note,
        institution_count: detail.institution_count, total_amount: detail.total_amount,
        rows: detail.rows,
      };
    }
  }
  if (!block) block = indicators?.kakenhi;
  if (!block || block.status !== "ok" || !Array.isArray(block.rows) || !block.rows.length) {
    mount.innerHTML = '<p class="data-empty">科研費の機関別データは接続作業中。日本学術振興会の配分結果（機関別採択件数・配分額）を確認しだい、ここに機関別の配分を表示する。</p>';
    setText("#kakenhi-source", "出典（予定）: 日本学術振興会 科研費データ（機関別採択件数・配分額）");
    return;
  }
  mount.innerHTML = "";
  setText("#kakenhi-year-label", block.year_label || "");
  const shorten = (label) => label.replace(/^(国立研究開発法人|大学共同利用機関法人|独立行政法人|学校法人)/, "");
  const rows = (block.rows || []).slice(0, 25).map((r) => ({ ...r, label: shorten(r.label) }));
  const width = mount.clientWidth || 1000, height = Math.max(420, rows.length * 24 + 60);
  const margin = { top: 8, right: 110, bottom: 30, left: 210 };
  const x = d3.scaleLinear().domain([0, d3.max(rows, (r) => r.amount) * 1.05]).range([margin.left, width - margin.right]);
  const y = d3.scaleBand().domain(rows.map((r) => r.label)).range([margin.top, height - margin.bottom]).padding(0.3);
  const svg = d3.select(mount).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img")
    .attr("aria-label", "科研費の機関別配分額の上位機関");
  const bars = svg.append("g").selectAll("rect").data(rows).join("rect")
    .attr("x", x(0)).attr("y", (r) => y(r.label)).attr("height", y.bandwidth())
    .attr("width", (r) => x(r.amount) - x(0))
    .attr("fill", (r, i) => (i === 0 ? "#ffb545" : "#4fd8ff")).attr("opacity", (r, i) => (i === 0 ? 0.95 : 0.55));
  svg.append("g").selectAll("text.klabel").data(rows).join("text")
    .attr("x", margin.left - 8).attr("y", (r) => y(r.label) + y.bandwidth() / 2 + 4)
    .attr("text-anchor", "end").attr("font-size", 11).attr("fill", "#e9eef7")
    .text((r) => r.label);
  svg.append("g").selectAll("text.kvalue").data(rows).join("text")
    .attr("x", (r) => x(r.amount) + 6).attr("y", (r) => y(r.label) + y.bandwidth() / 2 + 4)
    .attr("font-size", 10).attr("fill", "#8b96ab")
    .text((r) => `${okuFromThousand(r.amount)}${r.count ? ` / ${fmtInt(r.count)}件` : ""}`);
  if (!REDUCED && gsap) {
    gsap.from(bars.nodes(), { attr: { width: 0 }, duration: 1.1, ease: "power3.out", stagger: 0.03, scrollTrigger: { trigger: mount, start: "top 80%" } });
  }
  const top10 = d3.sum((block.rows || []).slice(0, 10), (r) => r.amount);
  setText("#kakenhi-lede", `${block.year_label || ""}、${fmtInt(block.institution_count || 0)}機関に総額${okuFromThousand(block.total_amount || 0)}（新規＋継続）。上位10機関が全体の${fmtPct((top10 / (block.total_amount || 1)) * 100)}を占める。`);
  setText("#kakenhi-source", `出典: ${block.source?.title || ""}。${block.note || ""}`);
}

function renderKakenhiTrend(funders) {
  const mount = $("#kakenhi-trend");
  const block = funders?.kakenhi_years;
  if (!mount) return;
  const valid = block && block.status === "ok"
    && Array.isArray(block.reiwa_years) && block.reiwa_years.length >= 2
    && Array.isArray(block.calendar_years) && block.calendar_years.length === block.reiwa_years.length
    && Array.isArray(block.labels) && block.labels.length === block.reiwa_years.length
    && Array.isArray(block.top10_share)
    && Array.isArray(block.institutions) && block.institutions.length
    && block.institutions.every((inst) => inst && typeof inst.label === "string"
      && Array.isArray(inst.amounts) && inst.amounts.length === block.reiwa_years.length);
  if (!valid) {
    mount.innerHTML = '<p class="data-empty">科研費の機関別配分額の複数年データは接続作業中。令和4〜7年度分の機関別配分xlsxを確認しだい、上位機関の推移と機関集中度をここに表示する。</p>';
    setText("#kakenhi-trend-source", "出典（予定）: 日本学術振興会 科研費データ（機関別採択件数・配分額、複数年度）");
    return;
  }
  mount.innerHTML = "";
  const reiwaYears = block.reiwa_years;
  const calYears = block.calendar_years;
  const shorten = (label) => label.replace(/^(国立研究開発法人|大学共同利用機関法人|独立行政法人|学校法人)/, "");
  const institutions = block.institutions;
  const width = mount.clientWidth || 1000, height = Math.max(360, Math.min(460, width * 0.4));
  const margin = { top: 22, right: 132, bottom: 30, left: 60 };
  const x = d3.scalePoint().domain(calYears).range([margin.left, width - margin.right]).padding(0.6);
  const maxAmount = d3.max(institutions.flatMap((inst) => inst.amounts.filter((v) => v != null))) || 1;
  const y = d3.scaleLinear().domain([0, maxAmount * 1.08]).range([height - margin.bottom, margin.top]);
  const svg = d3.select(mount).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img")
    .attr("aria-label", "科研費機関別配分額の上位機関の推移（令和4〜7年度）");
  baseAxis(svg.append("g").attr("class", "axis").attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(5).tickFormat((v) => okuFromThousand(v)).tickSize(-(width - margin.left - margin.right))));
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).tickFormat((year) => `${year}年度`)).select(".domain").attr("stroke", "#1c2839");
  const palette = d3.quantize(d3.interpolateHcl("#ffb545", "#4fd8ff"), Math.max(2, institutions.length));
  institutions.forEach((inst, i) => {
    const pts = calYears.map((year, idx) => ({ year, value: inst.amounts[idx] })).filter((p) => p.value != null);
    if (pts.length < 2) return; /* 機関統廃合等で系列が途切れる場合は線を引かない */
    const line = d3.line().x((p) => x(p.year)).y((p) => y(p.value)).curve(d3.curveMonotoneX);
    const path = svg.append("path").attr("d", line(pts)).attr("fill", "none")
      .attr("stroke", palette[i]).attr("stroke-width", i === 0 ? 2.4 : 1.2).attr("opacity", i === 0 ? 1 : 0.7);
    if (!REDUCED && gsap) {
      const length = path.node().getTotalLength();
      path.attr("stroke-dasharray", length).attr("stroke-dashoffset", length);
      gsap.to(path.node(), { strokeDashoffset: 0, duration: 1.6, ease: "power2.out", stagger: 0.05, scrollTrigger: { trigger: mount, start: "top 78%" } });
    }
    const last = pts[pts.length - 1];
    svg.append("text").attr("x", x(last.year) + 8).attr("y", y(last.value) + 4)
      .attr("fill", palette[i]).attr("font-size", i === 0 ? 11 : 9.5).attr("font-weight", i === 0 ? 600 : 400)
      .text(shorten(inst.label));
  });
  const shareWrap = d3.select(mount).append("div").attr("class", "kakenhi-share-strip");
  shareWrap.append("p").attr("class", "kakenhi-share-title").text("上位10機関シェア（配分額ベース）");
  const shareRow = shareWrap.append("div").attr("class", "kakenhi-share-row");
  reiwaYears.forEach((reiwa, idx) => {
    const share = block.top10_share?.[idx];
    const item = shareRow.append("div").attr("class", "kakenhi-share-item");
    item.append("span").attr("class", "kakenhi-share-year").text(`令和${reiwa}年度`);
    item.append("div").attr("class", "kakenhi-share-bar")
      .append("i").style("width", share != null ? `${Math.min(100, share * 100).toFixed(1)}%` : "0%");
    item.append("span").attr("class", "kakenhi-share-value").text(share != null ? fmtPct(share * 100) : "—");
  });
  const firstShare = block.top10_share?.[0], lastShare = block.top10_share?.[block.top10_share.length - 1];
  const shareDrift = firstShare != null && lastShare != null
    ? `上位10機関シェアは${block.labels[0]}の${fmtPct(firstShare * 100)}から${block.labels[block.labels.length - 1]}の${fmtPct(lastShare * 100)}へ。`
    : "";
  setText("#kakenhi-trend-source", `出典: ${block.source?.title || ""}。${block.note || ""} ${shareDrift}`);
}

/* ==================================================== 04b corporate R&D */

function renderCorporateTrend(indicators) {
  const mount = $("#corporate-trend");
  const block = indicators?.corporate_rd;
  if (!mount || !block || block.status !== "ok" || !(block.rows || []).length) {
    if (mount) mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>';
    return;
  }
  mount.innerHTML = "";
  const rows = block.rows;
  setText("#corporate-trend-years", `${rows[0].year}–${rows[rows.length - 1].year}年度`);
  const width = mount.clientWidth || 1000, height = Math.max(360, width * 0.42);
  /* margin.topは右上に重ねる企業シェアの隅ドーナツ分だけ多めに確保する（末尾値ラベルとの重なりを避ける） */
  const margin = { top: 96, right: 92, bottom: 34, left: 60 };
  const x = d3.scaleLinear().domain(d3.extent(rows, (r) => r.year)).range([margin.left, width - margin.right]);
  const y = d3.scaleLinear().domain([0, d3.max(rows, (r) => r.value) * 1.08]).range([height - margin.bottom, margin.top]);
  const svg = d3.select(mount).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img")
    .attr("aria-label", "日本の企業部門研究開発費（名目）の長期推移");
  baseAxis(svg.append("g").attr("class", "axis").attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(5).tickFormat((v) => choFromMillion(v)).tickSize(-(width - margin.left - margin.right))));
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).ticks(8).tickFormat(d3.format("d"))).select(".domain").attr("stroke", "#1c2839");
  const line = d3.line().x((r) => x(r.year)).y((r) => y(r.value)).curve(d3.curveMonotoneX);
  const path = svg.append("path").attr("d", line(rows)).attr("fill", "none").attr("stroke", "#ffb545").attr("stroke-width", 2.4)
    .attr("filter", "drop-shadow(0 0 6px rgba(255,181,69,0.5))");
  if (!REDUCED && gsap) {
    const length = path.node().getTotalLength();
    path.attr("stroke-dasharray", length).attr("stroke-dashoffset", length);
    gsap.to(path.node(), { strokeDashoffset: 0, duration: 2, ease: "power2.out", scrollTrigger: { trigger: mount, start: "top 78%" } });
  }
  const last = rows[rows.length - 1];
  svg.append("text").attr("x", x(last.year) + 7).attr("y", y(last.value) + 4)
    .attr("fill", "#ffb545").attr("font-size", 12).attr("font-weight", 600).text(choFromMillion(last.value));

  /* 総研究開発費に占める企業部門の割合は、対GDP比などと重ねる第2軸ではなく、
     隅の小さなドーナツ（%表示のみ）として添える。 */
  const sharedRows = rows.filter((r) => r.share != null);
  const latestShare = sharedRows[sharedRows.length - 1];
  if (latestShare) {
    const R = 30, C = 2 * Math.PI * R;
    const offset = C * (1 - Math.min(100, Math.max(0, latestShare.share)) / 100);
    const donut = d3.select(mount).append("div").attr("class", "corner-donut");
    const dsvg = donut.append("svg").attr("viewBox", "0 0 72 72").attr("role", "img")
      .attr("aria-label", `総研究開発費に占める企業部門の割合 ${latestShare.share}%（${latestShare.year}年度）`);
    dsvg.append("circle").attr("cx", 36).attr("cy", 36).attr("r", R).attr("fill", "none").attr("stroke", "#1c2839").attr("stroke-width", 6);
    dsvg.append("circle").attr("cx", 36).attr("cy", 36).attr("r", R).attr("fill", "none").attr("stroke", "#ffb545").attr("stroke-width", 6)
      .attr("stroke-linecap", "round").attr("stroke-dasharray", C).attr("stroke-dashoffset", offset)
      .attr("transform", "rotate(-90 36 36)");
    dsvg.append("text").attr("class", "corner-donut-num").attr("x", 36).attr("y", 34).attr("text-anchor", "middle").text(latestShare.share.toFixed(1));
    dsvg.append("text").attr("class", "corner-donut-unit").attr("x", 36).attr("y", 45).attr("text-anchor", "middle").text("%");
    donut.append("p").attr("class", "corner-donut-caption").text(`企業シェア（${latestShare.year}）`);
    const firstShare = sharedRows[0];
    setText("#corporate-lede", `${last.year}年度、日本の研究開発費${choFromMillion(last.total ?? last.value)}のうち企業部門は${choFromMillion(last.value)}（${fmtPct(latestShare.share)}）。企業部門の割合は${firstShare.year}年度の${fmtPct(firstShare.share)}から${latestShare.year}年度の${fmtPct(latestShare.share)}まで拡大してきた。`);
  }
  setText("#corporate-trend-source", `出典: ${block.source?.title || ""}。${block.note || ""}`);
}

function renderCorporateIntl(indicators) {
  const mount = $("#corporate-intl");
  const block = indicators?.corporate_rd?.intl;
  if (!mount || !block || block.status !== "ok" || !(block.series || []).length) {
    if (mount) mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>';
    return;
  }
  mount.innerHTML = "";
  const data = seriesMap(block);
  const KEYS = ["jp", "us", "de", "fr", "gb", "cn", "kr"].filter((k) => data[k]?.length);
  if (!KEYS.length) { mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>'; return; }
  const width = mount.clientWidth || 1000, height = Math.max(360, width * 0.42);
  const margin = { top: 24, right: 84, bottom: 34, left: 48 };
  const allYears = KEYS.flatMap((k) => data[k].map(([y]) => y));
  const x = d3.scaleLinear().domain(d3.extent(allYears)).range([margin.left, width - margin.right]);
  const maxV = d3.max(KEYS.flatMap((k) => data[k].map(([, v]) => v)));
  const y = d3.scaleLinear().domain([0, maxV * 1.08]).range([height - margin.bottom, margin.top]);
  const svg = d3.select(mount).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img")
    .attr("aria-label", "主要国の企業部門研究開発費、対GDP比の推移");
  baseAxis(svg.append("g").attr("class", "axis").attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(5).tickFormat((v) => `${v}%`).tickSize(-(width - margin.left - margin.right))));
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).ticks(8).tickFormat(d3.format("d"))).select(".domain").attr("stroke", "#1c2839");
  const line = d3.line().x(([yr]) => x(yr)).y(([, v]) => y(v)).curve(d3.curveMonotoneX);
  const tips = KEYS.map((key) => ({ key, y: y(lastPoint(data[key])[1]) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < tips.length; i += 1) { if (tips[i].y - tips[i - 1].y < 13) tips[i].y = tips[i - 1].y + 13; }
  const tipY = Object.fromEntries(tips.map((t) => [t.key, t.y]));
  for (const key of KEYS) {
    const isJp = key === "jp";
    const path = svg.append("path").attr("d", line(data[key])).attr("fill", "none")
      .attr("stroke", COLORS[key] || "#8b96ab").attr("stroke-width", isJp ? 2.6 : 1.2).attr("opacity", isJp ? 1 : 0.65);
    if (isJp) path.attr("filter", "drop-shadow(0 0 6px rgba(255,181,69,0.55))");
    if (!REDUCED && gsap) {
      const length = path.node().getTotalLength();
      path.attr("stroke-dasharray", length).attr("stroke-dashoffset", length);
      gsap.to(path.node(), { strokeDashoffset: 0, duration: isJp ? 2.2 : 1.5, ease: "power2.out", scrollTrigger: { trigger: mount, start: "top 75%" } });
    }
    const tip = lastPoint(data[key]);
    svg.append("text").attr("x", x(tip[0]) + 7).attr("y", tipY[key] + 4)
      .attr("fill", isJp ? COLORS.jp : "#8b96ab").attr("font-size", isJp ? 12 : 10).attr("font-weight", isJp ? 600 : 400)
      .text(`${SHORT[key]} ${tip[1].toFixed(1)}%`);
  }
  setText("#corporate-intl-source", `出典: ${block.source?.title || ""}`);
}

function renderCorporateIndustries(indicators) {
  const mount = $("#corporate-industries");
  const block = indicators?.corporate_rd?.industries;
  if (!mount || !block || block.status !== "ok" || !(block.rows || []).length) {
    if (mount) mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>';
    return;
  }
  mount.innerHTML = "";
  setText("#corporate-industries-year", block.year_label || "");
  const rows = block.rows; /* 既に降順 */
  const width = mount.clientWidth || 1000, height = rows.length * 34 + 50;
  const margin = { top: 10, right: 92, bottom: 10, left: 200 };
  const x = d3.scaleLinear().domain([0, rows[0].value * 1.05]).range([margin.left, width - margin.right]);
  const y = d3.scaleBand().domain(rows.map((r) => r.label)).range([margin.top, height - margin.bottom]).padding(0.3);
  const svg = d3.select(mount).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img")
    .attr("aria-label", "企業部門研究開発費の産業分類別内訳、直近年度。輸送用機器製造業が最大。");
  const bars = svg.append("g").selectAll("rect").data(rows).join("rect")
    .attr("x", x(0)).attr("y", (r) => y(r.label)).attr("height", y.bandwidth())
    .attr("width", (r) => x(r.value) - x(0))
    .attr("fill", (r, i) => (i === 0 ? "#ffb545" : "#4fd8ff")).attr("opacity", (r, i) => (i === 0 ? 0.95 : 0.55));
  svg.append("g").selectAll("text.ilabel").data(rows).join("text")
    .attr("x", margin.left - 8).attr("y", (r) => y(r.label) + y.bandwidth() / 2 + 4)
    .attr("text-anchor", "end").attr("font-size", 11).attr("fill", "#e9eef7").text((r) => r.label);
  svg.append("g").selectAll("text.ivalue").data(rows).join("text")
    .attr("x", (r) => x(r.value) + 6).attr("y", (r) => y(r.label) + y.bandwidth() / 2 + 4)
    .attr("font-size", 10).attr("fill", "#8b96ab").text((r) => okuFromMillion(r.value));
  if (!REDUCED && gsap) {
    gsap.from(bars.nodes(), { attr: { width: 0 }, duration: 1, ease: "power3.out", stagger: 0.04, scrollTrigger: { trigger: mount, start: "top 80%" } });
  }
  const top = rows[0];
  const topShare = block.total ? (top.value / block.total) * 100 : null;
  setText("#corporate-industries-source", `出典: ${block.source?.title || ""}。${block.note || ""}${topShare != null ? ` ${top.label}が企業部門全体の${fmtPct(topShare)}を占める。` : ""}`);
}

function renderCorporateRd(indicators) {
  renderCorporateTrend(indicators);
  renderCorporateIntl(indicators);
  renderCorporateIndustries(indicators);
}

function renderStiMoney(sti) {
  const mount = $("#sti-money-chart");
  const rows = sti?.series?.rd_intensity?.years || [];
  if (!mount) return;
  if (!rows.length) { mount.innerHTML = '<p class="data-empty">NISTEPの研究開発費/GDP系列を取得できませんでした。</p>'; return; }
  const labels = { Japan: "日本", "United States": "米国", Germany: "ドイツ", France: "フランス", "United Kingdom": "英国", China: "中国", Korea: "韓国" };
  const colors = { Japan: "#ffb545", "United States": "#4fd8ff", Germany: "#8d7fb0", France: "#5ad8a1", "United Kingdom": "#c9a76a", China: "#ef6d78", Korea: "#a7b4cc" };
  const keys = Object.keys(labels); mount.innerHTML = "";
  const width = mount.clientWidth || 960, height = MOBILE ? 290 : 350, margin = { top: 42, right: 20, bottom: 42, left: 50 };
  const x = d3.scaleLinear().domain(d3.extent(rows, d => d.year)).range([margin.left, width - margin.right]);
  const y = d3.scaleLinear().domain([0, 6]).range([height - margin.bottom, margin.top]);
  const svg = d3.select(mount).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img").attr("aria-label", "主要国の研究開発費の対GDP比率の推移");
  baseAxis(svg.append("g").attr("class", "axis").attr("transform", `translate(${margin.left},0)`).call(d3.axisLeft(y).ticks(6).tickFormat(v => `${v}%`).tickSize(-(width - margin.left - margin.right))));
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - margin.bottom})`).call(d3.axisBottom(x).ticks(MOBILE ? 4 : 8).tickFormat(d3.format("d"))).select(".domain").attr("stroke", "#1c2839");
  const line = d3.line().defined(d => Number.isFinite(d.value)).x(d => x(d.year)).y(d => y(d.value));
  keys.forEach(key => { const points = rows.map(row => ({ year: row.year, value: row[key] })); svg.append("path").datum(points).attr("fill", "none").attr("stroke", colors[key]).attr("stroke-width", key === "Japan" ? 2.8 : 1.25).attr("opacity", key === "Japan" ? 1 : .78).attr("d", line); const last = points.filter(d => Number.isFinite(d.value)).at(-1); if (last && !MOBILE) svg.append("text").attr("class", "chart-value sti-end-label").attr("x", x(last.year) - 4).attr("y", y(last.value) - 7).attr("text-anchor", "end").attr("fill", colors[key]).text(`${labels[key]} ${last.value.toFixed(1)}%`); });
  const legend = svg.append("g").attr("class", "sti-legend").attr("transform", `translate(${margin.left},14)`); keys.forEach((key, i) => { const lx = (i % 4) * 142, ly = Math.floor(i / 4) * 15; legend.append("line").attr("x1", lx).attr("x2", lx + 15).attr("y1", ly).attr("y2", ly).attr("stroke", colors[key]).attr("stroke-width", key === "Japan" ? 2.5 : 1.4); legend.append("text").attr("x", lx + 21).attr("y", ly + 3).text(labels[key]).attr("fill", colors[key]); });
  const japan = rows.filter(d => Number.isFinite(d.Japan)); setText("#sti-money-years", `${japan[0].year}–${japan.at(-1).year}`); setText("#sti-money-lede", `日本の研究開発費/GDPは${japan[0].Japan.toFixed(1)}%（${japan[0].year}年）から${japan.at(-1).Japan.toFixed(1)}%（${japan.at(-1).year}年）へ。金額だけでなく、経済規模に対する研究開発の重さを見る。`); setText("#sti-money-source", `出典: ${sti.source.title} 表${sti.series.rd_intensity.table}。${sti.series.rd_intensity.unit}。${sti.method_note}`);
}

/* ====================================================== 05 support scatter */

function renderSupportScatter(indicators) {
  const mount = $("#support-scatter");
  const block = indicators?.gov_support_business;
  if (!mount || !block || block.status !== "ok") { if (mount) mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>'; return; }
  mount.innerHTML = "";
  const countries = block.countries || [];
  const japan = block.japan || [];
  const width = mount.clientWidth || 1000, height = Math.max(400, Math.min(540, width * 0.5));
  const margin = { top: 30, right: 40, bottom: 48, left: 56 };
  const x = d3.scaleLinear().domain([0, d3.max(countries, (c) => c.direct) * 1.1]).range([margin.left, width - margin.right]);
  const y = d3.scaleLinear().domain([0, d3.max(countries, (c) => c.indirect) * 1.1]).range([height - margin.bottom, margin.top]);
  const svg = d3.select(mount).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img")
    .attr("aria-label", "企業の研究開発への政府の直接支援と間接支援の国際比較の散布図");
  baseAxis(svg.append("g").attr("class", "axis").attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(5).tickFormat((v) => `${v}%`).tickSize(-(width - margin.left - margin.right))));
  baseAxis(svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).ticks(6).tickFormat((v) => `${v}%`).tickSize(-(height - margin.top - margin.bottom))));
  svg.append("text").attr("x", width - margin.right).attr("y", height - 12).attr("text-anchor", "end")
    .attr("font-size", 10).attr("fill", "#8b96ab").text("直接支援（政府負担の企業研究費・対GDP比）→");
  svg.append("text").attr("x", margin.left).attr("y", margin.top - 12)
    .attr("font-size", 10).attr("fill", "#8b96ab").text("↑ 間接支援（研究開発減税・対GDP比）");
  /* Japan trajectory 2000→latest */
  if (japan.length > 1) {
    const trail = svg.append("path")
      .attr("d", d3.line().x((p) => x(p.direct)).y((p) => y(p.indirect)).curve(d3.curveCatmullRom.alpha(0.6))(japan))
      .attr("fill", "none").attr("stroke", "#ffb545").attr("stroke-width", 1.4)
      .attr("stroke-dasharray", "1 4").attr("stroke-linecap", "round").attr("opacity", 0.8);
    if (!REDUCED && gsap) {
      const length = trail.node().getTotalLength();
      trail.attr("stroke-dasharray", `${length}`).attr("stroke-dashoffset", length);
      gsap.to(trail.node(), {
        strokeDashoffset: 0, duration: 2.4, ease: "power2.inOut",
        scrollTrigger: { trigger: mount, start: "top 75%" },
        onComplete: () => trail.attr("stroke-dasharray", "1 4").attr("stroke-dashoffset", 0),
      });
    }
    const start = japan[0];
    svg.append("text").attr("x", x(start.direct) + 6).attr("y", y(start.indirect) - 6)
      .attr("font-size", 9).attr("fill", "#8b96ab").text(`${start.year}`);
  }
  const isJapan = (c) => c.label.startsWith("日本");
  const dots = svg.append("g").selectAll("g").data(countries).join("g")
    .attr("transform", (c) => `translate(${x(c.direct)},${y(c.indirect)})`);
  dots.append("circle")
    .attr("r", (c) => (isJapan(c) ? 6 : 3.6))
    .attr("fill", (c) => (isJapan(c) ? "#ffb545" : "rgba(79,216,255,0.5)"))
    .attr("stroke", (c) => (isJapan(c) ? "#ffb545" : "#4fd8ff")).attr("stroke-width", (c) => (isJapan(c) ? 2 : 0.8));
  dots.append("title").text((c) => `${c.label} (${c.year}) 直接 ${c.direct}% / 間接 ${c.indirect}%`);
  const labelTargets = new Set(["日本", "米国", "韓国", "フランス", "英国", "ドイツ", "中国"]);
  dots.filter((c) => labelTargets.has(c.label.replace(/\(.*/, ""))).append("text")
    .attr("x", 8).attr("y", 4).attr("font-size", (c) => (isJapan(c) ? 12 : 10))
    .attr("font-weight", (c) => (isJapan(c) ? 600 : 400))
    .attr("fill", (c) => (isJapan(c) ? "#ffb545" : "#8b96ab"))
    .text((c) => c.label);
  const jp = countries.find(isJapan);
  if (jp) {
    setText("#support-lede", `日本（${jp.year}）は直接${jp.direct}%・間接${jp.indirect}%。点線は日本の${japan[0]?.year || 2000}年からの軌跡 — 直接支援を減らし、減税へ寄せてきた。`);
  }
  setText("#support-source", `出典: ${block.source?.title || ""}。${block.note || ""}`);
}

/* ============================================================ 06 plan bars */

function renderPlanBars(indicators) {
  const mount = $("#plan-bars");
  const block = indicators?.plan_budget;
  if (!mount || !block || block.status !== "ok") { if (mount) mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>'; return; }
  mount.innerHTML = "";
  const rows = block.rows;
  const width = mount.clientWidth || 1000, height = Math.max(380, Math.min(520, width * 0.44));
  const margin = { top: 40, right: 24, bottom: 36, left: 52 };
  const x = d3.scaleBand().domain(rows.map((r) => r.year)).range([margin.left, width - margin.right]).padding(0.25);
  const y = d3.scaleLinear().domain([0, d3.max(rows, (r) => (r.initial ?? 0) + (r.supplementary ?? 0)) * 1.08]).range([height - margin.bottom, margin.top]);
  const svg = d3.select(mount).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img")
    .attr("aria-label", "科学技術基本計画の期間ごとの当初予算と補正予算の推移");
  baseAxis(svg.append("g").attr("class", "axis").attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(5).tickFormat((v) => choFromOku(v)).tickSize(-(width - margin.left - margin.right))));
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).tickValues(rows.map((r) => r.year).filter((yr) => yr % 5 === 0)).tickFormat(d3.format("d"))).select(".domain").attr("stroke", "#1c2839");
  /* period bands */
  const periods = [...new Set(rows.map((r) => r.period))];
  for (const [index, period] of periods.entries()) {
    const inPeriod = rows.filter((r) => r.period === period);
    const x0 = x(inPeriod[0].year), x1 = x(inPeriod[inPeriod.length - 1].year) + x.bandwidth();
    if (index % 2 === 1) {
      svg.insert("rect", ":first-child").attr("x", x0 - 2).attr("y", margin.top - 22).attr("width", x1 - x0 + 4).attr("height", height - margin.top - margin.bottom + 22)
        .attr("fill", "rgba(255,255,255,0.025)");
    }
    svg.append("text").attr("x", (x0 + x1) / 2).attr("y", margin.top - 8).attr("text-anchor", "middle")
      .attr("font-size", 10).attr("fill", "#8b96ab").text(period);
  }
  const initialBars = svg.append("g").selectAll("rect").data(rows).join("rect")
    .attr("x", (r) => x(r.year)).attr("width", x.bandwidth())
    .attr("y", (r) => y(r.initial ?? 0)).attr("height", (r) => y(0) - y(r.initial ?? 0))
    .attr("fill", "#4fd8ff").attr("opacity", 0.75);
  const suppBars = svg.append("g").selectAll("rect").data(rows).join("rect")
    .attr("x", (r) => x(r.year)).attr("width", x.bandwidth())
    .attr("y", (r) => y((r.initial ?? 0) + (r.supplementary ?? 0))).attr("height", (r) => y(0) - y(r.supplementary ?? 0))
    .attr("fill", "#ffb545").attr("opacity", 0.9);
  if (!REDUCED && gsap) {
    gsap.from([...initialBars.nodes(), ...suppBars.nodes()], { attr: { height: 0 }, y: y(0), duration: 0.9, ease: "power3.out", stagger: 0.008, scrollTrigger: { trigger: mount, start: "top 80%" } });
  }
  const legend = svg.append("g").attr("transform", `translate(${width - margin.right - 190},${margin.top + 4})`);
  for (const [index, [label, color]] of [["当初予算", "#4fd8ff"], ["補正予算等", "#ffb545"]].entries()) {
    legend.append("rect").attr("x", 0).attr("y", index * 18).attr("width", 10).attr("height", 10).attr("fill", color);
    legend.append("text").attr("x", 16).attr("y", index * 18 + 9).attr("font-size", 10).attr("fill", "#8b96ab").text(label);
  }
  const hover = hoverBox("#plan-hover");
  svg.on("pointermove", (event) => {
    const [mx] = d3.pointer(event);
    const year = rows.find((r) => mx >= x(r.year) && mx <= x(r.year) + x.bandwidth());
    if (year) {
      hover.show(`<b>${year.year}年度（${escapeHtml(year.period)}）</b><br>当初 ${choFromOku(year.initial ?? 0)} / 補正 ${choFromOku(year.supplementary ?? 0)}`, event, mount);
    } else hover.hide();
  }).on("pointerleave", () => hover.hide());
  const suppShare = rows.filter((r) => r.year >= 2020);
  const recent = d3.sum(suppShare, (r) => r.supplementary ?? 0) / d3.sum(suppShare, (r) => (r.initial ?? 0) + (r.supplementary ?? 0));
  setText("#plan-lede", `6期30年の基本計画のもとでの国の科学技術関係予算。2020年度以降は総額の${fmtPct(recent * 100)}を補正予算が占める。`);
  setText("#plan-source", `出典: ${block.source?.title || ""}。${block.note || ""}`);
}

/* ============================================================ 07 finance */

function renderNatlScatter(finance) {
  const mount = $("#natl-scatter");
  const block = finance?.national;
  if (!mount || !block || block.status !== "ok") { if (mount) mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>'; return; }
  mount.innerHTML = "";
  const years = block.years || [];
  const yearIndex = years.length - 1;
  const latestYear = years[yearIndex];
  const rows = (block.corporations || []).map((corp) => {
    const revenue = corp.metrics.revenue_total?.[yearIndex];
    const grants = corp.metrics.grants?.[yearIndex];
    if (!revenue || grants == null) return null;
    return { label: corp.label, revenue, grants, dependency: (grants / revenue) * 100, hospital: (corp.metrics.hospital?.[yearIndex] || 0) > 0 };
  }).filter(Boolean);
  const width = mount.clientWidth || 1000, height = Math.max(420, Math.min(560, width * 0.5));
  const margin = { top: 30, right: 40, bottom: 48, left: 56 };
  const x = d3.scaleLog().domain(d3.extent(rows, (r) => r.revenue)).range([margin.left, width - margin.right]).nice();
  const y = d3.scaleLinear().domain([0, d3.max(rows, (r) => r.dependency) * 1.08]).range([height - margin.bottom, margin.top]);
  const svg = d3.select(mount).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img")
    .attr("aria-label", "国立大学法人の経常収益と運営費交付金依存度の散布図");
  baseAxis(svg.append("g").attr("class", "axis").attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(5).tickFormat((v) => `${v}%`).tickSize(-(width - margin.left - margin.right))));
  baseAxis(svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).ticks(5, (v) => `${Math.round(v / 1e5).toLocaleString("ja-JP")}億`).tickSize(-(height - margin.top - margin.bottom))));
  svg.append("text").attr("x", width - margin.right).attr("y", height - 12).attr("text-anchor", "end")
    .attr("font-size", 10).attr("fill", "#8b96ab").text(`経常収益（${latestYear}年度・対数軸）→`);
  svg.append("text").attr("x", margin.left).attr("y", margin.top - 12)
    .attr("font-size", 10).attr("fill", "#8b96ab").text("↑ 運営費交付金依存度（交付金収益 ÷ 経常収益）");
  const big = new Set([...rows].sort((a, b) => b.revenue - a.revenue).slice(0, 7).map((r) => r.label));
  const dots = svg.append("g").selectAll("circle").data(rows).join("circle")
    .attr("cx", (r) => x(r.revenue)).attr("cy", (r) => y(r.dependency))
    .attr("r", (r) => Math.max(2.6, Math.sqrt(r.revenue) / 2400))
    .attr("fill", (r) => (big.has(r.label) ? "rgba(255,181,69,0.55)" : "rgba(79,216,255,0.35)"))
    .attr("stroke", (r) => (big.has(r.label) ? "#ffb545" : "rgba(79,216,255,0.7)")).attr("stroke-width", 0.9);
  svg.append("g").selectAll("text").data(rows.filter((r) => big.has(r.label))).join("text")
    .attr("x", (r) => x(r.revenue) + 9).attr("y", (r) => y(r.dependency) + 4)
    .attr("font-size", 10.5).attr("font-weight", 600).attr("fill", "#ffb545")
    .text((r) => r.label.replace("国立大学機構", "機構"));
  const hover = hoverBox("#natl-hover");
  dots.on("pointerenter", (event, r) => {
    hover.show(`<b>${escapeHtml(r.label)}</b><br>経常収益 ${okuFromThousand(r.revenue)}<br>交付金依存度 ${fmtPct(r.dependency)}`, event, mount);
  }).on("pointerleave", () => hover.hide());
  if (!REDUCED && gsap) {
    gsap.from(dots.nodes(), { attr: { r: 0 }, duration: 0.9, ease: "power3.out", stagger: 0.004, scrollTrigger: { trigger: mount, start: "top 80%" } });
  }
  const median = d3.median(rows, (r) => r.dependency);
  setText("#finance-lede", `国立大学法人${rows.length}法人の${latestYear}年度の経常収益と運営費交付金依存度。依存度の中央値は${fmtPct(median)}。規模が大きいほど病院収益・外部資金で依存度が下がる構造が見える。`);
  setText("#natl-source", `出典: ${block.source?.title || ""}。${block.note || ""}`);
}

function renderPrivBars(finance) {
  const mount = $("#priv-bars");
  const block = finance?.private;
  if (!mount || !block || block.status !== "ok") { if (mount) mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>'; return; }
  mount.innerHTML = "";
  const SEGMENTS = [
    { key: "tuition", label: "学生納付金", color: "#4fd8ff" },
    { key: "subsidies", label: "補助金", color: "#5ad8a1" },
    { key: "donations", label: "寄付金", color: "#ffb545" },
    { key: "commissioned", label: "受託事業", color: "#8d7fb0" },
    { key: "other", label: "その他", color: "#46536b" },
  ];
  const rows = (block.universities || []).map((u) => {
    const m = u.metrics;
    const known = (m.tuition || 0) + (m.subsidies || 0) + (m.donations || 0) + (m.commissioned || 0);
    return { label: u.label, total: m.revenue_total, segments: { ...m, other: Math.max(0, m.revenue_total - known) } };
  }).sort((a, b) => b.total - a.total);
  const width = mount.clientWidth || 560, height = rows.length * 30 + 60;
  const margin = { top: 24, right: 76, bottom: 8, left: 92 };
  const x = d3.scaleLinear().domain([0, rows[0].total]).range([margin.left, width - margin.right]);
  const y = d3.scaleBand().domain(rows.map((r) => r.label)).range([margin.top, height - margin.bottom]).padding(0.32);
  const svg = d3.select(mount).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img")
    .attr("aria-label", "主要私立大学の事業活動収入の構成の積み上げ横棒グラフ");
  for (const row of rows) {
    let cursor = 0;
    for (const seg of SEGMENTS) {
      const value = row.segments[seg.key] || 0;
      if (value <= 0) continue;
      svg.append("rect").attr("x", x(cursor)).attr("y", y(row.label)).attr("height", y.bandwidth())
        .attr("width", Math.max(0.5, x(value) - x(0))).attr("fill", seg.color).attr("opacity", 0.85)
        .append("title").text(`${row.label} ${seg.label} ${(value / 1e8).toFixed(0)}億円`);
      cursor += value;
    }
    svg.append("text").attr("x", margin.left - 6).attr("y", y(row.label) + y.bandwidth() / 2 + 4)
      .attr("text-anchor", "end").attr("font-size", 11).attr("fill", "#e9eef7").text(row.label.replace("大学", ""));
    svg.append("text").attr("x", x(row.total) + 5).attr("y", y(row.label) + y.bandwidth() / 2 + 4)
      .attr("font-size", 10).attr("fill", "#8b96ab").text(`${Math.round(row.total / 1e8).toLocaleString("ja-JP")}億`);
  }
  const legend = svg.append("g").attr("transform", `translate(${margin.left},12)`);
  let lx = 0;
  for (const seg of SEGMENTS) {
    legend.append("rect").attr("x", lx).attr("y", -8).attr("width", 9).attr("height", 9).attr("fill", seg.color);
    legend.append("text").attr("x", lx + 13).attr("y", 0).attr("font-size", 9.5).attr("fill", "#8b96ab").text(seg.label);
    lx += 13 + seg.label.length * 10 + 18;
  }
  setText("#priv-source", `出典: ${block.source?.title || ""}（${block.fiscal_year || ""}）。${block.note || ""}`);
}

function instLatest(inst) {
  const years = Object.keys(inst?.values || {}).filter((y) => inst.values[y]).map(Number).sort((a, b) => a - b);
  if (!years.length) return null;
  const year = years[years.length - 1];
  return { year, entry: inst.values[year], years };
}

function renderInstitutes(finance) {
  const mount = $("#inst-lines");
  const block = finance?.institutes;
  if (!mount || !block || block.status !== "ok") { if (mount) mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>'; return; }
  const rows = [];
  for (const inst of block.institutes || []) {
    const latest = inst ? instLatest(inst) : null;
    if (!latest || latest.entry.revenue_total == null) continue;
    rows.push({
      id: inst.id, label: inst.label, short: inst.short || inst.label,
      category: inst.category, ministry: inst.ministry || "", role: inst.role || "performer",
      year: latest.year, revenue: latest.entry.revenue_total, grants: latest.entry.grants,
      trend: latest.years.map((y) => ({ year: y, revenue: inst.values[y]?.revenue_total })).filter((p) => p.revenue != null),
    });
  }
  rows.sort((a, b) => b.revenue - a.revenue);
  if (!rows.length) { mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>'; return; }
  const spark = (trend) => {
    if (trend.length < 2) return "";
    const w = 84, h = 22, pad = 2;
    const x = d3.scaleLinear().domain(d3.extent(trend, (p) => p.year)).range([pad, w - pad]);
    const y = d3.scaleLinear().domain([0, d3.max(trend, (p) => p.revenue)]).range([h - pad, pad]);
    const d = trend.map((p, i) => `${i ? "L" : "M"}${x(p.year).toFixed(1)},${y(p.revenue).toFixed(1)}`).join("");
    const last = trend[trend.length - 1];
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="${d}" fill="none" stroke="#ffb545" stroke-width="1.3" opacity="0.85"/><circle cx="${x(last.year).toFixed(1)}" cy="${y(last.revenue).toFixed(1)}" r="1.8" fill="#ffb545"/></svg>`;
  };
  const section = (list, title, note) => {
    if (!list.length) return "";
    const max = list[0].revenue;
    return `<p class="ir-group">${escapeHtml(title)}<small>${escapeHtml(note)}</small></p>` + list.map((r) => {
      const grantShare = r.grants != null && r.revenue ? r.grants / r.revenue : null;
      return `
    <div class="ir-row" role="listitem" data-id="i-${escapeHtml(String(r.id))}" tabindex="0" title="${escapeHtml(r.label)}（${escapeHtml(r.ministry)}・${escapeHtml(String(r.year))}年度） クリックで解剖ビューへ">
      <span class="ir-name">${escapeHtml(r.short)}${r.category === "大学共同利用機関法人" ? '<i class="ir-kyodo" title="大学共同利用機関法人">◆</i>' : ""}</span>
      <span class="ir-bar"><i class="ir-rev" style="width:${Math.max(0.6, (r.revenue / max) * 100)}%"></i>${grantShare != null ? `<i class="ir-grant" style="width:${Math.max(0.3, (r.grants / max) * 100)}%"></i>` : ""}</span>
      <span class="ir-value">${Math.round(r.revenue / 1e8).toLocaleString("ja-JP")}億<small>${grantShare != null ? `交付金${Math.round(grantShare * 100)}%` : "交付金 —"}</small></span>
      <span class="ir-spark">${spark(r.trend)}</span>
    </div>`;
    }).join("");
  };
  const performers = rows.filter((r) => r.role !== "funder");
  const funders = rows.filter((r) => r.role === "funder");
  mount.innerHTML = `<div class="inst-rank" role="list">${
    section(performers, "研究実施機関", "自ら研究を行う法人。棒はグループ内の相対スケール")
  }${
    section(funders, "資金配分機関", "JST・NEDO — 収益の大半は基金・補助金のパススルー。スケールが桁違いのため別枠")
  }</div>`;
  mount.querySelectorAll(".ir-row").forEach((row) => {
    const go = () => {
      if (anatomySelect && anatomySelect(row.dataset.id)) {
        document.getElementById("ch-anatomy")?.scrollIntoView({ behavior: REDUCED ? "auto" : "smooth" });
      }
    };
    row.addEventListener("click", go);
    row.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); go(); } });
  });
  if (!REDUCED && gsap) {
    gsap.from(mount.querySelectorAll(".ir-rev"), {
      scaleX: 0, transformOrigin: "left center", duration: 0.9, stagger: 0.02, ease: "power3.out",
      scrollTrigger: { trigger: mount, start: "top 80%" },
    });
  }
  const kyodo = rows.filter((r) => r.category === "大学共同利用機関法人").length;
  setText("#inst-source", `出典: ${block.source?.title || ""}。国立研究開発法人${rows.length - kyodo}機関＋大学共同利用機関法人${kyodo}機関、各機関の最新年度。棒=経常収益、明るい帯=運営費交付金収益、右=経常収益の推移。行をクリックすると09章の解剖ビューが開く。${block.note || ""}`);
}

function renderSectorLines(finance) {
  const mount = $("#sector-lines");
  const sector = finance?.private?.sector;
  const table7 = sector?.table7;
  if (!mount || !table7?.years) { if (mount) mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>'; return; }
  mount.innerHTML = "";
  const columns = table7.columns || [];
  const series = columns.map((label, index) => ({
    label,
    values: Object.entries(table7.years).map(([year, values]) => [+year, values[index]]).filter(([, v]) => v != null).sort((a, b) => a[0] - b[0]),
  }));
  const palette = { "事業活動収入（帰属収入）": "#ffb545", "学生納付金": "#4fd8ff", "補助金": "#5ad8a1", "人件費": "#e0797a", "教育研究経費": "#8d7fb0" };
  const width = mount.clientWidth || 1000, height = Math.max(380, Math.min(500, width * 0.42));
  const margin = { top: 26, right: 150, bottom: 34, left: 52 };
  const x = d3.scaleLinear().domain(d3.extent(series.flatMap((s) => s.values.map(([y_]) => y_)))).range([margin.left, width - margin.right]);
  const y = d3.scaleLinear().domain([0, d3.max(series.flatMap((s) => s.values.map(([, v]) => v))) * 1.06]).range([height - margin.bottom, margin.top]);
  const svg = d3.select(mount).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img")
    .attr("aria-label", "私立大学セクターの収入と支出の長期推移");
  baseAxis(svg.append("g").attr("class", "axis").attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(5).tickFormat((v) => `${(v / 1e6).toFixed(1)}兆`).tickSize(-(width - margin.left - margin.right))));
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).ticks(MOBILE ? 5 : 10).tickFormat(d3.format("d"))).select(".domain").attr("stroke", "#1c2839");
  for (const s of series) {
    const color = palette[s.label] || "#8b96ab";
    const isMain = s.label.startsWith("事業活動収入");
    const path = svg.append("path")
      .attr("d", d3.line().x(([yr]) => x(yr)).y(([, v]) => y(v)).curve(d3.curveMonotoneX)(s.values))
      .attr("fill", "none").attr("stroke", color).attr("stroke-width", isMain ? 2.4 : 1.4).attr("opacity", isMain ? 1 : 0.8);
    if (!REDUCED && gsap) {
      const length = path.node().getTotalLength();
      path.attr("stroke-dasharray", length).attr("stroke-dashoffset", length);
      gsap.to(path.node(), { strokeDashoffset: 0, duration: 2, ease: "power2.out", scrollTrigger: { trigger: mount, start: "top 78%" } });
    }
    const last = s.values[s.values.length - 1];
    svg.append("text").attr("x", x(last[0]) + 7).attr("y", y(last[1]) + 4)
      .attr("fill", color).attr("font-size", isMain ? 11.5 : 10).attr("font-weight", isMain ? 600 : 400)
      .text(`${s.label.replace("（帰属収入）", "")} ${(last[1] / 1e6).toFixed(1)}兆`);
  }
  setText("#sector-source", `出典: ${sector.source?.title || ""}。単位は兆円（原資料は百万円）。${sector.note || ""}`);
}

/* ========================================================== 08 anatomy */

const BUCKETS = [
  { key: "public", label: "公費（交付金・補助金）", color: "#4fd8ff" },
  { key: "tuition", label: "学生納付金", color: "#ffb545" },
  { key: "hospital", label: "病院収益", color: "#e0797a" },
  { key: "external", label: "外部資金（受託・共同・寄付）", color: "#5ad8a1" },
  { key: "other", label: "その他", color: "#59687f" },
];
const CMP_COLORS = ["#ffb545", "#4fd8ff", "#5ad8a1", "#e0797a", "#b18cff", "#e8e2d5"];

let anatomySelect = null;

function buildEntities(finance) {
  const entities = [];
  const national = finance?.national;
  if (national?.status === "ok") {
    const years = national.years || [];
    const yi = years.length - 1;
    for (const corp of national.corporations || []) {
      const value = (key) => { const v = corp.metrics[key]?.[yi]; return v != null ? v * 1000 : null; };  // 千円→円
      const revenue = value("revenue_total");
      if (!revenue) continue;
      const buckets = {
        public: (value("grants") || 0) + (value("subsidies") || 0),
        tuition: value("tuition") || 0,
        hospital: value("hospital") || 0,
        external: (value("commissioned") || 0) + (value("joint") || 0) + (value("donations") || 0),
      };
      buckets.other = Math.max(0, revenue - buckets.public - buckets.tuition - buckets.hospital - buckets.external);
      entities.push({
        id: `n-${corp.id}`, label: corp.label, sector: "国立", year: `${years[yi]}年度`, revenue, buckets,
        revenueItems: [
          ["運営費交付金", value("grants")], ["学生納付金", value("tuition")], ["附属病院", value("hospital")],
          ["受託研究", value("commissioned")], ["共同研究", value("joint")], ["寄付金", value("donations")], ["補助金等", value("subsidies")],
        ],
        expenseTotal: value("expense_total"),
        expenseItems: [["人件費", value("personnel")], ["研究経費", value("research")], ["教育経費", value("education")], ["一般管理費", value("admin")]],
        expenseResidualLabel: "診療経費・その他",
        net: value("net"), assets: value("assets"),
        trend: { years, revenue: corp.metrics.revenue_total?.map((v) => (v != null ? v * 1000 : null)), grants: corp.metrics.grants?.map((v) => (v != null ? v * 1000 : null)) },
      });
    }
  }
  const priv = finance?.private;
  if (priv?.status === "ok") {
    for (const uni of priv.universities || []) {
      const m = uni.metrics;
      const buckets = {
        public: m.subsidies || 0,
        tuition: m.tuition || 0,
        hospital: 0,
        external: (m.commissioned || 0) + (m.donations || 0),
      };
      buckets.other = Math.max(0, m.revenue_total - buckets.public - buckets.tuition - buckets.hospital - buckets.external);
      entities.push({
        id: `p-${uni.id}`, label: uni.label, sector: "私立", year: priv.fiscal_year || "", revenue: m.revenue_total, buckets,
        revenueItems: [["学生納付金", m.tuition], ["経常費等補助金", m.subsidies], ["寄付金", m.donations], ["受託事業", m.commissioned]],
        expenseTotal: m.expense_total,
        expenseItems: [["人件費", m.personnel], ["教育研究経費", m.edu_research]],
        expenseResidualLabel: "管理経費ほか",
        net: null, assets: null,
        note: uni.note || (buckets.other > m.revenue_total * 0.3 ? "「その他」には付属病院収入等を含む。" : ""),
        trend: null,
      });
    }
  }
  const inst = finance?.institutes;
  if (inst?.status === "ok") {
    for (const org of inst.institutes || []) {
      const latest = org ? instLatest(org) : null;
      if (!latest || !latest.entry.revenue_total) continue;
      const e = latest.entry;
      const commissioned = (e.commissioned || 0) + (e.commissioned_gov || 0) + (e.commissioned_govrel || 0) + (e.commissioned_priv || 0);
      const buckets = {
        public: (e.grants || 0) + (e.subsidies || 0),
        tuition: 0,
        hospital: e.hospital || 0,
        external: commissioned + (e.joint || 0) + (e.donations || 0) + (e.research_revenue || 0) + (e.ip_revenue || 0),
      };
      buckets.other = Math.max(0, e.revenue_total - buckets.public - buckets.hospital - buckets.external);
      const series = (key) => latest.years.map((y) => org.values[y]?.[key] ?? null);
      entities.push({
        id: `i-${org.id}`, label: org.label, short: org.short, funder: org.role === "funder",
        sector: org.category === "大学共同利用機関法人" ? "大学共同利用" : "研究開発法人",
        year: `${latest.year}年度`, revenue: e.revenue_total, buckets,
        revenueItems: [
          ["運営費交付金", e.grants], ["補助金等", e.subsidies], ["受託研究・受託収入", commissioned || null],
          ["共同研究", e.joint], ["寄付金", e.donations], ["病院（医業収益）", e.hospital],
          ["研究収益", e.research_revenue], ["知的所有権", e.ip_revenue],
        ],
        expenseTotal: e.expense_total, expenseItems: [], expenseResidualLabel: "経常費用計",
        net: null, assets: e.assets ?? null,
        note: `${org.ministry ? `${org.ministry}所管。` : ""}${org.accounting === "kokudai" ? "国立大学法人会計基準。" : "独立行政法人会計基準。"}費用の内訳は抽出対象外（収益の財源別内訳のみ）。`,
        trend: { years: latest.years, revenue: series("revenue_total"), grants: series("grants") },
      });
    }
  }
  return entities;
}

function buildAggregates(entities) {
  const defs = [
    { id: "agg-natl", match: (e) => e.sector === "国立", label: "国立大学法人 全体", short: "国立大 計" },
    { id: "agg-priv", match: (e) => e.sector === "私立", label: "主要私立大学 全体", short: "私立16 計" },
    { id: "agg-inst", match: (e) => e.sector === "研究開発法人" && !e.funder, label: "国立研究開発法人 全体（JST・NEDOを除く）", short: "研開法人 計" },
    { id: "agg-fund", match: (e) => e.funder, label: "資金配分機関（JST＋NEDO）", short: "JST+NEDO" },
    { id: "agg-kyodo", match: (e) => e.sector === "大学共同利用", label: "大学共同利用機関法人 全体", short: "共同利用 計" },
  ];
  return defs.map((def) => {
    const members = entities.filter(def.match);
    if (!members.length) return null;
    const buckets = {};
    for (const bucket of BUCKETS) buckets[bucket.key] = d3.sum(members, (e) => e.buckets[bucket.key] || 0);
    const revenue = d3.sum(members, (e) => e.revenue);
    if (!revenue) return null;
    const years = [...new Set(members.map((e) => e.year).filter(Boolean))].sort();
    return {
      id: def.id, label: def.label, short: def.short, sector: "全体", isAgg: true, count: members.length,
      year: years.length <= 1 ? years[0] || "" : `${years[0]}〜${years[years.length - 1]}`,
      revenue, buckets,
      expenseTotal: members.some((e) => e.expenseTotal == null) ? null : d3.sum(members, (e) => e.expenseTotal),
      assets: members.some((e) => e.assets == null) ? null : d3.sum(members, (e) => e.assets),
      net: null, trend: null,
    };
  }).filter(Boolean);
}

function initAnatomy(finance) {
  const mapMount = $("#glyph-map");
  const panel = $("#anatomy-panel");
  if (!mapMount || !panel) return;
  const entities = buildEntities(finance);
  if (!entities.length) { mapMount.innerHTML = '<p class="data-empty">財務データを取得できませんでした。</p>'; return; }
  for (const e of entities) e.publicShare = Math.max(0, Math.min(1, (e.buckets.public || 0) / e.revenue));
  const aggregates = buildAggregates(entities);
  for (const a of aggregates) a.publicShare = Math.max(0, Math.min(1, (a.buckets.public || 0) / a.revenue));
  const averages = aggregates.filter((a) => a.count > 1).map((a) => {
    const buckets = {};
    for (const bucket of BUCKETS) buckets[bucket.key] = (a.buckets[bucket.key] || 0) / a.count;
    return {
      ...a, buckets,
      id: `${a.id}-avg`, isAvg: true,
      label: a.label.includes("全体") ? a.label.replace("全体", "平均（1法人あたり）") : `${a.label} 平均（1法人あたり）`,
      short: a.short.includes("計") ? a.short.replace("計", "平均") : `${a.short} 平均`,
      revenue: a.revenue / a.count,
      expenseTotal: a.expenseTotal != null ? a.expenseTotal / a.count : null,
      assets: a.assets != null ? a.assets / a.count : null,
    };
  });
  const byId = new Map([...entities, ...aggregates, ...averages].map((e) => [e.id, e]));
  let selectedId = (entities.find((e) => e.label === "東京大学") || entities[0]).id;
  let filterKey = "all";
  let query = "";
  let vsId = null;
  const tray = [];
  const SECTOR_NAMES = { "国立": "国立大学法人", "私立": "私立大学", "研究開発法人": "国立研究開発法人", "大学共同利用": "大学共同利用機関法人" };

  const legend = $("#glyph-legend");
  if (legend) legend.innerHTML = BUCKETS.map((b) => `<span><i style="background:${b.color}"></i>${b.label}</span>`).join("");

  const oku = (v) => (v == null ? "—" : `${(v / 1e8).toLocaleString("ja-JP", { maximumFractionDigits: v < 1e9 ? 1 : 0 })}億円`);
  const okuShort = (v) => (v >= 1e12 ? `${(v / 1e12).toFixed(1)}兆` : `${Math.round(v / 1e8).toLocaleString("ja-JP")}億`);
  const stack100 = (e) => BUCKETS.map((bucket) => {
    const share = (e.buckets[bucket.key] || 0) / e.revenue;
    if (share <= 0.002) return "";
    return `<i style="width:${(share * 100).toFixed(2)}%;background:${bucket.color}" title="${escapeHtml(bucket.label)} ${fmtPct(share * 100)}">${share >= 0.085 ? `<em>${Math.round(share * 100)}</em>` : ""}</i>`;
  }).join("");
  const aggFor = (e) => byId.get(
    e.sector === "国立" ? "agg-natl" : e.sector === "私立" ? "agg-priv"
      : e.sector === "大学共同利用" ? "agg-kyodo" : e.funder ? "agg-fund" : "agg-inst");

  /* ---- 個別ビュー内の構成ドーナツ ---- */
  const donutSvg = (slices, total, size) => {
    const r = size / 2;
    const arcGen = d3.arc().innerRadius(r * 0.58).outerRadius(r - 1.5).cornerRadius(1);
    const arcs = d3.pie().value((d) => d.value).sort(null).padAngle(0.014)(slices);
    const paths = arcs.map((a) => {
      const [lx, ly] = arcGen.centroid(a);
      const label = a.data.value / total >= 0.06
        ? `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" fill="#06090f" font-size="9" font-family="IBM Plex Mono" font-weight="600">${a.data.pct}%</text>`
        : "";
      return `<path d="${arcGen(a)}" fill="${a.data.color}"></path>${label}`;
    }).join("");
    return `<svg viewBox="${-r} ${-r} ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="構成比の円グラフ">
      <g>${paths}</g>
      <text x="0" y="0" text-anchor="middle" dominant-baseline="middle" fill="var(--text)" font-size="10" font-family="IBM Plex Mono" font-weight="600">${escapeHtml(oku(total))}</text>
    </svg>`;
  };
  const donutLegend = (slices) => `<div class="donut-legend">${
    slices.map((s) => `<span><i style="background:${s.color}"></i>${escapeHtml(s.label)}<b>${s.pct}%</b></span>`).join("")
  }</div>`;
  const donutBlock = (title, slices, total) => {
    if (!total || !slices.length) return "";
    /* 最大剰余法で整数%の合計を構成比の合計に一致させる（独立丸めだと99%や101%になる） */
    const exact = slices.map((s) => (s.value / total) * 100);
    const pcts = exact.map(Math.floor);
    const rest = Math.round(exact.reduce((a, b) => a + b, 0)) - pcts.reduce((a, b) => a + b, 0);
    exact.map((v, i) => [v - pcts[i], i]).sort((a, b) => b[0] - a[0]).slice(0, Math.max(0, rest)).forEach(([, i]) => { pcts[i] += 1; });
    slices.forEach((s, i) => { s.pct = pcts[i]; });
    return `<div class="donut-block"><h5>${escapeHtml(title)}</h5><div class="donut-wrap">${donutSvg(slices, total, 132)}${donutLegend(slices)}</div></div>`;
  };

  /* ---- 構造マップ（横=公費依存度、縦=経常収益 log） ---- */
  const hover = hoverBox("#glyph-hover");
  const hoverHtml = (d) => `<b>${escapeHtml(d.label)}</b><br>${escapeHtml(d.sector)}・${escapeHtml(d.year)}<br>経常収益 ${okuShort(d.revenue)}円 ／ 公費 ${Math.round(d.publicShare * 100)}%`;
  const matches = (d) => (filterKey === "all" || d.sector === filterKey)
    && (!query || d.label.includes(query) || (d.short || "").includes(query));
  let nodes = null;
  let firstBuild = true;

  function buildMap() {
    const narrow = window.matchMedia("(max-width: 760px)").matches;
    const width = Math.max(narrow ? 340 : 720, mapMount.clientWidth || 1100);
    const height = narrow ? 520 : 660;
    const margin = { top: 30, right: 36, bottom: 50, left: 60 };
    const x = d3.scaleLinear().domain([0, 1]).range([margin.left, width - margin.right]);
    const y = d3.scaleLog()
      .domain([d3.min(entities, (e) => e.revenue) * 0.7, d3.max(entities, (e) => e.revenue) * 1.35])
      .range([height - margin.bottom, margin.top]);
    entities.forEach((e) => {
      e.r = Math.max(5.2, Math.min(narrow ? 20 : 29, Math.sqrt(e.revenue / 1e9) * (narrow ? 1.25 : 1.8)));
      e.cr = e.r * 1.12 + 2;
      e.x = e.x0 = x(e.publicShare);
      e.y = e.y0 = y(e.revenue);
    });
    const byRevenue = [...entities].sort((a, b) => b.revenue - a.revenue);
    byRevenue.forEach((e, rank) => { e.labelDefault = rank < (narrow ? 12 : 22); });
    const sim = d3.forceSimulation(entities)
      .force("x", d3.forceX((d) => d.x0).strength(0.85))
      .force("y", d3.forceY((d) => d.y0).strength(0.85))
      .force("collide", d3.forceCollide((d) => d.cr).strength(0.95).iterations(2))
      .stop();
    for (let i = 0; i < 200; i++) sim.tick();
    entities.forEach((e) => {
      const pad = Math.max(e.cr, e.r * 1.9) + 2;
      e.x = Math.max(margin.left + pad, Math.min(width - margin.right - pad, e.x));
      e.y = Math.max(margin.top + pad, Math.min(height - margin.bottom - pad, e.y));
    });

    d3.select(mapMount).selectAll("svg").remove();
    const svg = d3.select(mapMount).append("svg").attr("viewBox", `0 0 ${width} ${height}`)
      .attr("role", "img").attr("aria-label", "財務構造マップ — 横軸が公費依存度、縦軸が経常収益");
    baseAxis(svg.append("g").attr("class", "axis").attr("transform", `translate(${margin.left},0)`)
      .call(d3.axisLeft(y)
        .tickValues([1e9, 1e10, 1e11, 1e12].filter((v) => v >= y.domain()[0] && v <= y.domain()[1]))
        .tickFormat((v) => (v >= 1e12 ? `${v / 1e12}兆円` : `${v / 1e8}億円`))
        .tickSize(-(width - margin.left - margin.right))));
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - margin.bottom})`)
      .call(d3.axisBottom(x).tickValues(narrow ? [0, 0.5, 1] : [0, 0.2, 0.4, 0.6, 0.8, 1]).tickFormat((v) => `${Math.round(v * 100)}%`))
      .select(".domain").attr("stroke", "#1c2839");
    svg.append("text").attr("x", width - margin.right).attr("y", height - 8).attr("text-anchor", "end")
      .attr("fill", "#8b96ab").attr("font-size", 10.5).attr("font-family", "IBM Plex Mono")
      .text("→ 公費依存度（運営費交付金＋補助金 ÷ 経常収益）");
    svg.append("text").attr("x", margin.left - 46).attr("y", margin.top - 12)
      .attr("fill", "#8b96ab").attr("font-size", 10.5).attr("font-family", "IBM Plex Mono")
      .text("↑ 経常収益（対数）");

    nodes = svg.append("g").selectAll("g").data(byRevenue).join("g")
      .attr("class", "map-glyph").attr("transform", (d) => `translate(${d.x.toFixed(1)},${d.y.toFixed(1)})`)
      .attr("tabindex", 0).attr("role", "button")
      .attr("aria-label", (d) => `${d.label}（${d.sector}） 経常収益${okuShort(d.revenue)}円、公費依存度${Math.round(d.publicShare * 100)}%`);
    nodes.each(function (d) {
      const g = d3.select(this);
      BUCKETS.forEach((bucket, index) => {
        const share = (d.buckets[bucket.key] || 0) / d.revenue;
        if (share <= 0.004) return;
        const radius = Math.max(2, d.r * Math.sqrt(share) * 1.9);
        const a0 = (index / BUCKETS.length) * Math.PI * 2 - Math.PI / 2 + 0.09;
        const a1 = ((index + 1) / BUCKETS.length) * Math.PI * 2 - Math.PI / 2 - 0.09;
        g.append("path")
          .attr("d", `M0,0 L${(Math.cos(a0) * radius).toFixed(1)},${(Math.sin(a0) * radius).toFixed(1)} A${radius.toFixed(1)},${radius.toFixed(1)} 0 0 1 ${(Math.cos(a1) * radius).toFixed(1)},${(Math.sin(a1) * radius).toFixed(1)} Z`)
          .attr("fill", bucket.color).attr("opacity", 0.8);
      });
      g.append("circle").attr("r", 1.3).attr("fill", "#8b96ab");
      g.append("circle").attr("class", "mg-ring").attr("r", d.cr).attr("fill", "none").attr("stroke", "transparent").attr("stroke-width", 1.6);
      g.append("circle").attr("class", "mg-hit").attr("r", d.cr + 2).attr("fill", "transparent");
      g.append("text").attr("class", "mg-label").attr("y", d.cr + 10).attr("text-anchor", "middle")
        .text(d.short || d.label.replace(/大学$/, ""));
    });
    nodes
      .on("pointerenter", function (event, d) { d3.select(this).raise(); hover.show(hoverHtml(d), event, mapMount); })
      .on("pointermove", (event, d) => hover.show(hoverHtml(d), event, mapMount))
      .on("pointerleave", () => hover.hide())
      .on("click", (event, d) => select(d.id))
      .on("keydown", (event, d) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); select(d.id); } });
    refreshMap();
    if (firstBuild && !REDUCED && gsap) {
      firstBuild = false;
      gsap.from(nodes.nodes(), {
        opacity: 0, duration: 0.6, stagger: 0.004, ease: "power2.out", clearProps: "opacity",
        scrollTrigger: { trigger: mapMount, start: "top 78%" },
      });
    }
  }

  function refreshMap() {
    if (nodes) {
      nodes.each(function (d) {
        const on = matches(d);
        const g = d3.select(this);
        const trayIndex = tray.indexOf(d.id);
        g.attr("opacity", on ? 1 : 0.07).style("pointer-events", on ? "auto" : "none");
        g.select(".mg-ring").attr("stroke", d.id === selectedId ? "#ffb545" : trayIndex >= 0 ? CMP_COLORS[trayIndex] : "transparent");
        g.select(".mg-label")
          .style("display", on && (d.labelDefault || d.id === selectedId || trayIndex >= 0 || Boolean(query)) ? null : "none")
          .attr("fill", d.id === selectedId ? "#ffb545" : "#8b96ab");
      });
    }
    refreshDir();
  }

  /* ---- 法人の一覧（名前で選ぶ） ---- */
  const dirMount = $("#inst-dir");
  function buildDir() {
    if (!dirMount) return;
    const order = ["国立", "私立", "研究開発法人", "大学共同利用"];
    dirMount.innerHTML = order.map((sector) => {
      const list = entities.filter((e) => e.sector === sector).sort((a, b) => b.revenue - a.revenue);
      if (!list.length) return "";
      return `<div class="dir-group"><h4>${escapeHtml(SECTOR_NAMES[sector])}<small>${list.length}法人・経常収益順</small></h4><div class="dir-cols">${
        list.map((e) => `<button type="button" class="dir-item" data-id="${escapeHtml(String(e.id))}"><span>${escapeHtml(e.label)}</span><small>${okuShort(e.revenue)}</small></button>`).join("")
      }</div></div>`;
    }).join("");
    dirMount.addEventListener("click", (event) => {
      const item = event.target.closest(".dir-item");
      if (!item) return;
      if (select(item.dataset.id)) panel.scrollIntoView({ behavior: REDUCED ? "auto" : "smooth", block: "start" });
    });
  }
  function refreshDir() {
    if (!dirMount) return;
    dirMount.querySelectorAll(".dir-item").forEach((item) => {
      const e = byId.get(item.dataset.id);
      if (!e) return;
      const trayIndex = tray.indexOf(e.id);
      item.style.display = matches(e) ? "" : "none";
      item.classList.toggle("is-selected", e.id === selectedId);
      item.style.borderLeftColor = e.id === selectedId ? "#ffb545" : trayIndex >= 0 ? CMP_COLORS[trayIndex] : "transparent";
    });
    dirMount.querySelectorAll(".dir-group").forEach((group) => {
      const any = Array.from(group.querySelectorAll(".dir-item")).some((item) => item.style.display !== "none");
      group.style.display = any ? "" : "none";
    });
  }

  let lastMapWidth = mapMount.clientWidth;
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const w = mapMount.clientWidth;
      if (Math.abs(w - lastMapWidth) > 40) { lastMapWidth = w; buildMap(); }
    }, 250);
  });

  function select(id) {
    const entity = byId.get(id);
    if (!entity || entity.isAgg) return false;
    selectedId = id;
    refreshMap();
    renderPanel();
    return true;
  }

  /* ---- 比較トレイ ---- */
  function addToTray(id) {
    if (tray.includes(id) || tray.length >= 6 || !byId.has(id)) return;
    tray.push(id);
    renderTray(); refreshMap(); renderCompare(); renderPanel();
  }
  function removeFromTray(id) {
    const index = tray.indexOf(id);
    if (index < 0) return;
    tray.splice(index, 1);
    renderTray(); refreshMap(); renderCompare(); renderPanel();
  }

  const presetsMount = $("#cmp-presets");
  if (presetsMount) {
    presetsMount.innerHTML = aggregates.map((a) => `<button type="button" data-preset="${escapeHtml(a.id)}" title="${escapeHtml(a.label)}">＋${escapeHtml(a.short)}</button>`).join("");
  }
  function renderTray() {
    const chips = $("#cmp-chips");
    if (chips) {
      chips.innerHTML = tray.length
        ? tray.map((id, i) => {
          const m = byId.get(id);
          return `<button type="button" class="cmp-chip" data-remove="${escapeHtml(id)}" style="border-color:${CMP_COLORS[i]}" title="比較から外す"><i style="background:${CMP_COLORS[i]}"></i>${escapeHtml(m.short || m.label)}<span aria-hidden="true">×</span></button>`;
        }).join("") + (tray.length > 1 ? '<button type="button" class="cmp-clear" data-clear>すべて外す</button>' : "")
        : '<span class="cmp-hint">法人を選んで「＋比較に追加」（最大6件）。右のボタンで全体集計とも比べられる。</span>';
    }
    $$("#cmp-presets [data-preset]").forEach((b) => b.classList.toggle("is-active", tray.includes(b.dataset.preset)));
  }
  $("#cmp-bar")?.addEventListener("click", (event) => {
    const preset = event.target.closest("[data-preset]");
    if (preset) { const id = preset.dataset.preset; if (tray.includes(id)) removeFromTray(id); else addToTray(id); return; }
    const chip = event.target.closest("[data-remove]");
    if (chip) { removeFromTray(chip.dataset.remove); return; }
    if (event.target.closest("[data-clear]")) { tray.length = 0; renderTray(); refreshMap(); renderCompare(); renderPanel(); }
  });

  function renderCompare() {
    const view = $("#cmp-view");
    if (!view) return;
    const members = tray.map((id) => byId.get(id)).filter(Boolean);
    if (!members.length) { view.innerHTML = ""; view.classList.remove("is-on"); return; }
    view.classList.add("is-on");
    const maxRev = d3.max(members, (m) => m.revenue);
    const rows = members.map((m, i) => `
      <div class="cmp-row">
        <span class="cmp-name"><i class="cmp-dot" style="background:${CMP_COLORS[i]}"></i><span>${escapeHtml(m.short || m.label)}<small>${escapeHtml(m.year)}${m.isAgg ? `・${m.count}法人` : ""}</small></span></span>
        <span class="cmp-stack">${stack100(m)}</span>
        <span class="cmp-abs"><span class="cmp-abs-bar"><i style="width:${((m.revenue / maxRev) * 100).toFixed(1)}%"></i></span><b>${okuShort(m.revenue)}円</b></span>
      </div>`).join("");
    const pctOf = (v, m) => (v != null && m.revenue ? fmtPct((v / m.revenue) * 100, 1) : "—");
    const metric = (label, fmt) => `<tr><th>${label}</th>${members.map((m) => `<td>${fmt(m)}</td>`).join("")}</tr>`;
    const table = `<table class="cmp-table">
      <thead><tr><td></td>${members.map((m, i) => `<td><i style="background:${CMP_COLORS[i]}"></i>${escapeHtml(m.short || m.label)}</td>`).join("")}</tr></thead>
      <tbody>
        ${metric("経常収益", (m) => oku(m.revenue))}
        ${metric("経常費用", (m) => oku(m.expenseTotal))}
        ${metric("総資産", (m) => oku(m.assets))}
        ${metric("公費依存度", (m) => fmtPct(m.publicShare * 100, 1))}
        ${metric("学生納付金", (m) => pctOf(m.buckets.tuition, m))}
        ${metric("病院収益", (m) => pctOf(m.buckets.hospital, m))}
        ${metric("外部資金", (m) => pctOf(m.buckets.external, m))}
        ${metric("対象年度", (m) => escapeHtml(m.year))}
      </tbody></table>`;
    const trendMembers = members.map((m, i) => ({ m, i })).filter(({ m }) => m.trend?.revenue?.some((v) => v != null));
    let trendHtml = "";
    if (trendMembers.length) {
      const w = 480, h = 220, pad = { t: 14, r: 118, b: 24, l: 48 };
      const seriesList = trendMembers.map(({ m, i }) => ({
        color: CMP_COLORS[i], short: m.short || m.label,
        points: m.trend.years.map((yr, k) => ({ yr: +yr, v: m.trend.revenue[k] })).filter((p) => p.v != null),
      })).filter((s) => s.points.length > 0);
      if (seriesList.length) {
        const allPts = seriesList.flatMap((s) => s.points);
        const xs = d3.scaleLinear().domain(d3.extent(allPts, (p) => p.yr)).range([pad.l, w - pad.r]);
        const ys = d3.scaleLog().domain([d3.min(allPts, (p) => p.v) * 0.8, d3.max(allPts, (p) => p.v) * 1.2]).range([h - pad.b, pad.t]);
        const gridVals = [1e9, 1e10, 1e11, 1e12].filter((v) => v >= ys.domain()[0] && v <= ys.domain()[1]);
        const grid = gridVals.map((v) => `<line x1="${pad.l}" x2="${w - pad.r}" y1="${ys(v).toFixed(1)}" y2="${ys(v).toFixed(1)}" stroke="#16202f" stroke-dasharray="2 4"/><text x="${pad.l - 6}" y="${(ys(v) + 3).toFixed(1)}" text-anchor="end" fill="#5a687f" font-size="9">${v >= 1e12 ? "1兆" : `${v / 1e8}億`}</text>`).join("");
        const yearTicks = xs.ticks(Math.min(5, xs.domain()[1] - xs.domain()[0])).filter(Number.isInteger);
        const xAxis = yearTicks.map((yr) => `<text x="${xs(yr).toFixed(1)}" y="${h - 6}" text-anchor="middle" fill="#5a687f" font-size="9">${yr}</text>`).join("");
        const lines = seriesList.map((s) => {
          const last = s.points[s.points.length - 1];
          const path = s.points.length > 1
            ? `<path d="${s.points.map((p, k) => `${k ? "L" : "M"}${xs(p.yr).toFixed(1)},${ys(p.v).toFixed(1)}`).join("")}" fill="none" stroke="${s.color}" stroke-width="1.8"/>`
            : "";
          return `${path}<circle cx="${xs(last.yr).toFixed(1)}" cy="${ys(last.v).toFixed(1)}" r="2" fill="${s.color}"/><text x="${(xs(last.yr) + 6).toFixed(1)}" y="${(ys(last.v) + 3).toFixed(1)}" fill="${s.color}" font-size="9">${escapeHtml(s.short)} ${okuShort(last.v)}</text>`;
        }).join("");
        const noTrend = members.filter((m) => !m.trend?.revenue?.some((v) => v != null)).map((m) => m.short || m.label);
        trendHtml = `<div class="cmp-trend"><h4>経常収益の推移（対数スケール）</h4>
          <svg viewBox="0 0 ${w} ${h}" role="img" aria-label="選択法人の経常収益の推移" style="width:100%;height:auto;font-family:'IBM Plex Mono',monospace">${grid}${xAxis}${lines}</svg>
          ${noTrend.length ? `<p class="method-note">推移データなし: ${noTrend.map(escapeHtml).join("・")}（私立は単年度、全体集計は推移の対象外）</p>` : ""}</div>`;
      }
    }
    if (!trendHtml) trendHtml = '<div class="cmp-trend"><h4>経常収益の推移</h4><p class="method-note">選択中の法人には推移データがない（私立は単年度、全体集計は推移の対象外）。</p></div>';
    view.innerHTML = `
      <h3>比較 — 収益の構成と規模</h3>
      <div class="cmp-rows">${rows}</div>
      <div class="cmp-grid">
        <div class="cmp-table-wrap">${table}</div>
        ${trendHtml}
      </div>
      <p class="method-note">中央の帯=収益の構成比（%）、右=経常収益の絶対額（選択中の最大値に対する相対バー）。会計基準の異なる法人（国立大学法人／学校法人／独立行政法人会計基準）を概念的な区分で対応付けたもので、年度も法人により異なる。「計」は取得済み法人の単純合計。</p>`;
  }

  function renderPanel() {
    const entity = entities.find((e) => e.id === selectedId);
    if (!entity) return;
    const rows = (items, total, residualLabel) => {
      const known = items.filter(([, v]) => v != null && v > 0);
      const residual = total != null ? Math.max(0, total - d3.sum(known, ([, v]) => v)) : null;
      const all = [...known.sort((a, b) => b[1] - a[1])];
      if (residual && residual > total * 0.005) all.push([residualLabel, residual, true]);
      const max = d3.max(all, ([, v]) => v) || 1;
      return all.map(([label, value, isResidual]) => `
        <div class="a-row">
          <span class="a-label">${escapeHtml(label)}</span>
          <span class="a-bar"><i style="width:${Math.max(1, (value / max) * 100)}%;background:${isResidual ? "#46536b" : "#4fd8ff"};opacity:${isResidual ? 0.6 : 0.75}"></i></span>
          <span class="a-value">${oku(value)}<small>${total ? fmtPct((value / total) * 100, 0) : ""}</small></span>
        </div>`).join("");
    };
    const revenueSlices = BUCKETS
      .map((b) => ({ label: b.label, value: entity.buckets[b.key], color: b.color }))
      .filter((s) => s.value != null && s.value > 0);
    const revenueDonut = donutBlock("収益構成", revenueSlices, entity.revenue);
    const knownExpense = entity.expenseItems.filter(([, v]) => v != null && v > 0).sort((a, b) => b[1] - a[1]);
    const top5Expense = knownExpense.slice(0, 5);
    const expenseOverflow = d3.sum(knownExpense.slice(5), ([, v]) => v);
    const expenseBaseResidual = entity.expenseTotal != null ? Math.max(0, entity.expenseTotal - d3.sum(knownExpense, ([, v]) => v)) : 0;
    const expenseResidual = expenseBaseResidual + expenseOverflow;
    const expenseSlices = top5Expense.map(([label, value], i) => ({ label, value, color: CMP_COLORS[i] }));
    if (expenseResidual > 0) expenseSlices.push({ label: entity.expenseResidualLabel, value: expenseResidual, color: "#46536b" });
    /* 費用の内訳項目が無い法人（研究機関の一部）は残差1切れの円になり誤解を招くため出さない */
    const expenseDonut = top5Expense.length ? donutBlock("費用構成", expenseSlices, entity.expenseTotal) : "";
    const donutsHtml = (revenueDonut || expenseDonut) ? `<div class="anatomy-donuts">${revenueDonut}${expenseDonut}</div>` : "";
    let trendSvg = "";
    if (entity.trend?.revenue) {
      const points = entity.trend.years.map((year, index) => ({ year, revenue: entity.trend.revenue[index], grants: entity.trend.grants?.[index] })).filter((p) => p.revenue != null);
      if (points.length > 1) {
        const w = 320, h = 74, pad = 8;
        const x = d3.scaleLinear().domain(d3.extent(points, (p) => p.year)).range([pad, w - 58]);
        const y = d3.scaleLinear().domain([0, d3.max(points, (p) => p.revenue) * 1.06]).range([h - pad, pad]);
        const line = (key) => points.filter((p) => p[key] != null).map((p, i) => `${i ? "L" : "M"}${x(p.year).toFixed(1)},${y(p[key]).toFixed(1)}`).join("");
        const last = points[points.length - 1];
        trendSvg = `<div class="anatomy-trend"><h4>経常収益と交付金の推移（${points[0].year}–${last.year}）</h4>
          <svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
            <path d="${line("revenue")}" fill="none" stroke="#ffb545" stroke-width="2"/>
            <path d="${line("grants")}" fill="none" stroke="#4fd8ff" stroke-width="1.2" stroke-dasharray="3 3"/>
            <text x="${x(last.year) + 5}" y="${y(last.revenue) + 3}" fill="#ffb545" font-size="9" font-family="IBM Plex Mono">${(last.revenue / 1e8).toFixed(0)}億</text>
            ${last.grants != null ? `<text x="${x(last.year) + 5}" y="${y(last.grants) + 3}" fill="#4fd8ff" font-size="9" font-family="IBM Plex Mono">交付金${(last.grants / 1e8).toFixed(0)}億</text>` : ""}
          </svg></div>`;
      }
    }
    const agg = aggFor(entity);
    const defaultVs = (agg && byId.get(`${agg.id}-avg`)) || agg || null;
    const target = (vsId && vsId !== entity.id && byId.get(vsId)) || defaultVs;
    let vsHtml = "";
    if (target) {
      const opt = (t) => `<option value="${escapeHtml(String(t.id))}"${t.id === target.id ? " selected" : ""}>${escapeHtml(t.short || t.label)}</option>`;
      const options = `<optgroup label="全体平均（1法人あたり）">${averages.map(opt).join("")}</optgroup>`
        + `<optgroup label="全体合計">${aggregates.map(opt).join("")}</optgroup>`
        + ["国立", "私立", "研究開発法人", "大学共同利用"].map((sector) => {
          const list = entities.filter((e) => e.sector === sector && e.id !== entity.id).sort((a, b) => b.revenue - a.revenue);
          return list.length ? `<optgroup label="${escapeHtml(SECTOR_NAMES[sector])}">${list.map(opt).join("")}</optgroup>` : "";
        }).join("");
      const eName = entity.short || entity.label;
      const tName = target.short || target.label;
      const stat = (label, a, b) => `<div class="vs-stat"><span>${label}</span><b>${a}</b><b>${b}</b></div>`;
      let vsTrend = "";
      const seriesOf = (m) => (m.trend?.revenue
        ? m.trend.years.map((yr, k) => ({ yr: +yr, v: m.trend.revenue[k] })).filter((p) => p.v != null) : []);
      const pe = seriesOf(entity), pt = seriesOf(target);
      if (pe.length > 1 && pt.length > 1) {
        const w = 320, h = 74, pad = 8;
        const all = [...pe, ...pt];
        const xs = d3.scaleLinear().domain(d3.extent(all, (p) => p.yr)).range([pad, w - 58]);
        const ys = d3.scaleLog().domain([d3.min(all, (p) => p.v) * 0.85, d3.max(all, (p) => p.v) * 1.15]).range([h - pad, pad]);
        const line = (pts) => pts.map((p, k) => `${k ? "L" : "M"}${xs(p.yr).toFixed(1)},${ys(p.v).toFixed(1)}`).join("");
        vsTrend = `<div class="anatomy-trend"><h4>経常収益の推移（対数）</h4>
          <svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
            <path d="${line(pe)}" fill="none" stroke="#ffb545" stroke-width="2"/>
            <path d="${line(pt)}" fill="none" stroke="#4fd8ff" stroke-width="1.4"/>
            <text x="${(xs(pe[pe.length - 1].yr) + 5).toFixed(1)}" y="${(ys(pe[pe.length - 1].v) + 3).toFixed(1)}" fill="#ffb545" font-size="9" font-family="IBM Plex Mono">${okuShort(pe[pe.length - 1].v)}</text>
            <text x="${(xs(pt[pt.length - 1].yr) + 5).toFixed(1)}" y="${(ys(pt[pt.length - 1].v) + 3).toFixed(1)}" fill="#4fd8ff" font-size="9" font-family="IBM Plex Mono">${okuShort(pt[pt.length - 1].v)}</text>
          </svg></div>`;
      }
      vsHtml = `
      <div class="anatomy-vs">
        <h4>比較対象<select class="vs-select" aria-label="比較対象を選ぶ">${options}</select></h4>
        <div class="vs-row"><span style="color:#ffb545">${escapeHtml(eName)}</span><span class="cmp-stack">${stack100(entity)}</span></div>
        <div class="vs-row"><span style="color:#4fd8ff">${escapeHtml(tName)}</span><span class="cmp-stack">${stack100(target)}</span></div>
        <div class="vs-stats">
          <div class="vs-stat vs-head"><span></span><b style="color:#ffb545">${escapeHtml(eName)}</b><b style="color:#4fd8ff">${escapeHtml(tName)}</b></div>
          ${stat("経常収益", oku(entity.revenue), oku(target.revenue))}
          ${stat("経常費用", oku(entity.expenseTotal), oku(target.expenseTotal))}
          ${stat("総資産", oku(entity.assets), oku(target.assets))}
          ${stat("公費依存度", fmtPct(entity.publicShare * 100, 1), fmtPct(target.publicShare * 100, 1))}
          ${stat("対象年度", escapeHtml(entity.year), escapeHtml(target.year))}
        </div>
        ${vsTrend}
      </div>`;
    }
    const inTray = tray.includes(entity.id);
    panel.innerHTML = `
      <div class="anatomy-head">
        <h3>${escapeHtml(entity.label)}</h3>
        <span class="anatomy-tag">${escapeHtml(entity.sector)}</span>
        <span class="anatomy-tag" style="border-color:transparent">${escapeHtml(entity.year)}</span>
        <div class="anatomy-stats">
          <span>収益<b>${oku(entity.revenue)}</b></span>
          <span>費用<b>${oku(entity.expenseTotal)}</b></span>
          ${entity.net != null ? `<span>当期総利益<b style="color:${entity.net < 0 ? "#e0797a" : "#5ad8a1"}">${entity.net < 0 ? "△" : ""}${oku(Math.abs(entity.net))}</b></span>` : ""}
          ${entity.assets != null ? `<span>総資産<b>${oku(entity.assets)}</b></span>` : ""}
        </div>
        <button type="button" class="cmp-add" ${inTray || tray.length >= 6 ? "disabled" : ""}>${inTray ? "✓ 比較トレイに追加済み" : tray.length >= 6 ? "比較トレイが上限（6件）" : "＋ 比較に追加"}</button>
      </div>
      <div class="anatomy-grid">
        <div class="anatomy-col"><h4>収益の内訳</h4>${rows(entity.revenueItems, entity.revenue, "その他収益")}${donutsHtml}</div>
        <div class="anatomy-col"><h4>費用の内訳</h4>${rows(entity.expenseItems, entity.expenseTotal, entity.expenseResidualLabel)}${vsHtml}${trendSvg}</div>
      </div>
      ${entity.note ? `<p class="method-note">${escapeHtml(entity.note)}</p>` : ""}`;
  }
  panel.addEventListener("click", (event) => {
    const add = event.target.closest(".cmp-add");
    if (add && !add.disabled) addToTray(selectedId);
  });
  panel.addEventListener("change", (event) => {
    const selectEl = event.target.closest(".vs-select");
    if (selectEl) { vsId = selectEl.value || null; renderPanel(); }
  });

  $$("#glyph-filter button[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      filterKey = button.dataset.filter;
      $$("#glyph-filter button[data-filter]").forEach((b) => b.classList.toggle("is-active", b === button));
      refreshMap();
    });
  });
  $("#glyph-search")?.addEventListener("input", (event) => {
    query = event.target.value.trim();
    refreshMap();
  });

  anatomySelect = (id) => select(id);

  buildDir();
  buildMap();
  renderTray();
  renderCompare();
  renderPanel();
  const count = (sector) => entities.filter((e) => e.sector === sector).length;
  setText("#anatomy-lede", `国立大学${count("国立")}法人・主要私立${count("私立")}法人・国立研究開発法人${count("研究開発法人")}機関・大学共同利用機関法人${count("大学共同利用")}法人、計${entities.length}法人。マップは右にあるほど公費頼み、上にあるほど収益が大きい。マップの花か下の一覧名をクリックすると内訳が開き、詳細ではセクター平均・任意の1法人と比較できる。「比較に追加」で最大6法人も並ぶ。`);
  setText("#anatomy-source", "出典: 国立大=NIAD 法人別概要財務諸表（2024年度・千円を円換算）、私立=各学校法人の開示（2025年度）、研究機関=国立研究開発法人・大学共同利用機関法人の各法人開示の財務諸表（最新年度）。会計基準が異なるため（国立大学法人会計基準/学校法人会計基準/独立行政法人会計基準）、区分は概念的に対応付けたもの。私立の附属病院収入は内訳非開示のため「その他」に含まれる。「計」は取得済み法人の単純合計で、年度は法人により異なる。");
}

/* ==================================================== 09 academic publishing */

const okuFromYen = (v) => `${(v / 1e8).toFixed(v >= 1e10 ? 0 : 1)}億円`;
const okuAxis = (v) => `${Math.round(v)}億`;

/* 億円単位の複数系列を1枚の折れ線にする共通描画 */
function pubLineChart(mount, series, { yLabel = "億円", dashKeys = new Set() } = {}) {
  mount.innerHTML = "";
  series = series.filter((s) => s.values.length > 0);
  if (!series.length) { mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>'; return null; }
  const width = mount.clientWidth || 620;
  const height = Math.max(300, Math.min(380, width * 0.56));
  const margin = { top: 18, right: 142, bottom: 30, left: 44 };
  const allPoints = series.flatMap((s) => s.values);
  const [minYear, maxYear] = d3.extent(allPoints, (p) => p[0]);
  const x = d3.scaleLinear().domain([minYear, maxYear]).range([margin.left, width - margin.right]);
  const y = d3.scaleLinear().domain([0, d3.max(allPoints, (p) => p[1]) * 1.08]).range([height - margin.bottom, margin.top]);
  const svg = d3.select(mount).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img")
    .attr("aria-label", series.map((s) => s.label).join("・"));
  baseAxis(svg.append("g").attr("class", "axis").attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(5).tickFormat(okuAxis).tickSize(-(width - margin.left - margin.right))));
  const span = maxYear - minYear;
  const step = Math.max(1, Math.ceil(span / (MOBILE ? 4 : 8)));
  const tickYears = d3.range(minYear, maxYear + 1, step);
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).tickValues(tickYears).tickFormat(d3.format("d"))).select(".domain").attr("stroke", "#1c2839");
  const labelYs = [];
  for (const s of series) {
    const path = svg.append("path")
      .attr("d", d3.line().x((p) => x(p[0])).y((p) => y(p[1])).curve(d3.curveMonotoneX)(s.values))
      .attr("fill", "none").attr("stroke", s.color).attr("stroke-width", s.strong ? 2.4 : 1.5)
      .attr("opacity", s.strong ? 1 : 0.85);
    if (dashKeys.has(s.label)) path.attr("stroke-dasharray", "5 4");
    if (!REDUCED && gsap) {
      const length = path.node().getTotalLength();
      path.attr("stroke-dasharray", dashKeys.has(s.label) ? "5 4" : `${length}`).attr("stroke-dashoffset", dashKeys.has(s.label) ? 0 : length);
      if (!dashKeys.has(s.label)) gsap.to(path.node(), { strokeDashoffset: 0, duration: 1.8, ease: "power2.out", scrollTrigger: { trigger: mount, start: "top 80%" } });
    }
    const last = s.values[s.values.length - 1];
    let ly = y(last[1]) + 4;
    while (labelYs.some((v) => Math.abs(v - ly) < 13)) ly += 13;
    labelYs.push(ly);
    svg.append("text").attr("x", x(last[0]) + 7).attr("y", ly)
      .attr("fill", s.color).attr("font-size", s.strong ? 11 : 10).attr("font-weight", s.strong ? 600 : 400)
      .text(`${s.label} ${okuFromYen(last[1] * 1e8)}`);
  }
  return svg;
}

function renderPubPillars(publishing) {
  const mount = $("#pub-pillars");
  if (!mount) return;
  const sub = publishing?.subscription;
  const apc = publishing?.apc;
  if (sub?.status !== "ok") { mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>'; return; }
  const all = sub.sectors?.all || {};
  const toOku = (millionYen) => millionYen / 100;
  const seriesOf = (key) => sub.years.map((year, i) => [year, all[key]?.[i] != null ? toOku(all[key][i]) : null]).filter((p) => p[1] != null);
  const series = [
    { label: "雑誌（紙）", color: "#59687f", values: seriesOf("journals_print") },
    { label: "電子ジャーナル", color: "#4fd8ff", strong: true, values: seriesOf("ejournal") },
  ];
  if (apc?.status === "ok") {
    series.push({ label: "APC（推計）", color: "#ffb545", strong: true, values: apc.years.map((year, i) => [year, apc.apc_yen.total[i] != null ? apc.apc_yen.total[i] / 1e8 : null]).filter((p) => p[1] != null) });
  }
  mount.insertAdjacentHTML("beforebegin", `<div class="pub-legend">
    <span><i style="background:#4fd8ff"></i>電子ジャーナル経費（調査報告値）</span>
    <span><i style="background:#59687f"></i>紙の雑誌（同）</span>
    <span class="is-dashed" style="color:#ffb545"><i></i>APC＝論文掲載料（定価ベース推計）</span>
  </div>`);
  pubLineChart(mount, series, { dashKeys: new Set(["APC（推計）"]) });
  const ej = seriesOf("ejournal");
  const ejLast = ej[ej.length - 1];
  setText("#pub-pillars-source", `出典: 購読側=${sub.source?.title || ""}（単位は原資料の千円を億円換算）。APC側=${apc?.source?.title || ""}。${sub.note || ""} 電子ジャーナル経費は${ejLast?.[0]}年度${Math.round(ejLast?.[1] || 0)}億円。転換契約（Read & Publish）ではAPC相当分が購読契約に含まれるため、購読とAPCの単純合算はできない。`);
}

function renderPubPublishers(publishing) {
  const mount = $("#pub-publishers");
  if (!mount) return;
  const apc = publishing?.apc;
  if (apc?.status !== "ok" || !apc.publisher_series?.length) { mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>'; return; }
  const sorted = [...apc.publisher_series].sort((a, b) => (b.values[b.values.length - 1]?.apc_yen || 0) - (a.values[a.values.length - 1]?.apc_yen || 0));
  const palette = ["#e0797a", "#ffb545", "#4fd8ff", "#5ad8a1", "#b18cff", "#a7b4cc"];
  const series = sorted.slice(0, MOBILE ? 5 : 7).map((p, i) => ({
    label: p.name,
    color: palette[i] || "#59687f",
    strong: i < 3,
    values: p.values.filter((v) => v.apc_yen != null).map((v) => [v.year, v.apc_yen / 1e8]),
  }));
  pubLineChart(mount, series);
  const latest = apc.publishers_latest?.filter((p) => !["その他", "合計"].includes(p.name)) || [];
  const latestTotal = apc.apc_yen.total[apc.apc_yen.total.length - 1] || 0;
  const topShare = latestTotal ? d3.sum(latest, (p) => p.apc_yen || 0) / latestTotal : 0;
  setText("#pub-publishers-source", `出典: ${apc.source?.title || ""}。${apc.latest_year}年は上位10社でAPC支払推定額の${fmtPct(topShare * 100, 0)}を占める。${apc.note || ""}`);
}

function renderPubInsts(publishing) {
  const mount = $("#pub-insts");
  if (!mount) return;
  const apc = publishing?.apc;
  const rows = (apc?.institutions_latest || []).filter((r) => !["その他会員館", "会員館以外", "合計"].includes(r.name));
  if (apc?.status !== "ok" || !rows.length) { mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>'; return; }
  setText("#pub-insts-year", `${apc.latest_year}年・公表論文数上位20機関のうちAPC推定額上位10`);
  const top = rows.map((r) => ({ ...r, total: (r.apc_full_yen || 0) + (r.apc_hybrid_yen || 0) }))
    .sort((a, b) => b.total - a.total).slice(0, 10);
  const max = top[0].total;
  if (!max) { mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>'; return; }
  mount.innerHTML = `<div class="pub-legend">
    <span><i style="background:#ffb545"></i>フルOA誌のAPC</span>
    <span><i style="background:#4fd8ff"></i>ハイブリッド誌のAPC</span>
  </div>` + top.map((r) => `
    <div class="a-row">
      <span class="a-label">${escapeHtml(r.name)}</span>
      <span class="a-bar" style="height: 12px">
        <i style="left:0; width:${((r.apc_full_yen || 0) / max * 100).toFixed(1)}%; background:#ffb545"></i>
        <i style="left:${((r.apc_full_yen || 0) / max * 100).toFixed(1)}%; width:${((r.apc_hybrid_yen || 0) / max * 100).toFixed(1)}%; background:#4fd8ff"></i>
      </span>
      <span class="a-value">${okuFromYen(r.total)}<small>${fmtInt(r.papers)}本</small></span>
    </div>`).join("");
  setText("#pub-insts-source", `出典: ${apc.source?.title || ""}（JUSTICE会員館の上位機関）。金額は責任著者論文×APC定価の推計。本数は公表論文数。`);
}

function renderPubOpenalex(publishing) {
  const mount = $("#pub-openalex");
  if (!mount) return;
  const apc = publishing?.apc;
  const oa = publishing?.openalex;
  if (oa?.status !== "ok") {
    mount.innerHTML = '<p class="data-empty">OpenAlexによる独自推計は準備中。</p>';
    setText("#pub-openalex-source", "同一の問い（日本の責任著者論文のAPC総額）を、JUSTICE（Web of Science×独自価格表）とは独立に OpenAlex（CC0）×DOAJ定価で推計し、突き合わせる予定。");
    return;
  }
  const series = [
    { label: "OpenAlex推計", color: "#5ad8a1", strong: true, values: oa.years.map((year, i) => [year, oa.total_yen[i] != null ? oa.total_yen[i] / 1e8 : null]).filter((p) => p[1] != null) },
  ];
  if (apc?.status === "ok") {
    series.unshift({ label: "JUSTICE推計", color: "#ffb545", strong: true, values: apc.years.map((year, i) => [year, apc.apc_yen.total[i] != null ? apc.apc_yen.total[i] / 1e8 : null]).filter((p) => p[1] != null) });
  }
  pubLineChart(mount, series);
  const priced = d3.sum(oa.series.gold.priced) + d3.sum(oa.series.hybrid.priced);
  const papers = d3.sum(oa.series.gold.papers) + d3.sum(oa.series.hybrid.papers);
  setText("#pub-openalex-source", `出典: ${oa.source?.title || ""}（${shortDate(oa.generated_at)}時点の一括集計）。${oa.note || ""} 定価が判明したのはgold/hybrid論文の${papers ? fmtPct(priced / papers * 100, 0) : "—"}（未判明分は0円扱いのため過小方向）。データベース・OA判定・価格表が異なる2つの推計が近い水準を示すかの相互検証で、どちらも実支払額ではない。`);
}

function renderPubContracts(publishing) {
  const mount = $("#pub-contracts");
  if (!mount) return;
  const contracts = publishing?.contracts;
  const items = (contracts?.items || []).filter((c) => c.amount_yen);
  if (contracts?.status !== "ok" || !items.length) {
    mount.innerHTML = '<p class="data-empty">契約公表データは準備中。</p>';
    setText("#pub-contracts-source", "国立大学法人等が公表する契約情報から、出版社との契約額を収集して掲載する予定。");
    return;
  }
  const sorted = [...items].sort((a, b) => b.amount_yen - a.amount_yen);
  const row = (c) => `<tr>
      <th>${escapeHtml(c.org)}</th>
      <th>${escapeHtml(c.title)}</th>
      <th>${escapeHtml(c.vendor)}</th>
      <td>${okuFromYen(c.amount_yen)}</td>
      <th>${escapeHtml(String(c.fiscal_year || "—"))}</th>
      <th>${c.source_url ? `<a href="${escapeHtml(safeUrl(c.source_url))}" target="_blank" rel="noopener noreferrer">公表資料</a>` : "—"}</th>
    </tr>`;
  const LIMIT = 25;
  const render = (showAll) => {
    mount.innerHTML = `<table class="cmp-table"><thead><tr>
        <th>機関</th><th>契約</th><th>相手方</th><td>契約額</td><th>年度</th><th>出典</th>
      </tr></thead><tbody>${(showAll ? sorted : sorted.slice(0, LIMIT)).map(row).join("")}</tbody></table>`
      + (sorted.length > LIMIT && !showAll ? `<button class="dir-more" id="pub-contracts-more">残り${sorted.length - LIMIT}件を表示</button>` : "");
    $("#pub-contracts-more")?.addEventListener("click", () => render(true));
  };
  render(false);
  setText("#pub-contracts-source", `出典: 各法人の契約公表資料（表内リンク。随意契約公表・落札公示）から手動検証で収集（${contracts.collected_at || ""}時点・${fmtInt(items.length)}件）。確認できた契約のみで全機関・全契約の網羅ではない。契約額は公表された契約金額であり、決済実績や年額とは限らない（複数年契約の総額・外貨連動の概算を含む）。Web of Science等のデータベース契約も出版社系支出として含む。`);
}

const PUB_FACTS = [
  { value: "53%", text: "自然・医学系論文に占める大手5社（Elsevier・Springer・Wiley-Blackwell・ACS・Taylor & Francis）のシェア（2013年）。1973年は約20%だった。", source: { title: "Larivière et al. 2015 (PLOS ONE)", url: "https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0127502" } },
  { value: "38.9%", text: "Reed-Elsevier（現RELX）科学技術・医学部門の利益率（2013年）。1990年代から一貫して30%超。", source: { title: "Larivière et al. 2015 (PLOS ONE)", url: "https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0127502" } },
  { value: "約100億ドル/年", text: "世界の学術ジャーナル市場の規模（2019年108.1億ドル）。STM市場全体では約270億ドル。", source: { title: "STM Global Brief 2021 (Outsell/Simba)", url: "https://s3.eu-west-2.amazonaws.com/stm.offloadmedia/wp-content/uploads/2024/08/10032918/2021_10_19_STM_Global_Brief_2021_Economics_and_Market_Size-1.pdf" } },
  { value: "25.4億ドル", text: "世界が大手6社（Elsevier・Frontiers・MDPI・PLOS・Springer Nature・Wiley）に支払ったAPCの推計（2023年単年・定価ベース）。2019年の約3倍。", source: { title: "Haustein et al. 2024 (arXiv)", url: "https://arxiv.org/abs/2407.16551" } },
  { value: "86%", text: "APCを支払った日本の研究者のうち、財源に「個人で獲得した外部資金（科研費等）」を挙げた割合（複数回答）。掲載料の主な原資は研究費側にある。", source: { title: "NISTEP DP206（2022）", url: "https://nistep.repo.nii.ac.jp/record/6789/files/NISTEP-DP206-FullJ.pdf" } },
  { value: "66.2%", text: "日本の研究者が過去3年に出版した査読付き論文のうち、APCを支払ってオープンアクセスにした論文の割合（2024年調査・論文ベース）。", source: { title: "NISTEP 調査資料-354（2026）", url: "https://nistep.repo.nii.ac.jp/records/2000290" } },
];

function renderPubFacts() {
  const mount = $("#pub-facts");
  if (!mount) return;
  mount.innerHTML = PUB_FACTS.map((f) => `
    <div class="fact-card">
      <b>${escapeHtml(f.value)}</b>
      <p>${escapeHtml(f.text)}</p>
      <a href="${escapeHtml(safeUrl(f.source.url))}" target="_blank" rel="noopener noreferrer">${escapeHtml(f.source.title)}</a>
    </div>`).join("");
}

function renderPublishing(publishing) {
  const sub = publishing?.subscription;
  const apc = publishing?.apc;
  if (sub?.status === "ok" && apc?.status === "ok") {
    const ejIndex = sub.years.indexOf(2024) >= 0 ? sub.years.indexOf(2024) : sub.years.length - 1;
    const ej = sub.sectors?.all?.ejournal?.[ejIndex];
    const apcTotal = apc.apc_yen.total[apc.apc_yen.total.length - 1];
    if (ej && apcTotal) {
      setText("#publishing-lede", `大学は「読む」ために購読料を、「出す」ためにAPC（論文掲載料）を出版社に払う。大学図書館の電子ジャーナル経費は${sub.years[ejIndex]}年度に${Math.round(ej / 100)}億円（調査報告値）。日本の責任著者論文のAPC支払推定額は${apc.latest_year}年に約${Math.round(apcTotal / 1e8)}億円（定価ベース推計）で、${apc.years[0]}年の${(apcTotal / apc.apc_yen.total[0]).toFixed(1)}倍になった。`);
    }
  }
  renderPubPillars(publishing);
  renderPubPublishers(publishing);
  renderPubInsts(publishing);
  renderPubOpenalex(publishing);
  renderPubContracts(publishing);
  renderPubFacts();
}

/* ============================================================ 15 philanthropy */

function renderPhilanthropy(finance, philanthropy) {
  const trendMount = $("#philanthropy-trend");
  const rankMount = $("#philanthropy-rank");
  const block = finance?.national;
  if (!block?.years?.length || !block.corporations?.length) {
    [trendMount, rankMount].forEach((mount) => { if (mount) mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>'; });
    return;
  }
  const years = block.years;
  const totals = years.map((year, i) => ({ year, value: d3.sum(block.corporations, (c) => c.metrics?.donations?.[i] || 0) }));
  const latestIndex = years.length - 1;
  const latestRows = block.corporations.map((c) => ({ label: c.label, value: c.metrics?.donations?.[latestIndex] || 0 })).filter((d) => d.value > 0).sort((a, b) => b.value - a.value).slice(0, 10);
  const toOku = (v) => v / 1e5;
  const widthOf = (mount, fallback = 560) => mount.clientWidth || fallback;

  if (trendMount && totals.length) {
    const width = widthOf(trendMount), height = Math.max(300, width * 0.58);
    const margin = { top: 24, right: 28, bottom: 34, left: 58 };
    const svg = d3.select(trendMount).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img").attr("aria-label", "国立大学法人の寄付金収益の推移");
    const x = d3.scaleLinear().domain(d3.extent(totals, (d) => d.year)).range([margin.left, width - margin.right]);
    const y = d3.scaleLinear().domain([0, d3.max(totals, (d) => toOku(d.value)) * 1.14]).nice().range([height - margin.bottom, margin.top]);
    baseAxis(svg.append("g").attr("transform", `translate(0,${height - margin.bottom})`).call(d3.axisBottom(x).tickFormat(d3.format("d")).ticks(totals.length)));
    baseAxis(svg.append("g").attr("transform", `translate(${margin.left},0)`).call(d3.axisLeft(y).ticks(4).tickFormat((d) => `${d3.format(",.0f")(d)}億円`)));
    const line = d3.line().x((d) => x(d.year)).y((d) => y(toOku(d.value))).curve(d3.curveMonotoneX);
    svg.append("path").datum(totals).attr("fill", "none").attr("stroke", "#ffb545").attr("stroke-width", 3).attr("d", line);
    svg.selectAll(".philanthropy-dot").data(totals).join("circle").attr("class", "philanthropy-dot").attr("cx", (d) => x(d.year)).attr("cy", (d) => y(toOku(d.value))).attr("r", 4).attr("fill", "#ffb545").attr("stroke", "#06090f").attr("stroke-width", 2);
    svg.selectAll(".philanthropy-label").data(totals).join("text").attr("class", "chart-value philanthropy-label").attr("x", (d) => x(d.year)).attr("y", (d) => y(toOku(d.value)) - 11).attr("text-anchor", "middle").text((d) => `${d3.format(",.0f")(toOku(d.value))}億`);
    setText("#philanthropy-trend-years", `${years[0]}–${years.at(-1)}年度`);
    setText("#philanthropy-trend-source", `出典: 国立大学法人等の財務諸表。${years.at(-1)}年度の寄付金収益は${d3.format(",.0f")(toOku(totals.at(-1).value))}億円。会計上の寄付金収益であり、大学等全体のフィランソロピー総額ではない。`);
  }
  if (rankMount && latestRows.length) {
    const width = widthOf(rankMount), height = Math.max(360, width * 0.72);
    const margin = { top: 12, right: 48, bottom: 28, left: MOBILE ? 112 : 138 };
    const x = d3.scaleLinear().domain([0, d3.max(latestRows, (d) => toOku(d.value)) * 1.17]).range([margin.left, width - margin.right]);
    const y = d3.scaleBand().domain(latestRows.map((d) => d.label)).range([margin.top, height - margin.bottom]).padding(0.28);
    const svg = d3.select(rankMount).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img").attr("aria-label", `${years.at(-1)}年度の国立大学法人寄付金収益ランキング`);
    baseAxis(svg.append("g").attr("transform", `translate(0,${height - margin.bottom})`).call(d3.axisBottom(x).ticks(4).tickFormat((d) => `${d3.format(",.0f")(d)}億`)));
    svg.append("g").attr("transform", `translate(${margin.left},0)`).call(d3.axisLeft(y).tickSize(0)).select(".domain").remove();
    svg.selectAll(".philanthropy-bar").data(latestRows).join("rect").attr("class", "philanthropy-bar").attr("x", margin.left).attr("y", (d) => y(d.label)).attr("width", (d) => x(toOku(d.value)) - margin.left).attr("height", y.bandwidth()).attr("rx", 2).attr("fill", (d, i) => i < 3 ? "#ffb545" : "#5ad8a1");
    svg.selectAll(".philanthropy-rank-value").data(latestRows).join("text").attr("class", "chart-value philanthropy-rank-value").attr("x", (d) => x(toOku(d.value)) + 7).attr("y", (d) => y(d.label) + y.bandwidth() / 2 + 4).text((d) => `${d3.format(",.0f")(toOku(d.value))}億`);
    setText("#philanthropy-rank-year", `${years.at(-1)}年度`);
    setText("#philanthropy-rank-source", `出典: 国立大学法人等の財務諸表。寄付金収益の大きい上位${latestRows.length}法人。大型寄付の有無や法人統合の影響を含むため、単年度の順位は長期的な寄付力そのものではない。`);
  }
  const chairs = philanthropy?.donation_chairs;
  if (chairs) {
    const facts = $("#philanthropy-facts");
    if (facts) facts.innerHTML = `<div class="philanthropy-fact"><span class="fact-label">寄附講座・寄附研究部門</span><strong>${fmtInt(chairs.count)}件</strong><span>${chairs.fiscal_year}年度 / 受入実績 ${fmtInt(Math.round(chairs.amount_yen / 1e8))}億円</span></div>`;
    setText("#philanthropy-source", `出典: ${philanthropy.source?.title || ""}。${chairs.note}`);
  }
}

/* ========================================================= 10 funding structure */

function renderFundingDualStream(funders) {
  const mount = $("#funding-dual-stream");
  const buttons = $$("#funding-sector-filter button");
  if (!mount) return;
  const block = funders?.dual_support;
  const keys = ["self", "government", "company", "other"];
  const sectorArrayKeys = ["self", "government", "company", "nonprofit", "foreign", "inter_university", "private_university", "total"];
  const isValidSector = (sector) => sector && typeof sector === "object"
    && sectorArrayKeys.every((k) => Array.isArray(sector[k]) && sector[k].length === block.years.length);
  const valid = block && block.status === "ok" && Array.isArray(block.years) && block.years.length
    && block.sectors && typeof block.sectors === "object"
    && ["all", "national", "public", "private"].every((sectorKey) => isValidSector(block.sectors[sectorKey]));
  if (!valid) {
    mount.innerHTML = '<p class="data-empty">大学の資金源データは接続作業中。NISTEP科学技術指標「大学等における負担源別研究開発費」を確認しだい、大学の資金源シフトをここに表示する。</p>';
    setText("#funding-dual-source", "出典（予定）: NISTEP 科学技術指標 表1-3-19 大学等における負担源別研究開発費");
    return;
  }
  const colors = { self: "#a7b4cc", government: "#ffb545", company: "#4fd8ff", other: "#8d7fb0" };
  const labels = { self: "自己資金", government: "政府", company: "企業", other: "その他（非営利・外国・大学間）" };
  const years = block.years;

  function rowsFor(sectorKey) {
    const sector = block.sectors[sectorKey];
    if (!sector) return null;
    return years.map((year, i) => {
      const total = sector.total[i];
      const self = sector.self[i] ?? 0, government = sector.government[i] ?? 0, company = sector.company[i] ?? 0;
      const other = (sector.nonprofit[i] ?? 0) + (sector.foreign[i] ?? 0) + (sector.inter_university[i] ?? 0) + (sector.private_university[i] ?? 0);
      return { year, self, government, company, other, total };
    }).filter((r) => r.total);
  }

  function draw(sectorKey) {
    mount.innerHTML = "";
    const rows = rowsFor(sectorKey);
    if (!rows || !rows.length) { mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>'; return; }
    const pctRows = rows.map((r) => {
      const row = { year: r.year };
      for (const key of keys) row[key] = r.total ? (r[key] / r.total) * 100 : 0;
      return row;
    });
    const width = mount.clientWidth || 1000, height = Math.max(360, Math.min(480, width * 0.42));
    const margin = { top: 26, right: 158, bottom: 34, left: 44 };
    const stack = d3.stack().keys(keys).value((row, key) => row[key] ?? 0);
    const series = stack(pctRows);
    const x = d3.scaleLinear().domain(d3.extent(rows, (r) => r.year)).range([margin.left, width - margin.right]);
    const y = d3.scaleLinear().domain([0, 100]).range([height - margin.bottom, margin.top]);
    const svg = d3.select(mount).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img")
      .attr("aria-label", "大学の研究開発費における負担源別割合の推移");
    baseAxis(svg.append("g").attr("class", "axis").attr("transform", `translate(${margin.left},0)`)
      .call(d3.axisLeft(y).ticks(5).tickFormat((v) => `${v}%`).tickSize(-(width - margin.left - margin.right))));
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - margin.bottom})`)
      .call(d3.axisBottom(x).ticks(MOBILE ? 5 : 9).tickFormat(d3.format("d"))).select(".domain").attr("stroke", "#1c2839");
    const area = d3.area().x((d) => x(d.data.year)).y0((d) => y(d[0])).y1((d) => y(d[1])).curve(d3.curveMonotoneX);
    svg.append("g").selectAll("path").data(series).join("path")
      .attr("d", area).attr("fill", (d) => colors[d.key]).attr("opacity", 0.82)
      .attr("stroke", "#06090f").attr("stroke-width", 0.6);
    const lastRow = pctRows[pctRows.length - 1];
    for (const s of series) {
      const end = s[s.length - 1];
      svg.append("text").attr("x", x(lastRow.year) + 8).attr("y", (y(end[0]) + y(end[1])) / 2 + 4)
        .attr("fill", colors[s.key]).attr("font-size", 10.5).attr("font-weight", 600)
        .text(`${labels[s.key]} ${fmtPct(lastRow[s.key] ?? 0)}`);
    }
    const hover = hoverBox("#funding-dual-hover");
    svg.on("pointermove", (event) => {
      const [mx, my] = d3.pointer(event);
      const year = Math.round(x.invert(mx));
      const row = pctRows.find((r) => r.year === year);
      if (!row) { hover.hide(); return; }
      const hit = series.find((s) => {
        const d = s.find((p) => p.data.year === year);
        return d && my >= y(d[1]) && my <= y(d[0]);
      });
      if (hit) hover.show(`<b>${escapeHtml(labels[hit.key])}</b><br>${year}年度 ${fmtPct(row[hit.key] ?? 0)}`, event, mount);
      else hover.hide();
    }).on("pointerleave", () => hover.hide());
    const first = rows[0], last = rows[rows.length - 1];
    const govFirst = first.total ? (first.government / first.total) * 100 : 0;
    const govLast = last.total ? (last.government / last.total) * 100 : 0;
    setText("#funding-dual-years", `${first.year}→${last.year}年度`);
    setText("#funding-dual-source", `${first.year}年度、政府由来の外部資金は大学の研究開発費の${fmtPct(govFirst)}。${last.year}年度は${fmtPct(govLast)}。出典: ${block.source?.title || ""}。${block.note || ""}`);
  }

  draw("all");
  buttons.forEach((btn) => btn.addEventListener("click", () => {
    buttons.forEach((b) => b.classList.toggle("is-active", b === btn));
    draw(btn.dataset.sector);
  }));
}

function renderFundingCsti(funders) {
  const mount = $("#funding-csti-bars");
  if (!mount) return;
  const block = funders?.csti_programs;
  const valid = block && block.status === "ok" && typeof block.latest_year === "string"
    && block.years && typeof block.years === "object" && !Array.isArray(block.years)
    && block.years[block.latest_year] && Array.isArray(block.years[block.latest_year].programs)
    && Array.isArray(block.years[block.latest_year].ministries);
  if (!valid) {
    mount.innerHTML = '<p class="data-empty">競争的資金の制度別予算データは接続作業中。内閣府CSTI「競争的研究費制度一覧（省庁別予算）」を確認しだい、制度別の予算額をここに表示する。</p>';
    setText("#funding-csti-source", "出典（予定）: 内閣府 CSTI「競争的研究費制度一覧（省庁別予算）」");
    return;
  }
  const year = block.years[block.latest_year];
  const programs = (year.programs || []).filter((p) => p && typeof p.initial === "number" && typeof p.label === "string").slice(0, 15);
  if (!programs.length) { mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>'; return; }
  mount.innerHTML = "";
  const agencyColor = { JSPS: "#ffb545", JST: "#4fd8ff", AMED: "#5ad8a1", NEDO: "#8d7fb0" };
  const colorFor = (agency) => agencyColor[agency] || "#71809b";
  const width = mount.clientWidth || 1000, height = Math.max(360, programs.length * 30 + 60);
  /* 狭い画面ではラベル用の左マージンを詰める。固定250pxのままだと390px幅のコンテナで
     (width - margin.right) が margin.left を下回り、スケールのrangeが反転して負の幅の
     rectをGSAPに渡す実行時エラーになる（SVGはwidth属性に負値を許さない）。 */
  const margin = MOBILE
    ? { top: 8, right: 56, bottom: 30, left: 120 }
    : { top: 8, right: 130, bottom: 30, left: 250 };
  const x = d3.scaleLinear().domain([0, d3.max(programs, (p) => p.initial) * 1.05]).range([margin.left, Math.max(margin.left + 40, width - margin.right)]);
  const y = d3.scaleBand().domain(programs.map((p) => p.label)).range([margin.top, height - margin.bottom]).padding(0.28);
  const svg = d3.select(mount).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img")
    .attr("aria-label", "競争的研究費制度別の予算額の比較");
  const bars = svg.append("g").selectAll("rect").data(programs).join("rect")
    .attr("x", x(0)).attr("y", (p) => y(p.label)).attr("height", y.bandwidth())
    .attr("width", (p) => Math.max(0, x(p.initial) - x(0))).attr("fill", (p) => colorFor(p.agency)).attr("opacity", 0.85);
  const shortenProgram = (label) => {
    const limit = MOBILE ? 9 : 17;
    return label.length > limit ? `${label.slice(0, limit - 1)}…` : label;
  };
  svg.append("g").selectAll("text.flabel").data(programs).join("text")
    .attr("x", margin.left - 8).attr("y", (p) => y(p.label) + y.bandwidth() / 2 + 4)
    .attr("text-anchor", "end").attr("font-size", 11).attr("fill", "#e9eef7")
    .text((p) => shortenProgram(p.label))
    .append("title").text((p) => p.label);
  svg.append("g").selectAll("text.fvalue").data(programs).join("text")
    .attr("x", (p) => x(p.initial) + 6).attr("y", (p) => y(p.label) + y.bandwidth() / 2 + 4)
    .attr("font-size", 10).attr("fill", "#8b96ab")
    .text((p) => `${fmtInt(p.initial)}百万円 / ${p.agency}`);
  if (!REDUCED && gsap) {
    gsap.from(bars.nodes(), { attr: { width: 0 }, duration: 1.1, ease: "power3.out", stagger: 0.03, scrollTrigger: { trigger: mount, start: "top 80%" } });
  }
  const parsedCount = year.total_programs_parsed;
  setText("#funding-csti-year", `令和${year.reiwa_current}年度当初予算 — ${parsedCount ? `全${fmtInt(parsedCount)}制度・事業中、` : ""}予算額上位${programs.length}件`);
  setText("#funding-csti-source", `出典: ${block.source?.title || ""}（${year.pdf_url}）。${block.note || ""} 全制度合計${fmtInt(year.initial_total)}百万円（前年度当初${fmtInt(year.prev_initial_total)}百万円、令和${year.reiwa_prev}年度補正込み${fmtInt(year.supplementary_total)}百万円）。府省庁別小計の上位: ${(year.ministries || []).slice(0, 3).map((m) => `${m.name} ${fmtInt(m.initial)}百万円`).join(" / ")}。`);
}

/* ===================================================== economic yardstick */

/* 単一系列の折れ線。CPI・為替のように単位も値域も異なる指標を、同じ骨格で
   描くための共通関数（pubLineChartは億円専用のためここでは使えない）。
   markersで指定した年にだけ丸印と値ラベルを出す。 */
function econLineChart(mount, rawValues, { color = "#ffb545", markers = [], valueFmt = (v) => `${v}`, axisFmt = (v) => `${Math.round(v)}` } = {}) {
  mount.innerHTML = "";
  const values = (rawValues || []).filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (!values.length) { mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>'; return null; }
  markers = Array.from(new Set(markers));
  const width = mount.clientWidth || 560;
  const height = Math.max(260, Math.min(340, width * 0.52));
  const margin = { top: 22, right: 20, bottom: 30, left: 44 };
  const [minYear, maxYear] = d3.extent(values, (p) => p[0]);
  const x = d3.scaleLinear().domain([minYear, maxYear]).range([margin.left, width - margin.right]);
  const [dataMin, dataMax] = d3.extent(values, (p) => p[1]);
  const y = d3.scaleLinear().domain([Math.min(0, dataMin * 0.94), dataMax * 1.12]).range([height - margin.bottom, margin.top]);
  const svg = d3.select(mount).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img")
    .attr("aria-label", `${minYear}〜${maxYear}年の推移`);
  baseAxis(svg.append("g").attr("class", "axis").attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(5).tickFormat(axisFmt).tickSize(-(width - margin.left - margin.right))));
  const tickYears = Array.from(new Set([minYear, ...markers.filter((yr) => yr >= minYear && yr <= maxYear), maxYear])).sort((a, b) => a - b);
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).tickValues(tickYears).tickFormat(d3.format("d"))).select(".domain").attr("stroke", "#1c2839");
  const path = svg.append("path")
    .attr("d", d3.line().x((p) => x(p[0])).y((p) => y(p[1])).curve(d3.curveMonotoneX)(values))
    .attr("fill", "none").attr("stroke", color).attr("stroke-width", 2.2);
  if (!REDUCED && gsap) {
    const length = path.node().getTotalLength();
    path.attr("stroke-dasharray", length).attr("stroke-dashoffset", length);
    gsap.to(path.node(), { strokeDashoffset: 0, duration: 1.8, ease: "power2.out", scrollTrigger: { trigger: mount, start: "top 80%" } });
  }
  const byYear = new Map(values);
  const labelYs = [];
  for (const yr of markers) {
    const v = byYear.get(yr);
    if (v == null) continue;
    svg.append("circle").attr("cx", x(yr)).attr("cy", y(v)).attr("r", 3).attr("fill", color);
    let ly = y(v) - 10;
    while (labelYs.some((py) => Math.abs(py - ly) < 13)) ly -= 13;
    labelYs.push(ly);
    svg.append("text").attr("x", x(yr)).attr("y", Math.max(margin.top + 8, ly))
      .attr("text-anchor", "middle").attr("fill", "#e9eef7").attr("font-size", 10.5).attr("font-weight", 600)
      .text(valueFmt(v));
  }
  return svg;
}

function renderEconYardstick(economy) {
  const cpiMount = $("#econ-cpi");
  const fxMount = $("#econ-fx");
  if (!cpiMount && !fxMount) return;
  const cpi = economy?.cpi;
  if (cpiMount) {
    if (cpi?.status === "ok" && cpi.calendar_year?.length) {
      try {
        const last = cpi.calendar_year[cpi.calendar_year.length - 1];
        econLineChart(cpiMount, cpi.calendar_year, {
          color: "#ffb545",
          markers: [1970, 1990, 2020, last?.[0]],
          valueFmt: (v) => v.toFixed(1),
          axisFmt: (v) => v.toFixed(0),
        });
        setText("#econ-cpi-range", `${cpi.calendar_year[0][0]}–${last[0]}`);
        setText("#econ-cpi-source", `出典: ${cpi.source?.title || ""}。${cpi.note || ""}`);
      } catch (error) {
        console.error(error);
        cpiMount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>';
      }
    } else {
      cpiMount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>';
      setText("#econ-cpi-source", "出典を取得できませんでした。");
    }
  }
  const fx = economy?.fx_usdjpy;
  if (fxMount) {
    if (fx?.status === "ok" && fx.calendar_year?.length) {
      try {
        const last = fx.calendar_year[fx.calendar_year.length - 1];
        econLineChart(fxMount, fx.calendar_year, {
          color: "#4fd8ff",
          markers: [1960, 1973, 2011, last?.[0]],
          valueFmt: (v) => `${v.toFixed(1)}円`,
          axisFmt: (v) => v.toFixed(0),
        });
        setText("#econ-fx-range", `${fx.calendar_year[0][0]}–${last[0]}`);
        setText("#econ-fx-source", `出典: ${fx.source?.title || ""}。${fx.note || ""}`);
      } catch (error) {
        console.error(error);
        fxMount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>';
      }
    } else {
      fxMount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>';
      setText("#econ-fx-source", "出典を取得できませんでした。");
    }
  }
}

/* ================================================================= ledger */

function renderLedger(indicators, finance, publishing, funders, economy, startups, philanthropy) {
  const ledger = $("#ledger");
  if (!ledger) return;
  const entries = [];
  const push = (block) => {
    if (!block?.source?.title) return;
    entries.push({ title: block.source.title, url: block.source.url || "", status: block.status });
  };
  const ind = indicators || {};
  push(ind.funding_flow); push(ind.gov_spending_dest); push(ind.ministry_budget);
  push(ind.industry_academia); push(ind.joint_research); push(ind.kakenhi);
  push(ind.corporate_rd); push(ind.corporate_rd?.intl); push(ind.corporate_rd?.industries);
  push(ind.gov_support_business); push(ind.plan_budget);
  push(finance?.national); push(finance?.private); push(finance?.private?.sector); push(finance?.institutes);
  push(publishing?.subscription); push(publishing?.apc); push(publishing?.openalex);
  if (publishing?.contracts?.status === "ok") {
    entries.push({ title: "国立大学法人等の契約公表（各法人サイト・随意契約公表/落札公示）", url: "", status: "ok" });
  }
  push(funders?.dual_support); push(funders?.kakenhi_years); push(funders?.csti_programs);
  push(economy?.cpi); push(economy?.fx_usdjpy);
  push(startups);
  push(philanthropy);
  const seen = new Set();
  ledger.insertAdjacentHTML("beforeend", entries.filter((e) => !seen.has(e.title) && seen.add(e.title)).map((e) => `
    <div class="ledger-row">
      <span>${e.url ? `<a href="${escapeHtml(safeUrl(e.url))}" target="_blank" rel="noopener noreferrer">${escapeHtml(e.title)}</a>` : escapeHtml(e.title)}</span>
      <span class="ledger-status${e.status === "ok" ? "" : " is-na"}">${e.status === "ok" ? "接続中" : "未接続"}</span>
    </div>`).join(""));
}

/* ==================================================================== boot */

async function init() {
  setText("#footer-year", String(new Date().getFullYear()));
  initRail();
  let indicators = null;
  let finance = null;
  let publishing = null;
  let funders = null;
  let economy = null;
  let startups = null;
  let philanthropy = null;
  let sti = null;
  try {
    const [indicatorsResult, financeResult, publishingResult, fundersResult, economyResult, startupsResult, philanthropyResult, stiResult] = await Promise.allSettled([
      fetch("data/indicators.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))),
      fetch("data/finance.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))),
      fetch("data/publishing.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))),
      fetch("data/funders.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))),
      fetch("data/economy.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))),
      fetch("data/university_startups.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))),
      fetch("data/philanthropy.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))),
      fetch("data/science_technology_indicators.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))),
    ]);
    indicators = indicatorsResult.status === "fulfilled" ? indicatorsResult.value.indicators : null;
    finance = financeResult.status === "fulfilled" ? financeResult.value : null;
    publishing = publishingResult.status === "fulfilled" ? publishingResult.value : null;
    funders = fundersResult.status === "fulfilled" ? fundersResult.value : null;
    economy = economyResult.status === "fulfilled" ? economyResult.value : null;
    startups = startupsResult.status === "fulfilled" ? startupsResult.value : null;
    philanthropy = philanthropyResult.status === "fulfilled" ? philanthropyResult.value : null;
    sti = stiResult.status === "fulfilled" ? stiResult.value : null;
  } catch (error) {
    console.error(error);
  }
  if (!indicators) {
    setText("#header-status", "資金データを取得できません");
    return;
  }
  $("#header-status-dot")?.classList.add("is-live");
  const total = d3.sum(indicators.funding_flow?.links || [], (l) => l.value);
  setText("#header-status", `観測中 — 研究開発費${total ? choFromMillion(total) : ""} / 6系統の公開データ`);

  initFlowHero(indicators);
  renderGovStream(indicators);
  renderMinistryStream(indicators);
  renderSangaku(indicators);
  safeCall("renderUniversityStartups", () => renderUniversityStartups(startups));
  safeCall("renderKakenhi", () => renderKakenhi(indicators, funders));
  safeCall("renderKakenhiTrend", () => renderKakenhiTrend(funders));
  safeCall("renderCorporateRd", () => renderCorporateRd(indicators));
  safeCall("renderStiMoney", () => renderStiMoney(sti));
  renderSupportScatter(indicators);
  renderPlanBars(indicators);
  renderNatlScatter(finance);
  renderPrivBars(finance);
  renderInstitutes(finance);
  renderSectorLines(finance);
  initAnatomy(finance);
  renderPublishing(publishing);
  safeCall("renderPhilanthropy", () => renderPhilanthropy(finance, philanthropy));
  safeCall("renderFundingDualStream", () => renderFundingDualStream(funders));
  safeCall("renderFundingCsti", () => renderFundingCsti(funders));
  safeCall("renderEconYardstick", () => renderEconYardstick(economy));
  renderLedger(indicators, finance, publishing, funders, economy, startups, philanthropy);
}

init().catch((error) => {
  console.error(error);
  setText("#header-status", "資金データを取得できません");
});
