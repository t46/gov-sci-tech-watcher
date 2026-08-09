/* SCIENCE SIGNAL / RESEARCH — 研究の観測ページ。obs-core.js の後に読み込む。 */
"use strict";

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

/* ================================================================ 02 TERRAIN */

function initTerrain(indicators) {
  const mount = $("#terrain");
  const tabs = $("#terrain-tabs");
  const block = indicators?.field_share;
  if (!mount || !block || block.status !== "ok") { if (mount) mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>'; return; }
  const countries = block.countries;
  const fieldPalette = { "化学": "#5b8dbb", "材料科学": "#5fb3c9", "物理学・宇宙科学": "#4fd8ff", "計算機科学・数学": "#8d7fb0", "工学": "#7f96c9", "環境/生態学・地球科学": "#5ad8a1", "臨床医学・精神医学/心理学": "#e0a06a", "基礎生命科学": "#b58fc9", "その他": "#46536b" };
  let currentKey = "jp";

  tabs.innerHTML = countries.map((c) => `<button role="tab" data-key="${escapeHtml(String(c.key))}" aria-selected="${c.key === "jp"}" class="${c.key === "jp" ? "is-active" : ""}">${escapeHtml(c.label)}</button>`).join("");
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

/* ================================================================ 03 THEME SHIFT */

const THEME_COLORS = {
  "農学・生物科学": "#5ad8a1",
  "人文科学": "#c9a5df",
  "生化学・遺伝学・分子生物学": "#b58fc9",
  "経営学・会計学": "#d98f6b",
  "化学工学": "#6f9fc4",
  "化学": "#5b8dbb",
  "計算機科学": "#8d7fb0",
  "意思決定科学": "#9aa8c9",
  "歯学": "#e0a0a0",
  "地球惑星科学": "#3fae8a",
  "経済学・計量経済学・金融": "#cfa15a",
  "エネルギー": "#d9c25a",
  "工学": "#7f96c9",
  "環境科学": "#6fdfae",
  "保健医療専門職": "#e0b48a",
  "免疫学・微生物学": "#d97fa0",
  "材料科学": "#5fb3c9",
  "数学": "#a7b4cc",
  "医学": "#e0a06a",
  "神経科学": "#ff8f6b",
  "看護学": "#e0c0d0",
  "薬理学・毒性学・製剤学": "#b0a8e0",
  "物理学・天文学": "#4fd8ff",
  "心理学": "#d0a0e0",
  "社会科学": "#8fa8d0",
  "獣医学": "#a0c98f",
  "その他": "#46536b",
};
const THEME_TOP_N_DESKTOP = 11;
const THEME_TOP_N_MOBILE = 8;

function initThemes(topics) {
  const mount = $("#themes-stream");
  const legend = $("#themes-legend");
  if (!mount || !topics || topics.status !== "ok" || !Array.isArray(topics.years) || !topics.years.length
    || !Array.isArray(topics.fields) || !topics.fields.length
    || !topics.fields.every((f) => Array.isArray(f.counts) && f.counts.length === topics.years.length)) {
    if (mount) mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>';
    return;
  }
  const years = topics.years;
  const totals = years.map((_, i) => topics.fields.reduce((sum, f) => sum + (f.counts[i] || 0), 0));
  const ranked = [...topics.fields].sort((a, b) => d3.sum(b.counts) - d3.sum(a.counts));
  const topN = MOBILE ? THEME_TOP_N_MOBILE : THEME_TOP_N_DESKTOP;
  const top = ranked.slice(0, topN);
  const rest = ranked.slice(topN);

  const bands = top.map((f) => ({
    key: f.name_ja,
    values: years.map((y, i) => [y, totals[i] ? (f.counts[i] / totals[i]) * 100 : 0]),
  }));
  if (rest.length) {
    bands.push({
      key: "その他",
      values: years.map((y, i) => [y, totals[i] ? (d3.sum(rest, (f) => f.counts[i] || 0) / totals[i]) * 100 : 0]),
    });
  }

  function render() {
    mount.innerHTML = "";
    const rows = years.map((year, i) => {
      const row = { year };
      for (const band of bands) row[band.key] = band.values[i][1];
      return row;
    });
    const keys = bands.map((b) => b.key);
    const width = mount.clientWidth || 900, height = Math.max(360, Math.min(520, width * 0.46));
    const margin = { top: 26, right: 24, bottom: 34, left: 24 };
    const stack = d3.stack().keys(keys).offset(d3.stackOffsetWiggle).order(d3.stackOrderInsideOut);
    const series = stack(rows);
    const x = d3.scaleLinear().domain(d3.extent(years)).range([margin.left, width - margin.right]);
    const y = d3.scaleLinear()
      .domain([d3.min(series.flat(2)), d3.max(series.flat(2))])
      .range([height - margin.bottom, margin.top]);
    const svg = d3.select(mount).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img")
      .attr("aria-label", "日本の研究テーマ構成の変遷（ストリームグラフ）");
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - margin.bottom})`)
      .call(d3.axisBottom(x).ticks(MOBILE ? 5 : 9).tickFormat(d3.format("d"))).select(".domain").remove();
    const area = d3.area().x((d) => x(d.data.year)).y0((d) => y(d[0])).y1((d) => y(d[1])).curve(d3.curveBasis);
    const paths = svg.append("g").selectAll("path").data(series).join("path")
      .attr("d", area)
      .attr("fill", (d) => THEME_COLORS[d.key] || "#64748f")
      .attr("opacity", 0.85)
      .attr("stroke", "#06090f").attr("stroke-width", 0.6);
    if (!REDUCED && gsap) {
      gsap.from(paths.nodes(), { opacity: 0, y: 18, duration: 0.9, stagger: 0.04, ease: "power2.out", scrollTrigger: { trigger: mount, start: "top 78%" } });
    }
    for (const s of series) {
      let best = null;
      for (const d of s) {
        const thickness = Math.abs(y(d[0]) - y(d[1]));
        if (!best || thickness > best.thickness) best = { d, thickness };
      }
      if (best && best.thickness > 22) {
        svg.append("text")
          .attr("x", x(best.d.data.year)).attr("y", (y(best.d[0]) + y(best.d[1])) / 2 + 3)
          .attr("text-anchor", "middle").attr("font-size", Math.min(12, 8 + best.thickness * 0.06))
          .attr("fill", "rgba(6,9,15,0.85)").attr("font-weight", 600)
          .attr("pointer-events", "none")
          .text(s.key.split("・")[0].split("/")[0]);
      }
    }
    const hover = $("#themes-hover");
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
  if (legend) {
    legend.innerHTML = bands.map((b) => `<div class="tl"><i style="background:${THEME_COLORS[b.key] || "#64748f"}"></i>${escapeHtml(b.key)}</div>`).join("");
  }
  setText("#themes-source", `出典: ${topics.source?.title || "OpenAlex"}。${topics.note || ""}`);

  /* 全26分野の中で、初年と最終年のシェア差が最も大きい分野を一言で示す */
  const firstTotal = totals[0], lastTotal = totals[totals.length - 1];
  if (firstTotal && lastTotal) {
    let biggest = null;
    for (const f of topics.fields) {
      const a = (f.counts[0] / firstTotal) * 100;
      const b = (f.counts[f.counts.length - 1] / lastTotal) * 100;
      const delta = b - a;
      if (!biggest || Math.abs(delta) > Math.abs(biggest.delta)) biggest = { name: f.name_ja, a, b, delta };
    }
    if (biggest) {
      setText("#themes-lede-fact", `${biggest.name}のシェアは${years[0]}年${fmtPct(biggest.a)}から${years[years.length - 1]}年${fmtPct(biggest.b)}へ。`);
    }
  }

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

/* ================================================================ boot */

async function init() {
  bootFooter();
  initRail();
  const [indicatorsResult, topicsResult] = await Promise.allSettled([fetchJson("data/indicators.json"), fetchJson("data/topics.json")]);
  const indicators = indicatorsResult.status === "fulfilled" ? indicatorsResult.value.indicators : null;
  const topics = topicsResult.status === "fulfilled" ? topicsResult.value : null;
  if (!indicators) {
    setText("#header-status", "研究データを取得できません");
    return;
  }
  $("#header-status-dot")?.classList.add("is-live");
  const shareValues = seriesMap(indicators.papers, "share").jp || [];
  if (shareValues.length) {
    const peak = shareValues.reduce((a, b) => (b[1] > a[1] ? b : a));
    const last = lastPoint(shareValues);
    const title = $("#papers-title");
    if (title) title.innerHTML = `論文シェア、<em>${fmtPct(peak[1])}</em> → <em>${fmtPct(last[1])}</em>。`;
    setText("#papers-lede", `日本が世界の論文に占める割合、${peak[0]}年から${last[0]}年。論文数・注目論文・分野構成・機関の40年。`);
    setText("#header-status", `観測中 — 7か国×${shareValues[0][0]}–${last[0]}年 / 3系統の一次データ`);
  } else {
    setText("#header-status", "観測中 — 研究データ");
  }

  initRace(indicators);
  initTerrain(indicators);
  renderInstitutions(indicators);
  try {
    initThemes(topics);
  } catch (error) {
    console.error(error);
    const mount = $("#themes-stream");
    if (mount) mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>';
  }
  renderLedgerEntries([
    blockEntry(indicators.papers), blockEntry(indicators.field_share), blockEntry(indicators.openalex), blockEntry(topics, "OpenAlex API"),
  ].filter(Boolean));
}

init().catch((error) => {
  console.error(error);
  setText("#header-status", "研究データを取得できません");
});
