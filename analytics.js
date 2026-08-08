/* THE OBSERVATORY — 日本の科学技術観測室
   Layers: Canvas2D (mass/light) + SVG (crisp annotation) + GSAP ScrollTrigger (scroll choreography). */
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

const COLORS = { jp: "#ffb545", us: "#a7b4cc", de: "#64748f", fr: "#59687f", gb: "#71809b", cn: "#4fd8ff", kr: "#8d7fb0", eu27: "#445370" };
const SHORT = { jp: "日本", us: "米国", de: "独", fr: "仏", gb: "英", cn: "中国", kr: "韓", eu27: "EU" };

const fmtInt = (value) => Number(value ?? 0).toLocaleString("ja-JP");
const fmtPct = (value, digits = 1) => `${Number(value).toFixed(digits)}%`;
const fmtMan = (value) => `${(value / 10000).toFixed(1)}万`;
const fmtCho = (millionYen) => `${(millionYen / 1e6).toFixed(1)}兆円`;
const shortDate = (iso) => {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric" }).format(date);
};

/* Compact 3D value-noise (fractal) — deterministic, dependency-free. */
const noise3 = (() => {
  const perm = new Uint8Array(512);
  let seed = 1349;
  for (let i = 0; i < 256; i += 1) perm[i] = i;
  for (let i = 255; i > 0; i -= 1) {
    seed = (seed * 16807) % 2147483647;
    const j = seed % (i + 1);
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  for (let i = 0; i < 256; i += 1) perm[i + 256] = perm[i];
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a, b, t) => a + (b - a) * t;
  const grad = (hash, x, y, z) => {
    const h = hash & 15;
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  };
  return (x, y, z) => {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
    x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
    const u = fade(x), v = fade(y), w = fade(z);
    const A = perm[X] + Y, AA = perm[A] + Z, AB = perm[A + 1] + Z;
    const B = perm[X + 1] + Y, BA = perm[B] + Z, BB = perm[B + 1] + Z;
    return lerp(
      lerp(lerp(grad(perm[AA], x, y, z), grad(perm[BA], x - 1, y, z), u), lerp(grad(perm[AB], x, y - 1, z), grad(perm[BB], x - 1, y - 1, z), u), v),
      lerp(lerp(grad(perm[AA + 1], x, y, z - 1), grad(perm[BA + 1], x - 1, y, z - 1), u), lerp(grad(perm[AB + 1], x, y - 1, z - 1), grad(perm[BB + 1], x - 1, y - 1, z - 1), u), v),
      w,
    );
  };
})();

function fitCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width: rect.width, height: rect.height };
}

const seriesMap = (block, name = "series") => Object.fromEntries((block?.[name] || []).map((s) => [s.key, s.values]));
const lastPoint = (values = []) => values[values.length - 1];

/* ================================================================ 00 HERO */

function initHero(indicators, updates) {
  const canvas = $("#hero-canvas");
  if (!canvas) return;
  let { ctx, width, height } = fitCanvas(canvas);
  const count = REDUCED ? 0 : MOBILE ? 320 : 950;
  const particles = [];
  for (let i = 0; i < count; i += 1) {
    particles.push({
      x: Math.random() * width, y: Math.random() * height,
      speed: 0.25 + Math.random() * 0.9,
      amber: Math.random() < 0.14,
      size: 0.5 + Math.random() * 1.1,
      life: Math.random() * 400,
    });
  }
  let frame = 0;
  let running = true;

  function step() {
    if (!running) return;
    frame += 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "rgba(6, 9, 15, 0.085)";
    ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = "lighter";
    const t = frame * 0.0016;
    for (const p of particles) {
      const angle = noise3(p.x * 0.0011, p.y * 0.0011, t) * Math.PI * 3.2;
      p.x += Math.cos(angle) * p.speed;
      p.y += Math.sin(angle) * p.speed * 0.85;
      p.life -= 1;
      if (p.x < -8 || p.x > width + 8 || p.y < -8 || p.y > height + 8 || p.life < 0) {
        p.x = Math.random() * width; p.y = Math.random() * height; p.life = 240 + Math.random() * 400;
      }
      ctx.fillStyle = p.amber ? "rgba(255, 181, 69, 0.55)" : "rgba(110, 145, 195, 0.28)";
      ctx.fillRect(p.x, p.y, p.size, p.size);
    }
    requestAnimationFrame(step);
  }

  if (REDUCED) {
    ctx.fillStyle = "rgba(6, 9, 15, 1)";
    ctx.fillRect(0, 0, width, height);
    for (let i = 0; i < 1400; i += 1) {
      const amber = Math.random() < 0.12;
      ctx.fillStyle = amber ? "rgba(255, 181, 69, 0.4)" : "rgba(110, 145, 195, 0.22)";
      ctx.fillRect(Math.random() * width, Math.random() * height, 1.1, 1.1);
    }
  } else {
    const observer = new IntersectionObserver((entries) => {
      const visible = entries[0]?.isIntersecting && !document.hidden;
      if (visible && !running) { running = true; step(); }
      else if (!visible) running = false;
    }, { threshold: 0.02 });
    observer.observe(canvas);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) running = false;
      else if (!running) { running = true; step(); }
    });
    step();
  }

  window.addEventListener("resize", () => { ({ ctx, width, height } = fitCanvas(canvas)); }, { passive: true });

  /* Readouts — every number carries its own year. */
  const gerd = lastPoint(seriesMap(indicators?.oecd_gerd_gdp).jp || seriesMap(indicators?.gerd_gdp).jp);
  const papersSeries = (seriesMap(indicators?.openalex, "by_year").jp || []).filter(([year]) => year < (indicators?.openalex?.partial_year || 9999));
  const papers = lastPoint(papersSeries);
  const phdRows = indicators?.phd_enrollment?.rows || [];
  const phd = phdRows[phdRows.length - 1];
  const signals = updates ? updates.item_count ?? (updates.items || []).length : null;

  const ticker = (selector, target, format) => {
    const node = $(selector);
    if (!node || target == null) return;
    if (REDUCED || !gsap) { node.textContent = format(target); return; }
    const state = { v: 0 };
    gsap.to(state, {
      v: target, duration: 1.9, ease: "power3.out", delay: 0.3,
      onUpdate: () => { node.textContent = format(state.v); },
      onComplete: () => { node.textContent = format(target); },
    });
  };
  if (gerd) { ticker("#ro-gerd", gerd[1], (v) => `${v.toFixed(2)}%`); setText("#ro-gerd-note", `${gerd[0]}年 / OECD`); }
  if (papers) { ticker("#ro-papers", papers[1], (v) => fmtMan(v)); setText("#ro-papers-note", `${papers[0]}年 / OpenAlex`); }
  if (phd) { ticker("#ro-phd", phd.total, (v) => fmtInt(Math.round(v))); setText("#ro-phd-note", `${phd.year}年度 / 学校基本調査`); }
  if (signals != null) { ticker("#ro-signals", signals, (v) => `${Math.round(v)}件`); setText("#ro-signals-note", "政府公式 / 3時間ごと更新"); }

  const shareValues = seriesMap(indicators?.papers, "share").jp || [];
  if (shareValues.length) {
    const peak = shareValues.reduce((a, b) => (b[1] > a[1] ? b : a));
    const last = lastPoint(shareValues);
    const title = $("#hero-title");
    if (title) title.innerHTML = `論文シェア、<em>${fmtPct(peak[1])}</em> → <em>${fmtPct(last[1])}</em>。`;
    setText("#hero-lede", `日本が世界の論文に占める割合、${peak[0]}年から${last[0]}年。研究費・人材・論文・政策の40年を、一次データだけで描く。`);
  }
}

/* ================================================================ 01 RACE */

function initRace(indicators) {
  const stage = $("#race-stage");
  const canvas = $("#race-canvas");
  const svg = d3.select("#race-svg");
  const block = indicators?.papers;
  if (!stage || !canvas || !block || block.status !== "ok") {
    if (stage) stage.innerHTML = '<p class="data-empty">論文シェアのデータを取得できませんでした。</p>';
    return;
  }
  const KEYS = ["jp", "us", "de", "fr", "gb", "cn", "kr"];
  let metric = "share";
  let progress = REDUCED ? 1 : 0;
  let geom = null;

  const margin = { top: 46, right: 92, bottom: 68, left: 54 };

  function metricData() {
    return seriesMap(block, metric);
  }

  function computeEvents(data) {
    const jp = data.jp || [], cn = data.cn || [], us = data.us || [];
    const byYear = (values) => Object.fromEntries(values.map(([y, v]) => [y, v]));
    const cnMap = byYear(cn), jpMap = byYear(jp), usMap = byYear(us);
    const events = [];
    if (jp.length) {
      const peak = jp.reduce((a, b) => (b[1] > a[1] ? b : a));
      events.push({ year: peak[0], key: "jp", text: `日本のシェアが最大に。${fmtPct(peak[1])}`, sub: `${peak[0]}年` });
    }
    const cnOverJp = cn.find(([y, v]) => jpMap[y] != null && v > jpMap[y]);
    if (cnOverJp) events.push({ year: cnOverJp[0], key: "cn", text: "中国が日本を追い抜く。", sub: `${cnOverJp[0]}年` });
    const cnOverUs = cn.find(([y, v]) => usMap[y] != null && v > usMap[y]);
    if (cnOverUs) events.push({ year: cnOverUs[0], key: "cn", text: "中国が米国を抜き、世界最大の論文生産国に。", sub: `${cnOverUs[0]}年` });
    const last = lastPoint(jp);
    if (last) {
      const rank = 1 + KEYS.filter((k) => k !== "jp" && (byYear(data[k] || [])[last[0]] ?? -1) > last[1]).length;
      events.push({ year: last[0], key: "jp", text: `${last[0]}年、日本は7か国中${rank}位。${fmtPct(last[1])}`, sub: "整数カウント・3年移動平均" });
    }
    return events.sort((a, b) => a.year - b.year);
  }

  function build() {
    const { ctx, width, height } = fitCanvas(canvas);
    const data = metricData();
    const years = d3.extent(KEYS.flatMap((k) => (data[k] || []).map(([y]) => y)));
    const maxValue = d3.max(KEYS.flatMap((k) => (data[k] || []).map(([, v]) => v))) || 1;
    const x = d3.scaleLinear().domain(years).range([margin.left, width - margin.right]);
    const y = d3.scaleLinear().domain([0, maxValue * 1.06]).range([height - margin.bottom, margin.top]);
    geom = { ctx, width, height, data, years, x, y, events: computeEvents(data) };

    svg.selectAll("*").remove();
    svg.attr("viewBox", `0 0 ${width} ${height}`);
    const gy = svg.append("g").attr("class", "axis").attr("transform", `translate(${margin.left},0)`)
      .call(d3.axisLeft(y).ticks(5).tickSize(-(width - margin.left - margin.right)).tickFormat((v) => `${v}%`));
    gy.select(".domain").remove();
    gy.selectAll("line").attr("stroke", "#16202f").attr("stroke-dasharray", "2 4");
    const gx = svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - margin.bottom})`)
      .call(d3.axisBottom(x).ticks(MOBILE ? 5 : 9).tickFormat(d3.format("d")));
    gx.select(".domain").attr("stroke", "#1c2839");

    const legend = $("#race-legend");
    if (legend) {
      legend.innerHTML = KEYS.map((k) => `<div class="lg${k === "jp" ? " is-jp" : ""}"><i style="background:${COLORS[k]}"></i>${SHORT[k]}</div>`).join("");
    }
    draw();
  }

  function draw() {
    if (!geom) return;
    const { ctx, width, height, data, years, x, y, events } = geom;
    const currentYear = years[0] + (years[1] - years[0]) * progress;
    ctx.clearRect(0, 0, width, height);

    for (const key of KEYS) {
      const values = (data[key] || []).filter(([yr]) => yr <= currentYear);
      if (values.length < 2) continue;
      const hero = key === "jp" || key === "cn";
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      /* halo pass */
      if (hero) {
        ctx.beginPath();
        values.forEach(([yr, v], i) => { const px = x(yr), py = y(v); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
        ctx.strokeStyle = key === "jp" ? "rgba(255,181,69,0.16)" : "rgba(79,216,255,0.13)";
        ctx.lineWidth = 9;
        ctx.stroke();
      }
      ctx.beginPath();
      values.forEach(([yr, v], i) => { const px = x(yr), py = y(v); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
      ctx.strokeStyle = COLORS[key];
      ctx.lineWidth = hero ? 2.4 : 1.2;
      ctx.globalAlpha = hero ? 1 : 0.75;
      ctx.stroke();
      ctx.globalAlpha = 1;

      const tip = values[values.length - 1];
      ctx.beginPath();
      ctx.arc(x(tip[0]), y(tip[1]), hero ? 3.4 : 2.2, 0, Math.PI * 2);
      ctx.fillStyle = COLORS[key];
      ctx.fill();
      ctx.font = `${hero ? 600 : 400} 11px "IBM Plex Mono", monospace`;
      ctx.fillStyle = hero ? COLORS[key] : "rgba(139,150,171,0.9)";
      ctx.fillText(`${SHORT[key]} ${tip[1].toFixed(1)}`, x(tip[0]) + 8, y(tip[1]) + 4);
    }

    setText("#race-year", String(Math.round(currentYear)));

    const annot = $("#race-annot");
    if (annot) {
      const active = [...events].reverse().find((event) => currentYear >= event.year && currentYear <= event.year + (years[1] - years[0]) * 0.24 + 0.01);
      if (active) {
        const values = data[active.key] || [];
        const at = values.find(([yr]) => yr === active.year) || lastPoint(values);
        const px = geom.x(active.year), py = at ? geom.y(at[1]) : geom.height / 2;
        annot.style.left = `${Math.min(Math.max(px + 14, 16), geom.width - 320)}px`;
        annot.style.top = `${Math.min(Math.max(py - 80, 60), geom.height - 160)}px`;
        annot.style.borderLeftColor = COLORS[active.key];
        annot.innerHTML = `${escapeHtml(active.text)}<small>${escapeHtml(active.sub)}</small>`;
        annot.classList.add("is-on");
      } else {
        annot.classList.remove("is-on");
      }
    }
  }

  build();
  setText("#race-source", `出典: ${block.source?.title || "NISTEP"} / ${block.note || ""}`);
  const jpShare = seriesMap(block, "share").jp || [];
  if (jpShare.length) {
    setText("#race-lede-fact", `1982年に${fmtPct(jpShare[0][1])}だった日本は、いま${fmtPct(lastPoint(jpShare)[1])}。`);
  }

  $$("#race-metric button").forEach((button) => {
    button.addEventListener("click", () => {
      $$("#race-metric button").forEach((b) => { b.classList.toggle("is-active", b === button); b.setAttribute("aria-selected", b === button ? "true" : "false"); });
      metric = button.dataset.metric;
      build();
    });
  });

  if (!REDUCED && gsap && window.ScrollTrigger) {
    window.ScrollTrigger.create({
      trigger: "#race-track",
      start: "top top+=110",
      end: "+=260%",
      pin: stage,
      scrub: 0.6,
      onUpdate: (self) => { progress = self.progress; draw(); },
    });
  }
  window.addEventListener("resize", () => build(), { passive: true });
}

/* ================================================================ 02 PHD */

function renderPhdIntl(indicators) {
  const mount = $("#phd-intl");
  const block = indicators?.phd_degrees;
  if (!mount || !block || block.status !== "ok") { if (mount) mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>'; return; }
  mount.innerHTML = "";
  const data = seriesMap(block);
  const KEYS = Object.keys(data).filter((k) => COLORS[k]);
  const indexed = {};
  const baseExceptions = [];
  for (const key of KEYS) {
    const base = data[key].find(([yr]) => yr === 2000) || data[key][0];
    if (base[0] !== 2000) baseExceptions.push(`${SHORT[key]}は${base[0]}年=100（データ開始年）`);
    indexed[key] = data[key].map(([yr, v]) => [yr, (v / base[1]) * 100]);
  }
  const width = mount.clientWidth || 560, height = Math.max(340, width * 0.62);
  const margin = { top: 24, right: 78, bottom: 34, left: 44 };
  const years = d3.extent(KEYS.flatMap((k) => indexed[k].map(([y]) => y)));
  const x = d3.scaleLinear().domain(years).range([margin.left, width - margin.right]);
  const maxV = d3.max(KEYS.flatMap((k) => indexed[k].map(([, v]) => v)));
  const y = d3.scaleLinear().domain([40, maxV * 1.05]).range([height - margin.bottom, margin.top]);
  const svg = d3.select(mount).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img")
    .attr("aria-label", "主要国の博士号取得者数の推移を2000年を100として指数化した折れ線グラフ。日本のみが減少している。");
  const gy = svg.append("g").attr("class", "axis").attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(5).tickSize(-(width - margin.left - margin.right)));
  gy.select(".domain").remove();
  gy.selectAll("line").attr("stroke", "#16202f").attr("stroke-dasharray", "2 4");
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).ticks(6).tickFormat(d3.format("d"))).select(".domain").attr("stroke", "#1c2839");
  svg.append("line").attr("x1", margin.left).attr("x2", width - margin.right).attr("y1", y(100)).attr("y2", y(100))
    .attr("stroke", "#4c5a72").attr("stroke-dasharray", "3 4");
  svg.append("text").attr("x", margin.left + 4).attr("y", y(100) - 6).attr("class", "annot-sub").text("2000年 = 100");

  const line = d3.line().x(([yr]) => x(yr)).y(([, v]) => y(v)).curve(d3.curveMonotoneX);
  /* spread endpoint labels so they never overlap */
  const tips = KEYS.map((key) => ({ key, y: y(lastPoint(indexed[key])[1]) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < tips.length; i += 1) {
    if (tips[i].y - tips[i - 1].y < 13) tips[i].y = tips[i - 1].y + 13;
  }
  const tipY = Object.fromEntries(tips.map((t) => [t.key, t.y]));
  for (const key of KEYS) {
    const isJp = key === "jp";
    const path = svg.append("path").attr("d", line(indexed[key]))
      .attr("fill", "none").attr("stroke", COLORS[key])
      .attr("stroke-width", isJp ? 2.6 : 1.2).attr("opacity", isJp ? 1 : 0.65);
    if (isJp) path.attr("filter", "drop-shadow(0 0 6px rgba(255,181,69,0.55))");
    if (!REDUCED && gsap) {
      const length = path.node().getTotalLength();
      path.attr("stroke-dasharray", length).attr("stroke-dashoffset", length);
      gsap.to(path.node(), { strokeDashoffset: 0, duration: isJp ? 2.2 : 1.6, ease: "power2.out", scrollTrigger: { trigger: mount, start: "top 75%" }, delay: isJp ? 0.35 : 0 });
    }
    const tip = lastPoint(indexed[key]);
    const raw = lastPoint(data[key]);
    svg.append("text").attr("x", x(tip[0]) + 7).attr("y", tipY[key] + 4)
      .attr("fill", isJp ? COLORS.jp : "#8b96ab").attr("font-size", isJp ? 12 : 10).attr("font-weight", isJp ? 600 : 400)
      .text(`${SHORT[key]} ${Math.round(tip[1])}`)
      .append("title").text(`${SHORT[key]} ${raw[0]}年: ${fmtInt(raw[1])}人`);
  }
  const jpLast = lastPoint(indexed.jp || []);
  if (jpLast) {
    setText("#phd-lede", `2000年を100とすると、${jpLast[0]}年の日本は${Math.round(jpLast[1])}。主要7か国で減少しているのは日本だけ。`);
  }
  setText("#phd-intl-source", `出典: ${block.source?.title || ""}。${block.note || ""}${baseExceptions.length ? ` ${baseExceptions.join("、")}。` : ""}`);
}

function renderPhdStream(indicators) {
  const mount = $("#phd-stream");
  const block = indicators?.phd_enrollment;
  if (!mount || !block || block.status !== "ok") { if (mount) mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>'; return; }
  mount.innerHTML = "";
  const rows = block.rows;
  const fields = Object.keys(rows[rows.length - 1].fields);
  const palette = ["#4f7ca6", "#5fb3c9", "#4fd8ff", "#8d7fb0", "#7f96c9", "#5ad8a1", "#c9a76a", "#a06a8c", "#64748f", "#46536b"];
  const color = d3.scaleOrdinal().domain(fields).range(palette);
  const width = mount.clientWidth || 560, height = Math.max(340, width * 0.62);
  const margin = { top: 20, right: 16, bottom: 34, left: 44 };
  const stack = d3.stack().keys(fields).value((row, key) => row.fields[key] ?? 0);
  const series = stack(rows);
  const x = d3.scaleLinear().domain(d3.extent(rows, (r) => r.year)).range([margin.left, width - margin.right]);
  const y = d3.scaleLinear().domain([0, d3.max(rows, (r) => r.total) * 1.05]).range([height - margin.bottom, margin.top]);
  const svg = d3.select(mount).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img")
    .attr("aria-label", "日本の博士課程入学者数の専攻別積み上げ推移。2003年をピークに減少している。");
  const gy = svg.append("g").attr("class", "axis").attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(5).tickFormat((v) => fmtMan(v)).tickSize(-(width - margin.left - margin.right)));
  gy.select(".domain").remove();
  gy.selectAll("line").attr("stroke", "#16202f").attr("stroke-dasharray", "2 4");
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).ticks(6).tickFormat(d3.format("d"))).select(".domain").attr("stroke", "#1c2839");
  const area = d3.area().x((d) => x(d.data.year)).y0((d) => y(d[0])).y1((d) => y(d[1])).curve(d3.curveMonotoneX);
  const layers = svg.append("g");
  layers.selectAll("path").data(series).join("path")
    .attr("d", area).attr("fill", (d) => color(d.key)).attr("opacity", 0.82)
    .append("title").text((d) => d.key);
  const peak = rows.reduce((a, b) => (b.total > a.total ? b : a));
  const peakTextY = Math.max(16, y(peak.total) - 40);
  svg.append("line").attr("class", "annot-line").attr("x1", x(peak.year)).attr("x2", x(peak.year)).attr("y1", y(peak.total)).attr("y2", peakTextY + 6);
  svg.append("text").attr("class", "annot-text").attr("x", Math.min(x(peak.year) + 6, width - 230)).attr("y", peakTextY)
    .text(`ピークは${peak.year}年 ${fmtInt(peak.total)}人`);
  const last = rows[rows.length - 1];
  svg.append("text").attr("class", "annot-sub").attr("x", x(last.year) - 4).attr("y", y(last.total) - 10).attr("text-anchor", "end")
    .text(`${last.year}年 ${fmtInt(last.total)}人`);
  /* legend: top 5 fields by final size */
  const topFields = [...fields].sort((a, b) => (last.fields[b] ?? 0) - (last.fields[a] ?? 0)).slice(0, 5);
  const legend = svg.append("g").attr("transform", `translate(${margin.left + 8},${margin.top + 2})`);
  topFields.forEach((field, i) => {
    const row = legend.append("g").attr("transform", `translate(0,${i * 16})`);
    row.append("rect").attr("width", 9).attr("height", 9).attr("y", -8).attr("fill", color(field));
    row.append("text").attr("x", 14).attr("font-size", 10).attr("fill", "#8b96ab").text(`${field} ${fmtInt(last.fields[field] ?? 0)}`);
  });
  setText("#phd-stream-source", `出典: ${block.source?.title || ""}（文部科学省 学校基本調査を基にNISTEPが集計）`);
}

/* ================================================================ 03 TERRAIN */

function initTerrain(indicators) {
  const mount = $("#terrain");
  const tabs = $("#terrain-tabs");
  const block = indicators?.field_share;
  if (!mount || !block || block.status !== "ok") { if (mount) mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>'; return; }
  const countries = block.countries;
  const fieldPalette = { "化学": "#5b8dbb", "材料科学": "#5fb3c9", "物理学・宇宙科学": "#4fd8ff", "計算機科学・数学": "#8d7fb0", "工学": "#7f96c9", "環境/生態学・地球科学": "#5ad8a1", "臨床医学・精神医学/心理学": "#e0a06a", "基礎生命科学": "#b58fc9", "その他": "#46536b" };
  let currentKey = "jp";

  tabs.innerHTML = countries.map((c) => `<button role="tab" data-key="${c.key}" aria-selected="${c.key === "jp"}" class="${c.key === "jp" ? "is-active" : ""}">${escapeHtml(c.label)}</button>`).join("");
  tabs.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-key]");
    if (!button) return;
    currentKey = button.dataset.key;
    $$("#terrain-tabs button").forEach((b) => { b.classList.toggle("is-active", b === button); b.setAttribute("aria-selected", b === button ? "true" : "false"); });
    render();
  });

  function render() {
    mount.innerHTML = "";
    const country = countries.find((c) => c.key === currentKey);
    if (!country) return;
    const fields = country.fields;
    const years = [...new Set(fields.flatMap((f) => f.values.map(([y]) => y)))].sort();
    const rows = years.map((year) => {
      const row = { year };
      for (const field of fields) {
        const hit = field.values.find(([y]) => y === year);
        row[field.label] = hit ? hit[1] : 0;
      }
      return row;
    });
    const keys = fields.map((f) => f.label);
    const width = mount.clientWidth || 900, height = Math.max(360, Math.min(520, width * 0.46));
    const margin = { top: 26, right: 24, bottom: 34, left: 24 };
    const stack = d3.stack().keys(keys).offset(d3.stackOffsetWiggle).order(d3.stackOrderInsideOut);
    const series = stack(rows);
    const x = d3.scaleLinear().domain(d3.extent(years)).range([margin.left, width - margin.right]);
    const y = d3.scaleLinear()
      .domain([d3.min(series.flat(2)), d3.max(series.flat(2))])
      .range([height - margin.bottom, margin.top]);
    const svg = d3.select(mount).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img")
      .attr("aria-label", `${country.label}の分野別論文数割合の推移（ストリームグラフ）`);
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - margin.bottom})`)
      .call(d3.axisBottom(x).ticks(MOBILE ? 5 : 9).tickFormat(d3.format("d"))).select(".domain").remove();
    const area = d3.area().x((d) => x(d.data.year)).y0((d) => y(d[0])).y1((d) => y(d[1])).curve(d3.curveBasis);
    const paths = svg.append("g").selectAll("path").data(series).join("path")
      .attr("d", area)
      .attr("fill", (d) => fieldPalette[d.key] || "#64748f")
      .attr("opacity", 0.85)
      .attr("stroke", "#06090f").attr("stroke-width", 0.6);
    if (!REDUCED && gsap) {
      gsap.from(paths.nodes(), { opacity: 0, y: 18, duration: 0.9, stagger: 0.05, ease: "power2.out", scrollTrigger: { trigger: mount, start: "top 78%" } });
    }
    /* inline labels on thickest point of each band */
    for (const s of series) {
      let best = null;
      for (const d of s) {
        const thickness = Math.abs(y(d[0]) - y(d[1]));
        if (!best || thickness > best.thickness) best = { d, thickness };
      }
      if (best && best.thickness > 20) {
        svg.append("text")
          .attr("x", x(best.d.data.year)).attr("y", (y(best.d[0]) + y(best.d[1])) / 2 + 3)
          .attr("text-anchor", "middle").attr("font-size", Math.min(12, 8 + best.thickness * 0.06))
          .attr("fill", "rgba(6,9,15,0.85)").attr("font-weight", 600)
          .attr("pointer-events", "none")
          .text(s.key.split("・")[0].split("/")[0]);
      }
    }
    const hover = $("#terrain-hover");
    svg.on("pointermove", (event) => {
      const [mx, my] = d3.pointer(event);
      const year = Math.round(x.invert(mx));
      const hit = series.find((s) => {
        const d = s.find((p) => p.data.year === year) || s[s.length - 1];
        return d && my >= y(d[1]) && my <= y(d[0]);
      });
      if (hit && hover) {
        const d = hit.find((p) => p.data.year === year);
        const value = d ? d.data[hit.key] : null;
        hover.innerHTML = `<b>${escapeHtml(hit.key)}</b><br>${year}年 ${value != null ? fmtPct(value) : "—"}`;
        const bounds = mount.getBoundingClientRect();
        hover.style.left = `${Math.min(event.clientX - bounds.left + 14, bounds.width - 180)}px`;
        hover.style.top = `${event.clientY - bounds.top - 20}px`;
        hover.classList.add("is-on");
      } else if (hover) hover.classList.remove("is-on");
    }).on("pointerleave", () => hover?.classList.remove("is-on"));
  }

  render();
  setText("#terrain-source", `出典: ${block.source?.title || ""}。${block.note || ""}`);
  window.addEventListener("resize", () => render(), { passive: true });
}

function renderInstitutions(indicators) {
  const mount = $("#inst-pack");
  const block = indicators?.openalex;
  const window_ = block?.jp_institutions_window;
  if (!mount || !window_ || !window_.rows?.length) { if (mount) mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>'; return; }
  mount.innerHTML = "";
  const rows = window_.rows.slice(0, 24);
  const width = mount.clientWidth || 900, height = Math.max(340, Math.min(480, width * 0.42));
  const root = d3.hierarchy({ children: rows }).sum((d) => d.count || 0);
  d3.pack().size([width, height]).padding(6)(root);
  const svg = d3.select(mount).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img")
    .attr("aria-label", "日本の論文産出上位機関のバブルチャート");
  const nodes = svg.selectAll("g").data(root.leaves()).join("g").attr("transform", (d) => `translate(${d.x},${d.y})`);
  nodes.append("circle")
    .attr("r", (d) => d.r)
    .attr("fill", (d, i) => (i === 0 ? "rgba(255,181,69,0.14)" : "rgba(79,216,255,0.07)"))
    .attr("stroke", (d, i) => (i === 0 ? "#ffb545" : "rgba(79,216,255,0.45)"))
    .attr("stroke-width", (d, i) => (i === 0 ? 1.6 : 0.8));
  nodes.append("title").text((d) => `${d.data.label}: ${fmtInt(d.data.count)}本`);
  nodes.filter((d) => d.r > 26).append("text").attr("class", "inst-label").attr("text-anchor", "middle").attr("dy", -2)
    .text((d) => {
      const label = d.data.label.replace(/^(独立行政法人|国立研究開発法人|国立大学法人|学校法人)/, "");
      const budget = Math.max(3, Math.floor(d.r / 6.2));
      return label.length > budget ? `${label.slice(0, budget)}…` : label;
    });
  nodes.filter((d) => d.r > 26).append("text").attr("class", "inst-count").attr("text-anchor", "middle").attr("dy", 14)
    .text((d) => fmtInt(d.data.count));
  if (!REDUCED && gsap) {
    gsap.from(nodes.selectAll("circle").nodes(), { attr: { r: 0 }, duration: 1.1, ease: "elastic.out(1, 0.6)", stagger: 0.03, scrollTrigger: { trigger: mount, start: "top 80%" } });
  }
  setText("#inst-window", `${window_.from}–${window_.to}年 / type:article`);
  setText("#inst-source", `出典: ${block.source?.title || "OpenAlex"}。機関の同定・国別割当はOpenAlexによる。`);
}

/* ================================================================ 04 FLOWS */

function initFlows(indicators, analytics) {
  const canvas = $("#flow-canvas");
  const people = analytics?.reality?.people;
  if (!canvas || !people || people.status !== "ok") {
    if (canvas) canvas.closest(".flow-stage").innerHTML = '<p class="data-empty" style="padding:30px">研究者移動のデータを取得できませんでした。</p>';
    return;
  }
  const PER_PARTICLE = 50;
  const links = (people.links || []).filter((l) => l.value > 0);
  const sourceNames = ["企業", "非営利団体", "公的機関", "大学等", "その他"];
  const targetNames = ["企業", "非営利団体", "公的機関", "大学等"];
  const sectorColor = { "企業": "#a7b4cc", "非営利団体": "#8d7fb0", "公的機関": "#5ad8a1", "大学等": "#ffb545", "その他": "#59687f" };

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
    /* per-link anchors stacked inside nodes */
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
      ctx.fillText(`${fmtInt(node.total)}人`, node.x + (isSource ? -12 : 12), (node.y0 + node.y1) / 2 + 19);
      ctx.font = '500 12px "IBM Plex Mono", monospace';
      ctx.globalAlpha = 1;
    }
    ctx.textAlign = "left";
    ctx.fillStyle = "#4c5a72";
    ctx.font = '500 10px "IBM Plex Mono", monospace';
    ctx.fillText("移動元", geom.width * 0.05, 26);
    ctx.textAlign = "right";
    ctx.fillText("移動先（採用・転入）", geom.width * 0.95, 26);
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
    const top = (list, dir) => list.slice(0, 2).map((l) => `${dir === "out" ? l.target : l.source} ${fmtInt(l.value)}人`).join(" / ");
    detail.innerHTML = `<b>${escapeHtml(name)}</b> — 転出先: ${escapeHtml(top(outbound, "out") || "—")}<br>転入元: ${escapeHtml(top(inbound, "in") || "—")}`;
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
  setText("#flows-lede", `${analytics.reality.survey_year}年調査で観測された研究者の組織間移動は${fmtInt(total)}人。粒子1つ＝研究者${PER_PARTICLE}人として流している。`);

  /* money strip */
  const money = analytics?.reality?.money;
  const strip = $("#money-strip");
  if (strip && money?.status === "ok") {
    const rows = money.rows || [];
    const max = d3.max(rows, (r) => r.internal_research_expenditure_million_yen);
    strip.innerHTML = rows.map((r) => `
      <div class="money-cell">
        <span class="m-name" style="color:${sectorColor[r.name] || "#8b96ab"}">${escapeHtml(r.name)}</span>
        <strong class="m-value">${fmtCho(r.internal_research_expenditure_million_yen)}</strong>
        <span class="m-bar"><i style="width:${Math.max(2, (r.internal_research_expenditure_million_yen / max) * 100)}%"></i></span>
        <span class="m-note">内部使用研究費 / ${fmtInt(r.organizations)}組織</span>
      </div>`).join("");
  }
  setText("#flows-source", `出典: 総務省 科学技術研究調査（${analytics?.reality?.survey_year || "—"}年調査）。移動先「大学等→大学等」等の同一部門間移動を含む。`);
}

/* ================================================================ 05 LIVE */

function renderLive(updates) {
  const feed = $("#live-feed");
  if (!feed) return;
  const items = (updates?.items || [])
    .filter((item) => item.published_at)
    .sort((a, b) => String(b.published_at).localeCompare(String(a.published_at)))
    .slice(0, 12);
  if (!items.length) { feed.innerHTML = '<p class="data-empty">シグナルを取得できませんでした。</p>'; return; }
  const now = Date.now();
  feed.innerHTML = items.map((item) => {
    const fresh = now - new Date(item.published_at).getTime() < 1000 * 60 * 60 * 24 * 4;
    return `
      <div class="signal-row${fresh ? " is-fresh" : ""}">
        <span class="signal-date">${shortDate(item.published_at)}</span>
        <div class="signal-main">
          <a class="signal-title" href="${escapeHtml(safeUrl(item.url))}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a>
          <p class="signal-meta">${escapeHtml(item.source || "")}${item.ai_summary ? ` — ${escapeHtml(item.ai_summary)}` : ""}</p>
        </div>
        <span class="signal-type">${escapeHtml(item.document_type || "")}</span>
      </div>`;
  }).join("");
  if (!REDUCED && gsap) {
    gsap.from(".signal-row", { opacity: 0, y: 14, duration: 0.5, stagger: 0.05, ease: "power2.out", scrollTrigger: { trigger: feed, start: "top 82%" } });
  }
  const board = $("#source-board");
  if (board) {
    const rows = (updates?.sources || []).map((s) => `
      <div class="board-row"><b>${escapeHtml(s.name)}</b><span class="${s.status === "ok" ? "board-ok" : "board-ng"}">${s.status === "ok" ? `${fmtInt(s.items || 0)}件` : "ERROR"}</span></div>`).join("");
    board.insertAdjacentHTML("beforeend", rows);
    const generated = updates?.generated_at ? new Date(updates.generated_at) : null;
    if (generated && !Number.isNaN(generated.getTime())) {
      board.insertAdjacentHTML("beforeend", `<div class="board-row"><b>最終巡回</b><span>${new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(generated)}</span></div>`);
    }
  }
  setText("#live-lede", `政府公式ソースを3時間ごとに巡回し、${fmtInt((updates?.items || []).length)}件の政策シグナルを観測している。`);
}

/* ================================================================ ledger */

function renderLedger(indicators, analytics, updates) {
  const ledger = $("#ledger");
  if (!ledger) return;
  const entries = [];
  const push = (block, fallbackTitle) => {
    if (!block) return;
    entries.push({
      title: block.source?.title || fallbackTitle,
      url: block.source?.url || "",
      status: block.status,
    });
  };
  const ind = indicators || {};
  push(ind.gerd_gdp); push(ind.researchers); push(ind.phd_enrollment); push(ind.phd_degrees);
  push(ind.papers); push(ind.field_share); push(ind.oecd_gerd_gdp); push(ind.openalex); push(ind.estat);
  for (const source of analytics?.reality?.sources || []) {
    entries.push({ title: source.title, url: source.url, status: source.status === "ok" ? "ok" : "unavailable" });
  }
  entries.push({ title: `政府公式フィード ${((updates?.sources) || []).length}系統（内閣府・文科省・CSTI）`, url: "sources.html", status: "ok" });
  const seen = new Set();
  ledger.insertAdjacentHTML("beforeend", entries.filter((e) => e.title && !seen.has(e.title) && seen.add(e.title)).map((e) => `
    <div class="ledger-row">
      <span>${e.url ? `<a href="${escapeHtml(safeUrl(e.url) === "#" ? e.url : e.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(e.title)}</a>` : escapeHtml(e.title)}</span>
      <span class="ledger-status${e.status === "ok" ? "" : " is-na"}">${e.status === "ok" ? "接続中" : "未接続"}</span>
    </div>`).join(""));
}

/* ================================================================ rail */

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

/* ================================================================ boot */

async function init() {
  setText("#footer-year", String(new Date().getFullYear()));
  initRail();
  const fetchJson = (url) => fetch(url, { cache: "no-store" }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${url}: ${r.status}`))));
  const [indicatorsResult, analyticsResult, updatesResult] = await Promise.allSettled([
    fetchJson("data/indicators.json"),
    fetchJson("data/analytics.json"),
    fetchJson("data/updates.json"),
  ]);
  const indicators = indicatorsResult.status === "fulfilled" ? indicatorsResult.value.indicators : null;
  const analytics = analyticsResult.status === "fulfilled" ? analyticsResult.value : null;
  const updates = updatesResult.status === "fulfilled" ? updatesResult.value : null;

  if (!indicators && !analytics && !updates) {
    setText("#header-status", "観測データを取得できません");
    return;
  }
  $("#header-status-dot")?.classList.add("is-live");
  const shareJp = indicators ? (seriesMap(indicators.papers, "share").jp || []) : [];
  setText("#header-status", `観測中 — 7か国×${shareJp.length ? `${shareJp[0][0]}–${lastPoint(shareJp)[0]}年` : "40年"} / シグナル${fmtInt((updates?.items || []).length)}件`);

  initHero(indicators, updates);
  initRace(indicators);
  renderPhdIntl(indicators);
  renderPhdStream(indicators);
  initTerrain(indicators);
  renderInstitutions(indicators);
  initFlows(indicators, analytics);
  renderLive(updates);
  renderLedger(indicators, analytics, updates);
}

init().catch((error) => {
  console.error(error);
  setText("#header-status", "観測データを取得できません");
});
