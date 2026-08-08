/* SCIENCE SIGNAL / MONEY — 研究開発資金の観測ページ */
"use strict";

const d3 = window.d3;
const gsap = window.gsap;
if (gsap && window.ScrollTrigger) gsap.registerPlugin(window.ScrollTrigger);

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[ch]));
const safeUrl = (value = "") => (/^https?:\/\//.test(value) ? value : "#");
const setText = (selector, text) => { const node = $(selector); if (node) node.textContent = text; };
const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const MOBILE = window.matchMedia("(max-width: 760px)").matches;

const fmtInt = (value) => Number(value ?? 0).toLocaleString("ja-JP");
const fmtPct = (value, digits = 1) => `${Number(value).toFixed(digits)}%`;
const choFromMillion = (v) => `${(v / 1e6).toFixed(v >= 1e6 ? 1 : 2)}兆円`;
const okuFromMillion = (v) => `${fmtInt(Math.round(v / 100))}億円`;
const okuFromThousand = (v) => `${fmtInt(Math.round(v / 1e5))}億円`;
const choFromOku = (v) => `${(v / 1e4).toFixed(1)}兆円`;

function fitCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width: rect.width, height: rect.height };
}

function baseAxis(g) {
  g.select(".domain").remove();
  g.selectAll("line").attr("stroke", "#16202f").attr("stroke-dasharray", "2 4");
  return g;
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
  const title = $("#flow-title");
  if (title) title.innerHTML = `研究開発費<em>${choFromMillion(total)}</em>。<br />政府のカネは、<em>${choFromMillion(gov)}</em>。`;
  setText("#flow-lede", `${funding.year_label}、負担部門から使用部門への研究開発費の流れ。政府負担は全体の${fmtPct((gov / total) * 100)}。粒子1つ＝250億円。`);
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
  setText("#gov-lede", `${first.year}年度、政府マネーの${fmtPct(first["大学"])}は大学で使われていた。${last.year}年度は${fmtPct(last["大学"])}。企業へは${fmtPct(first["企業"])}→${fmtPct(last["企業"])}。`);
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

/* ============================================================== 04 kakenhi */

function renderKakenhi(indicators) {
  const mount = $("#kakenhi-chart");
  const block = indicators?.kakenhi;
  if (!mount) return;
  if (!block || block.status !== "ok") {
    mount.innerHTML = '<p class="data-empty">科研費の機関別データは接続作業中。日本学術振興会の配分結果（機関別採択件数・配分額）を確認しだい、ここに機関別の配分を表示する。</p>';
    setText("#kakenhi-source", "出典（予定）: 日本学術振興会 科研費データ（機関別採択件数・配分額）");
    return;
  }
  mount.innerHTML = "";
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

function renderInstLines(finance) {
  const mount = $("#inst-lines");
  const block = finance?.institutes;
  if (!mount || !block || block.status !== "ok") { if (mount) mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>'; return; }
  mount.innerHTML = "";
  const palette = { riken: "#ffb545", aist: "#4fd8ff" };
  const width = mount.clientWidth || 560, height = Math.max(320, width * 0.58);
  const margin = { top: 24, right: 120, bottom: 32, left: 52 };
  const points = [];
  for (const inst of block.institutes || []) {
    for (const [year, entry] of Object.entries(inst.values)) {
      points.push({ id: inst.id, year: +year, revenue: entry.revenue_total, grants: entry.grants });
    }
  }
  const x = d3.scaleLinear().domain(d3.extent(points, (p) => p.year)).range([margin.left, width - margin.right]);
  const y = d3.scaleLinear().domain([0, d3.max(points, (p) => p.revenue) * 1.08]).range([height - margin.bottom, margin.top]);
  const svg = d3.select(mount).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img")
    .attr("aria-label", "理研と産総研の経常収益・運営費交付金の推移");
  baseAxis(svg.append("g").attr("class", "axis").attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(5).tickFormat((v) => `${Math.round(v / 1e8)}億`).tickSize(-(width - margin.left - margin.right))));
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).ticks(6).tickFormat(d3.format("d"))).select(".domain").attr("stroke", "#1c2839");
  for (const inst of block.institutes || []) {
    const series = Object.entries(inst.values).map(([year, entry]) => ({ year: +year, revenue: entry.revenue_total, grants: entry.grants })).sort((a, b) => a.year - b.year);
    const color = palette[inst.id] || "#8b96ab";
    svg.append("path").attr("d", d3.line().x((p) => x(p.year)).y((p) => y(p.revenue)).curve(d3.curveMonotoneX)(series.filter((p) => p.revenue != null)))
      .attr("fill", "none").attr("stroke", color).attr("stroke-width", 2.2);
    svg.append("path").attr("d", d3.line().x((p) => x(p.year)).y((p) => y(p.grants)).curve(d3.curveMonotoneX)(series.filter((p) => p.grants != null)))
      .attr("fill", "none").attr("stroke", color).attr("stroke-width", 1.1).attr("stroke-dasharray", "3 4").attr("opacity", 0.7);
    const last = series[series.length - 1];
    svg.append("text").attr("x", x(last.year) + 7).attr("y", y(last.revenue) + 4)
      .attr("fill", color).attr("font-size", 11).attr("font-weight", 600).text(`${{ riken: "理研", aist: "産総研" }[inst.id] || inst.label} ${Math.round(last.revenue / 1e8)}億`);
    svg.append("text").attr("x", x(last.year) + 7).attr("y", y(last.grants) + 4)
      .attr("fill", color).attr("font-size", 9).attr("opacity", 0.75).text(`交付金 ${Math.round(last.grants / 1e8)}億`);
  }
  setText("#inst-source", `出典: ${block.source?.title || ""}。実線=経常収益、点線=運営費交付金収益。${block.note || ""}`);
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
  { key: "hospital", label: "附属病院", color: "#e0797a" },
  { key: "external", label: "外部資金（受託・共同・寄付）", color: "#5ad8a1" },
  { key: "other", label: "その他", color: "#59687f" },
];

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
  return entities;
}

function glyphSvg(entity, selected) {
  const shares = BUCKETS.map((b) => (entity.buckets[b.key] || 0) / entity.revenue);
  const R = Math.max(9, Math.min(31, Math.sqrt(entity.revenue / 1e9) * 2.1));
  const size = 66;
  const cx = size / 2, cy = size / 2;
  const petals = BUCKETS.map((bucket, index) => {
    const share = shares[index];
    if (share <= 0.004) return "";
    const radius = Math.max(2, R * Math.sqrt(share) * 1.9);
    const a0 = (index / BUCKETS.length) * Math.PI * 2 - Math.PI / 2 + 0.09;
    const a1 = ((index + 1) / BUCKETS.length) * Math.PI * 2 - Math.PI / 2 - 0.09;
    const x0 = cx + Math.cos(a0) * radius, y0 = cy + Math.sin(a0) * radius;
    const x1 = cx + Math.cos(a1) * radius, y1 = cy + Math.sin(a1) * radius;
    return `<path d="M${cx},${cy} L${x0.toFixed(1)},${y0.toFixed(1)} A${radius.toFixed(1)},${radius.toFixed(1)} 0 0 1 ${x1.toFixed(1)},${y1.toFixed(1)} Z" fill="${bucket.color}" opacity="${selected ? 0.95 : 0.78}"/>`;
  }).join("");
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true"><circle cx="${cx}" cy="${cy}" r="1.4" fill="#8b96ab"/>${petals}</svg>`;
}

function initAnatomy(finance) {
  const gallery = $("#glyph-gallery");
  const panel = $("#anatomy-panel");
  if (!gallery || !panel) return;
  const entities = buildEntities(finance);
  if (!entities.length) { gallery.innerHTML = '<p class="data-empty">財務データを取得できませんでした。</p>'; return; }
  let selectedId = (entities.find((e) => e.label === "東京大学") || entities[0]).id;
  let sortKey = "revenue";

  const legend = $("#glyph-legend");
  if (legend) legend.innerHTML = BUCKETS.map((b) => `<span><i style="background:${b.color}"></i>${b.label}</span>`).join("");

  const sortValue = (entity) => {
    if (sortKey === "revenue") return entity.revenue;
    return (entity.buckets[sortKey] || 0) / entity.revenue;
  };

  function renderGallery() {
    const sorted = [...entities].sort((a, b) => sortValue(b) - sortValue(a));
    gallery.innerHTML = sorted.map((entity) => {
      const selected = entity.id === selectedId;
      const shortLabel = entity.label.replace(/大学$/, "").replace("国立大学機構", "機構");
      const pct = sortKey === "revenue" ? `${(entity.revenue / 1e8).toFixed(0)}億円` : fmtPct(((entity.buckets[sortKey] || 0) / entity.revenue) * 100);
      return `<button class="glyph${selected ? " is-selected" : ""}" role="option" aria-selected="${selected}" data-id="${entity.id}" title="${escapeHtml(entity.label)}（${escapeHtml(entity.sector)}） ${pct}">${glyphSvg(entity, selected)}<small>${escapeHtml(shortLabel)}</small></button>`;
    }).join("");
    if (!REDUCED && gsap) {
      gsap.from(gallery.children, { opacity: 0, scale: 0.6, duration: 0.5, stagger: 0.004, ease: "power2.out" });
    }
  }

  function renderPanel() {
    const entity = entities.find((e) => e.id === selectedId);
    if (!entity) return;
    const oku = (v) => (v == null ? "—" : `${(v / 1e8).toLocaleString("ja-JP", { maximumFractionDigits: v < 1e9 ? 1 : 0 })}億円`);
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
      </div>
      <div class="anatomy-grid">
        <div class="anatomy-col"><h4>収益の内訳</h4>${rows(entity.revenueItems, entity.revenue, "その他収益")}</div>
        <div class="anatomy-col"><h4>費用の内訳</h4>${rows(entity.expenseItems, entity.expenseTotal, entity.expenseResidualLabel)}${trendSvg}</div>
      </div>
      ${entity.note ? `<p class="method-note">${escapeHtml(entity.note)}</p>` : ""}`;
  }

  gallery.addEventListener("click", (event) => {
    const button = event.target.closest(".glyph");
    if (!button) return;
    selectedId = button.dataset.id;
    $$("#glyph-gallery .glyph").forEach((g) => {
      const on = g.dataset.id === selectedId;
      g.classList.toggle("is-selected", on);
      g.setAttribute("aria-selected", on ? "true" : "false");
    });
    renderPanel();
  });
  $$("#glyph-sort button").forEach((button) => {
    button.addEventListener("click", () => {
      sortKey = button.dataset.sort;
      $$("#glyph-sort button").forEach((b) => b.classList.toggle("is-active", b === button));
      renderGallery();
    });
  });

  renderGallery();
  renderPanel();
  const natl = entities.filter((e) => e.sector === "国立").length;
  const priv = entities.length - natl;
  setText("#anatomy-lede", `国立${natl}法人＋主要私立${priv}法人の収入構成を、ひとつずつ「かたち」にした。花弁の向きが財源、大きさが割合、全体の大きさが収益規模。かたちが似ている法人は、財務構造が似ている。クリックで内訳まで開く。`);
  setText("#anatomy-source", "出典: 国立=NIAD 法人別概要財務諸表（2024年度・千円を円換算）、私立=各学校法人の開示（2025年度）。会計基準が異なるため（国立大学法人会計基準/学校法人会計基準）、区分は概念的に対応付けたもの。私立の附属病院収入は内訳非開示のため「その他」に含まれる。");
}

/* ================================================================= ledger */

function renderLedger(indicators, finance) {
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
  push(ind.gov_support_business); push(ind.plan_budget);
  push(finance?.national); push(finance?.private); push(finance?.private?.sector); push(finance?.institutes);
  const seen = new Set();
  ledger.insertAdjacentHTML("beforeend", entries.filter((e) => !seen.has(e.title) && seen.add(e.title)).map((e) => `
    <div class="ledger-row">
      <span>${e.url ? `<a href="${escapeHtml(safeUrl(e.url))}" target="_blank" rel="noopener noreferrer">${escapeHtml(e.title)}</a>` : escapeHtml(e.title)}</span>
      <span class="ledger-status${e.status === "ok" ? "" : " is-na"}">${e.status === "ok" ? "接続中" : "未接続"}</span>
    </div>`).join(""));
}

function initRail() {
  const links = $$(".chapter-rail a");
  if (!links.length) return;
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        links.forEach((link) => link.classList.toggle("is-active", link.dataset.rail === entry.target.id));
      }
    }
  }, { rootMargin: "-38% 0px -52% 0px" });
  $$(".chapter").forEach((section) => observer.observe(section));
}

/* ==================================================================== boot */

async function init() {
  setText("#footer-year", String(new Date().getFullYear()));
  initRail();
  let indicators = null;
  let finance = null;
  try {
    const [indicatorsResult, financeResult] = await Promise.allSettled([
      fetch("data/indicators.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))),
      fetch("data/finance.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))),
    ]);
    indicators = indicatorsResult.status === "fulfilled" ? indicatorsResult.value.indicators : null;
    finance = financeResult.status === "fulfilled" ? financeResult.value : null;
  } catch (error) {
    console.error(error);
  }
  if (!indicators) {
    setText("#header-status", "資金データを取得できません");
    return;
  }
  $("#header-status-dot")?.classList.add("is-live");
  const total = d3.sum(indicators.funding_flow?.links || [], (l) => l.value);
  setText("#header-status", `観測中 — 研究開発費${total ? choFromMillion(total) : ""} / 6系統の一次データ`);

  initFlowHero(indicators);
  renderGovStream(indicators);
  renderMinistryStream(indicators);
  renderSangaku(indicators);
  renderKakenhi(indicators);
  renderSupportScatter(indicators);
  renderPlanBars(indicators);
  renderNatlScatter(finance);
  renderPrivBars(finance);
  renderInstLines(finance);
  renderSectorLines(finance);
  initAnatomy(finance);
  renderLedger(indicators, finance);
}

init().catch((error) => {
  console.error(error);
  setText("#header-status", "資金データを取得できません");
});
