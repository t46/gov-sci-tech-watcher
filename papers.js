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

/* ================================================================ 03 THEME BUMP (subfield rank) */

/* 順位の色: 上昇（暖色）↔ 横ばい（グレー）↔ 下降（寒色）。--jp / --cn を両端に、--dim を中点に。
   上昇側・下降側それぞれ独立に正規化する（片方に極端な外れ値が1つあると、もう片方の値ある動きが
   すべて中間色に埋もれてしまうため）。 */
const BUMP_WARM = "#ff7a45";
const BUMP_COOL = "#4fd8ff";
const BUMP_NEUTRAL = "#8b96ab";
function bumpColor(delta, warmSpan, coolSpan) {
  if (delta === 0) return BUMP_NEUTRAL;
  const span = delta > 0 ? warmSpan : coolSpan;
  const t = span ? Math.max(-1, Math.min(1, delta / span)) : 0;
  return t >= 0 ? d3.interpolateRgb(BUMP_NEUTRAL, BUMP_WARM)(t) : d3.interpolateRgb(BUMP_NEUTRAL, BUMP_COOL)(-t);
}

const BUMP_TOP_K = 13; /* 各サンプル年でこの順位以内に一度でも入った subfield を線として描く */
const BUMP_SAMPLE_STEP = 5;

function initThemeBump(topics) {
  const mount = $("#themes-stream");
  const legend = $("#themes-legend");
  const invalid = !mount || !topics || topics.status !== "ok"
    || !Array.isArray(topics.years) || !topics.years.length
    || !Array.isArray(topics.subfields) || !topics.subfields.length
    || !topics.subfields.every((sf) => sf && Array.isArray(sf.counts) && sf.counts.length === topics.years.length);
  if (invalid) {
    if (mount) mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>';
    return;
  }
  const years = topics.years;
  const subfields = topics.subfields;

  /* 5年刻みのサンプル年。末尾は取得できている最終年に寄せる（欠けても崩れないように）。 */
  const yearSet = new Set(years);
  const first = years[0], last = years[years.length - 1];
  const sampleYears = [];
  for (let y = Math.ceil(first / BUMP_SAMPLE_STEP) * BUMP_SAMPLE_STEP; y <= last; y += BUMP_SAMPLE_STEP) {
    if (yearSet.has(y)) sampleYears.push(y);
  }
  if (!sampleYears.includes(first)) sampleYears.unshift(first);
  if (!sampleYears.includes(last)) sampleYears.push(last);
  if (sampleYears.length < 2) { mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>'; return; }

  /* subfield は id で同定する（OpenAlex上、異なるidで同名の subfield が複数存在するため name では引けない）。
     counts の null＝その年の集計上位200グループに現れなかった（真の0件と区別できない「取得外」）。
     0扱いで順位化するとシェア・順位を捏造することになるため、欠測として順位も線も付けない。 */
  const fieldsOk = Array.isArray(topics.fields) && topics.fields.length
    && topics.fields.every((f) => f && Array.isArray(f.counts) && f.counts.length === years.length);
  const idxOf = new Map(years.map((y, i) => [y, i]));
  const rankByYear = new Map(); /* year -> [{id, name, name_ja, count, rank, share}] sorted */
  for (const year of sampleYears) {
    const i = idxOf.get(year);
    const present = subfields
      .filter((sf) => Number.isFinite(sf.counts[i]) && sf.counts[i] > 0)
      .map((sf) => ({ id: sf.id, name: sf.name, name_ja: (typeof sf.name_ja === "string" && sf.name_ja) || sf.name || "", count: sf.counts[i] }));
    /* シェアの分母は26分野合計（group_byの200件キャップが掛からず完全）。fieldsが無い場合のみsubfield合計で代用 */
    const denom = fieldsOk ? d3.sum(topics.fields, (f) => f.counts[i] || 0) : d3.sum(present, (d) => d.count);
    const ranked = present
      .sort((a, b) => b.count - a.count)
      .map((d, k) => ({ ...d, rank: k + 1, share: denom ? (d.count / denom) * 100 : 0 }));
    rankByYear.set(year, ranked);
  }

  const unionIds = new Set();
  for (const year of sampleYears) {
    for (const row of rankByYear.get(year).slice(0, BUMP_TOP_K)) unionIds.add(row.id);
  }

  const byId = new Map();
  for (const year of sampleYears) {
    for (const row of rankByYear.get(year)) {
      if (!unionIds.has(row.id)) continue;
      if (!byId.has(row.id)) byId.set(row.id, { id: row.id, name: row.name, name_ja: row.name_ja, points: [] });
      byId.get(row.id).points.push({ year, rank: row.rank, share: row.share });
    }
  }
  const series = [...byId.values()].filter((s) => s.points.length >= 2);
  const maxRank = Math.max(BUMP_TOP_K, d3.max(series, (s) => d3.max(s.points, (p) => p.rank)) || BUMP_TOP_K);
  for (const s of series) {
    s.delta = s.points[0].rank - s.points[s.points.length - 1].rank; /* 正=順位が上がった（数字が減った） */
  }
  /* 上位70%点をスパンにする: 極端な1〜2件（例: AIの急上昇、分光学の急落）に色スケールを支配させず、
     中程度の動き（外科・循環器などの緩やかな上昇）にも見える色差を残す。突出した動きは自然に飽和する。 */
  const warmDeltas = series.map((s) => s.delta).filter((d) => d > 0).sort((a, b) => a - b);
  const coolDeltas = series.map((s) => -s.delta).filter((d) => d > 0).sort((a, b) => a - b);
  const warmSpan = Math.max(4, d3.quantile(warmDeltas, 0.7) || 4);
  const coolSpan = Math.max(4, d3.quantile(coolDeltas, 0.7) || 4);
  for (const s of series) s.color = bumpColor(s.delta, warmSpan, coolSpan);

  function render() {
    mount.innerHTML = "";
    const width = mount.clientWidth || 900;
    const rowUnit = MOBILE ? 15 : 19;
    const margin = { top: 24, right: MOBILE ? 96 : 158, bottom: 30, left: MOBILE ? 30 : 40 };
    const height = Math.max(420, Math.min(760, margin.top + margin.bottom + Math.sqrt(maxRank) * rowUnit * 9));

    const x = d3.scalePoint().domain(sampleYears).range([margin.left, width - margin.right]).padding(0.5);
    const y = d3.scalePow().exponent(0.52).domain([1, maxRank]).range([margin.top, height - margin.bottom]).clamp(true);

    const svg = d3.select(mount).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img")
      .attr("aria-label", "日本の論文シェア上位下位分野（subfield）の順位バンプチャート");

    /* 上位K帯の背景（このKに一度でも入った分野が線になっている、という枠を視覚化） */
    svg.append("rect")
      .attr("x", margin.left).attr("y", y(1) - 6).attr("width", width - margin.left - margin.right)
      .attr("height", Math.max(0, y(BUMP_TOP_K) - y(1) + 6))
      .attr("fill", "rgba(255,181,69,0.045)");
    svg.append("text").attr("x", margin.left).attr("y", y(1) - 10).attr("font-size", 9.5)
      .attr("fill", "var(--faint)").attr("font-family", "var(--mono)").text(`上位${BUMP_TOP_K}`);

    /* 順位の目盛り（非線形なので離散指定） */
    const tickRanks = [1, 3, 5, 8, 13, 20, 30, 50, 80].filter((r) => r <= maxRank);
    if (tickRanks[tickRanks.length - 1] !== maxRank && maxRank - tickRanks[tickRanks.length - 1] > 5) tickRanks.push(maxRank);
    const gy = svg.append("g").attr("class", "axis");
    gy.selectAll("line").data(tickRanks).join("line")
      .attr("x1", margin.left).attr("x2", width - margin.right)
      .attr("y1", (r) => y(r)).attr("y2", (r) => y(r))
      .attr("stroke", "#16202f").attr("stroke-dasharray", "2 4");
    gy.selectAll("text").data(tickRanks).join("text")
      .attr("x", margin.left - 8).attr("y", (r) => y(r) + 3).attr("text-anchor", "end")
      .attr("font-size", 9.5).attr("fill", "var(--faint)").attr("font-family", "var(--mono)")
      .text((r) => `${r}位`);

    /* モバイルは点が詰まりすぎるので間引く（線・点は全サンプル年のまま、目盛りラベルだけ減らす） */
    const tickYears = MOBILE ? sampleYears.filter((yr, i) => i % 2 === 0 || yr === sampleYears[sampleYears.length - 1]) : sampleYears;
    const gx = svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - margin.bottom + 18})`);
    gx.selectAll("text").data(tickYears).join("text")
      .attr("x", (yr) => x(yr)).attr("text-anchor", "middle")
      .attr("font-size", 10.5).attr("fill", "var(--dim)").attr("font-family", "var(--mono)")
      .text((yr) => `${yr}`);

    /* 欠測年（上位200圏外）は線を途切れさせる — 順位不明の区間を線で補間しない */
    const line = d3.line().defined((d) => d != null).x((d) => x(d.year)).y((d) => y(d.rank)).curve(d3.curveMonotoneX);
    const gLines = svg.append("g");
    const paths = gLines.selectAll("path").data(series).join("path")
      .attr("d", (s) => {
        const byYear = new Map(s.points.map((p) => [p.year, p]));
        return line(sampleYears.map((yr) => byYear.get(yr) || null));
      })
      .attr("fill", "none").attr("stroke", (s) => s.color)
      .attr("stroke-width", 2).attr("stroke-linecap", "round")
      .attr("opacity", 0.82);

    const gPoints = svg.append("g");
    const hover = $("#themes-hover");
    const showHover = (event, s, p) => {
      if (!hover) return;
      hover.innerHTML = `<b>${escapeHtml(s.name_ja)}</b><br>${p.year}年 ${p.rank}位 ${fmtPct(p.share)}`;
      const bounds = mount.getBoundingClientRect();
      hover.style.left = `${Math.min(event.clientX - bounds.left + 14, bounds.width - 190)}px`;
      hover.style.top = `${Math.max(event.clientY - bounds.top - 24, 4)}px`;
      hover.classList.add("is-on");
    };
    const hideHover = () => hover?.classList.remove("is-on");
    const highlight = (id) => {
      paths.attr("opacity", (s) => (id == null || s.id === id ? 0.95 : 0.16));
      paths.attr("stroke-width", (s) => (s.id === id ? 3 : 2));
      gPoints.selectAll("circle").attr("opacity", (d) => (id == null || d.s.id === id ? 1 : 0.16));
    };

    const pointData = series.flatMap((s) => s.points.map((p) => ({ s, p })));
    gPoints.selectAll("circle").data(pointData).join("circle")
      .attr("cx", (d) => x(d.p.year)).attr("cy", (d) => y(d.p.rank))
      .attr("r", (d) => (d.p.rank <= BUMP_TOP_K ? 3.4 : 2.6))
      .attr("fill", (d) => (d.p.rank <= BUMP_TOP_K ? d.s.color : "#06090f"))
      .attr("stroke", (d) => d.s.color).attr("stroke-width", 1.3)
      .style("cursor", "pointer")
      .on("pointerenter", (event, d) => { highlight(d.s.id); showHover(event, d.s, d.p); })
      .on("pointermove", (event, d) => showHover(event, d.s, d.p))
      .on("pointerleave", () => { highlight(null); hideHover(); });

    /* 右端ラベル: 最終サンプル年時点の順位・シェア。近接するものは上下にずらして重なりを避ける。 */
    const labelSeries = series.filter((s) => s.points[s.points.length - 1].year === sampleYears[sampleYears.length - 1]);
    const labelRows = labelSeries
      .map((s) => ({ s, p: s.points[s.points.length - 1], ny: y(s.points[s.points.length - 1].rank) }))
      .sort((a, b) => a.ny - b.ny);
    const minGap = MOBILE ? 15 : 19;
    for (let i = 1; i < labelRows.length; i += 1) {
      if (labelRows[i].ny - labelRows[i - 1].ny < minGap) labelRows[i].ny = labelRows[i - 1].ny + minGap;
    }
    const gLabels = svg.append("g");
    gLabels.selectAll("g").data(labelRows).join("g")
      .attr("transform", (d) => `translate(${x(sampleYears[sampleYears.length - 1]) + 8},${d.ny})`)
      .style("cursor", "pointer")
      .on("pointerenter", function pointerEnter(event, d) { highlight(d.s.id); showHover(event, d.s, d.p); })
      .on("pointerleave", () => { highlight(null); hideHover(); })
      .call((g) => {
        g.append("text").attr("dy", -1.5).attr("font-size", MOBILE ? 9.5 : 10.5).attr("font-family", "var(--mono)")
          .attr("fill", (d) => d.s.color).attr("font-weight", 600)
          .text((d) => {
            const label = d.s.name_ja;
            const budget = MOBILE ? 9 : 15;
            return label.length > budget ? `${label.slice(0, budget)}…` : label;
          });
        g.append("text").attr("dy", 10).attr("font-size", 9).attr("font-family", "var(--mono)")
          .attr("fill", "var(--faint)")
          .text((d) => `${d.p.rank}位 ${fmtPct(d.p.share)}`);
      });

    if (!REDUCED && gsap) {
      gsap.from(paths.nodes(), { opacity: 0, duration: 1, stagger: 0.03, ease: "power1.out", scrollTrigger: { trigger: mount, start: "top 78%" } });
      gsap.from(gPoints.selectAll("circle").nodes(), { opacity: 0, duration: 0.7, stagger: 0.005, ease: "power1.out", scrollTrigger: { trigger: mount, start: "top 78%" } });
    }
  }

  render();
  if (legend) {
    legend.innerHTML = `
      <div class="tl"><i style="background:${BUMP_WARM}"></i>順位が上がったテーマ</div>
      <div class="tl"><i style="background:${BUMP_NEUTRAL}"></i>横ばい</div>
      <div class="tl"><i style="background:${BUMP_COOL}"></i>順位が下がったテーマ</div>
      <div class="tl"><i style="border-radius:50%;border:1.3px solid var(--dim);background:transparent"></i>●＝上位${BUMP_TOP_K}入り　○＝上位${BUMP_TOP_K}圏外　線の欠け＝集計上位200圏外（順位不明）</div>`;
  }
  setText("#themes-source", `出典: ${topics.source?.title || "OpenAlex"}。${topics.subfield_note || topics.note || ""} 分類（primary_topic）はOpenAlexのアルゴリズムによる推定であり、直近年は確定ラグにより暫定値になりうる。`);

  /* もっとも順位を上げた/下げた subfield を一言で示す */
  const risers = [...series].sort((a, b) => b.delta - a.delta);
  const biggestRiser = risers[0];
  const biggestFaller = risers[risers.length - 1];
  if (biggestRiser && biggestFaller && biggestRiser !== biggestFaller) {
    const fmtRank = (s) => `${s.points[0].rank}位→${s.points[s.points.length - 1].rank > BUMP_TOP_K ? "圏外" : `${s.points[s.points.length - 1].rank}位`}`;
    setText("#themes-lede-fact", `最も順位を上げたのは${biggestRiser.name_ja}（${fmtRank(biggestRiser)}）。最も下げたのは${biggestFaller.name_ja}（${fmtRank(biggestFaller)}）。`);
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

/* ==== papers: scisci wave A (2026-08) ==== */

function baseAxis(g) {
  g.select(".domain").remove();
  g.selectAll("line").attr("stroke", "#16202f").attr("stroke-dasharray", "2 4");
  return g;
}

/* {year: value} 形式の辞書を [[year, value], ...] の昇順配列に変換し、除外年を落とす */
function dictToPairs(dict, excludeYears) {
  const exclude = new Set(excludeYears || []);
  return Object.entries(dict || {})
    .map(([y, v]) => [+y, v])
    .filter(([y, v]) => v != null && !exclude.has(y))
    .sort((a, b) => a[0] - b[0]);
}

/* NISTEP表4-1-7の「Top10%補正論文数シェア ÷ 論文数シェア」（整数カウント、共に世界シェア%）。
   Q値（NISTEPの分数カウント補正指標）とは算出方法が異なる単純比率であり、そう呼ばない。 */
function computeNistepRatio(papersBlock) {
  if (!papersBlock || papersBlock.status !== "ok") return [];
  const shareJp = new Map((papersBlock.share || []).find((s) => s.key === "jp")?.values || []);
  const top10Jp = new Map((papersBlock.top10_share || []).find((s) => s.key === "jp")?.values || []);
  return [...shareJp.keys()]
    .filter((y) => top10Jp.has(y) && shareJp.get(y))
    .sort((a, b) => a - b)
    .map((y) => [y, top10Jp.get(y) / shareJp.get(y)]);
}

/* 日本の論文に占める国際共著論文（複数国の著者所属を含む、whole counting）の割合 */
function computeIntlCollabSeries(openalexBlock, maxYear) {
  if (!openalexBlock || openalexBlock.status !== "ok" || !Array.isArray(openalexBlock.jp_international_collab)) return [];
  const jpTotals = new Map((openalexBlock.by_year || []).find((s) => s.key === "jp")?.values || []);
  const collab = new Map(openalexBlock.jp_international_collab);
  return [...jpTotals.keys()]
    .filter((y) => collab.has(y) && jpTotals.get(y) && (maxYear == null || y <= maxYear))
    .sort((a, b) => a - b)
    .map((y) => [y, (collab.get(y) / jpTotals.get(y)) * 100]);
}

/* 単一系列の折れ線＋任意の水平参照線。軸・終点ラベル・始点マーカーを描く共通の小さなチャート。 */
function drawRefLineChart(mount, { values, color, refValue, refLabel, ariaLabel, height, valueFmt }) {
  mount.innerHTML = "";
  if (!values.length) { mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>'; return null; }
  const fmt = valueFmt || ((v) => `${v.toFixed(1)}%`);
  const width = mount.clientWidth || 560;
  const h = height || Math.max(260, width * 0.42);
  const margin = { top: 22, right: MOBILE ? 90 : 122, bottom: 30, left: 44 };
  const x = d3.scaleLinear().domain(d3.extent(values, (d) => d[0])).range([margin.left, width - margin.right]);
  const vMax = Math.max(d3.max(values, (d) => d[1]), refValue ?? -Infinity) * 1.12;
  const vMin = Math.min(d3.min(values, (d) => d[1]), refValue ?? Infinity, 0);
  const y = d3.scaleLinear().domain([vMin, vMax]).range([h - margin.bottom, margin.top]);
  const svg = d3.select(mount).append("svg").attr("viewBox", `0 0 ${width} ${h}`).attr("role", "img").attr("aria-label", ariaLabel || "");
  baseAxis(svg.append("g").attr("class", "axis").attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(5).tickFormat(fmt).tickSize(-(width - margin.left - margin.right))));
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${h - margin.bottom})`)
    .call(d3.axisBottom(x).ticks(MOBILE ? 5 : 8).tickFormat(d3.format("d"))).select(".domain").attr("stroke", "#1c2839");
  if (Number.isFinite(refValue)) {
    svg.append("line").attr("x1", margin.left).attr("x2", width - margin.right).attr("y1", y(refValue)).attr("y2", y(refValue))
      .attr("stroke", "#4fd8ff").attr("stroke-width", 1).attr("stroke-dasharray", "3 3").attr("opacity", 0.85);
    svg.append("text").attr("x", margin.left + 4).attr("y", y(refValue) - 6).attr("font-size", 10).attr("font-family", "var(--mono)")
      .attr("fill", "#4fd8ff").text(refLabel || "");
  }
  const line = d3.line().x((d) => x(d[0])).y((d) => y(d[1])).curve(d3.curveMonotoneX);
  const path = svg.append("path").attr("d", line(values)).attr("fill", "none").attr("stroke", color).attr("stroke-width", 2.2);
  if (!REDUCED && gsap) {
    const length = path.node().getTotalLength();
    path.attr("stroke-dasharray", length).attr("stroke-dashoffset", length);
    gsap.to(path.node(), { strokeDashoffset: 0, duration: 1.6, ease: "power2.out", scrollTrigger: { trigger: mount, start: "top 82%" } });
  }
  const first = values[0];
  svg.append("circle").attr("cx", x(first[0])).attr("cy", y(first[1])).attr("r", 2.4).attr("fill", "none").attr("stroke", color).attr("stroke-width", 1.2);
  const last = values[values.length - 1];
  svg.append("circle").attr("cx", x(last[0])).attr("cy", y(last[1])).attr("r", 3).attr("fill", color);
  svg.append("text").attr("x", x(last[0]) + 7).attr("y", y(last[1]) + 4).attr("font-size", MOBILE ? 10 : 11.5).attr("font-weight", 600)
    .attr("fill", color).attr("font-family", "var(--mono)").text(`${last[0]}年 ${fmt(last[1])}`);
  return { x, y, width, height: h, margin };
}

/* ================================================================ 03 TWO YARDSTICKS */

function initYardsticks(scisci, indicators) {
  const citedBlock = scisci?.cited_top10;
  const papersBlock = indicators?.papers;
  const openalexBlock = indicators?.openalex;

  const mountA = $("#yard-openalex");
  if (mountA) {
    if (citedBlock?.status === "ok") {
      const exclude = citedBlock.unstable_years || citedBlock.partial_years || [];
      const values = dictToPairs(citedBlock.share, exclude).map(([y, v]) => [y, v * 100]);
      drawRefLineChart(mountA, {
        values, color: "#ffb545", refValue: 10, refLabel: "無作為なら10%（期待値）",
        ariaLabel: "OpenAlexの被引用度Top10%論文が、日本の論文全体に占める比率",
        valueFmt: (v) => fmtPct(v),
      });
      const first = values[0], last = values[values.length - 1];
      if (first && last) setText("#yard-openalex-fact", `${first[0]}年${fmtPct(first[1])}→${last[0]}年${fmtPct(last[1])}`);
      setText("#yard-openalex-source", `出典: ${citedBlock.source?.title || "OpenAlex"}。${citedBlock.note || ""} OpenAlexの索引が安定しない直近年（${exclude.join("・")}年）は表示していない。`);
    } else {
      mountA.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>';
      setText("#yard-openalex-source", "出典を取得できませんでした。");
    }
  }

  const mountB = $("#yard-nistep");
  if (mountB) {
    if (papersBlock?.status === "ok") {
      const values = computeNistepRatio(papersBlock);
      drawRefLineChart(mountB, {
        values, color: "#4fd8ff", refValue: 1, refLabel: "1.0＝論文量並みのTop10%",
        ariaLabel: "Top10%補正論文数シェアを論文数シェアで割った比率（NISTEP・整数カウント）",
        valueFmt: (v) => v.toFixed(2),
      });
      const last = values[values.length - 1];
      if (last) setText("#yard-nistep-fact", `${last[0]}年 ${last[1].toFixed(2)}`);
      setText("#yard-nistep-source", `出典: ${papersBlock.source?.title || "NISTEP"}。Top10%補正論文数シェア÷論文数シェア（整数カウント、NISTEP表4-1-7、3年移動平均）。${papersBlock.note || ""} Q値（NISTEPの分数カウント補正指標）とは算出方法の前提が異なる単純比率で、そう呼んでいない。`);
    } else {
      mountB.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>';
      setText("#yard-nistep-source", "出典を取得できませんでした。");
    }
  }

  const mountC = $("#yard-collab");
  if (mountC) {
    if (openalexBlock?.status === "ok") {
      const values = computeIntlCollabSeries(openalexBlock, 2024);
      drawRefLineChart(mountC, {
        values, color: "#8b96ab", height: 190,
        ariaLabel: "日本の論文に占める国際共著論文の割合",
        valueFmt: (v) => fmtPct(v),
      });
      const first = values[0], last = values[values.length - 1];
      if (first && last) setText("#yard-collab-fact", `${first[0]}年${fmtPct(first[1])}→${last[0]}年${fmtPct(last[1])}`);
      setText("#yard-collab-source", `出典: ${openalexBlock.source?.title || "OpenAlex"}。国際共著論文（複数国の著者所属を含む論文、whole counting）数 ÷ 日本の論文総数（type:article）。${openalexBlock.note || ""}`);
    } else {
      mountC.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>';
      setText("#yard-collab-source", "出典を取得できませんでした。");
    }
  }
}

/* ================================================================ 04 TOP JOURNAL PENETRATION */

function initTopJournals(scisci) {
  const mount = $("#topjournals-chart");
  const block = scisci?.top_journals;
  const totalsBlock = scisci?.totals;
  if (!mount) return;
  if (!block || block.status !== "ok") {
    mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>';
    setText("#topjournals-source", "出典を取得できませんでした。");
    return;
  }
  const exclude = block.partial_years || [];
  const shareValues = dictToPairs(block.series.jp_share, exclude).map(([y, v]) => [y, v * 100]);
  const jpCounts = new Map(dictToPairs(block.series.jp, exclude));
  drawRefLineChart(mount, {
    values: shareValues, color: "#ffb545", height: Math.max(320, (mount.clientWidth || 900) * 0.36),
    ariaLabel: "Nature・Science・Cell・PNAS・Nature Communications 5誌に占める日本の論文シェア",
    valueFmt: (v) => fmtPct(v, 2),
  });

  /* 見出しの数字は2000→2023年（両年ともpartial_years対象外）に固定し、5誌シェアの伸びを
     日本の論文総数（totalsブロック）の伸びと対比する */
  const y0 = 2000, y1 = 2023;
  const share0 = block.series.jp_share?.[y0], share1 = block.series.jp_share?.[y1];
  const count0 = jpCounts.get(y0), count1 = jpCounts.get(y1);
  const totalsJp = totalsBlock?.status === "ok" ? new Map(dictToPairs(totalsBlock.series.jp, totalsBlock.partial_years)) : null;
  const total0 = totalsJp?.get(y0), total1 = totalsJp?.get(y1);
  if (share0 != null && share1 != null && count0 && count1) {
    const journalGrowth = Math.round(((count1 / count0) - 1) * 100);
    const totalGrowthText = total0 && total1 ? `、同じ期間の日本の論文総数の伸び（+${Math.round(((total1 / total0) - 1) * 100)}%）を上回るペースで増えている` : "";
    setText("#topjournals-lede", `${y0}年${fmtPct(share0 * 100, 2)}だった日本のシェアは${y1}年${fmtPct(share1 * 100, 2)}へ。この間、5誌の日本発論文は${fmtInt(count0)}本から${fmtInt(count1)}本（+${journalGrowth}%）${totalGrowthText}。`);
  }
  setText("#topjournals-source", `出典: ${block.source?.title || "OpenAlex"}。対象5誌: Nature・Science・Cell・PNAS・Nature Communications（編集部選定の総合科学系高被引用誌、恣意性あり）。${block.note || ""} OpenAlexの索引が安定しない直近年（${exclude.join("・")}年）は表示していない。`);
}

/* ================================================================ 05 THE AGE OF TEAMS */

function initTeams(scisci) {
  const mount = $("#teams-chart");
  const block = scisci?.team_size;
  if (!mount) return;
  if (!block || block.status !== "ok") {
    mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>';
    setText("#teams-source", "出典を取得できませんでした。");
    return;
  }
  mount.innerHTML = "";
  const exclude = block.partial_years || [];
  const large = dictToPairs(block.large_team?.share, exclude).map(([y, v]) => [y, v * 100]);
  const single = dictToPairs(block.single_institution?.share, exclude).map(([y, v]) => [y, v * 100]);
  if (!large.length || !single.length) {
    mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>';
    setText("#teams-source", "出典を取得できませんでした。");
    return;
  }
  const width = mount.clientWidth || 900, height = Math.max(340, Math.min(480, width * 0.42));
  const margin = { top: 26, right: MOBILE ? 108 : 150, bottom: 32, left: 46 };
  const allYears = [...large, ...single].map(([y]) => y);
  const x = d3.scaleLinear().domain(d3.extent(allYears)).range([margin.left, width - margin.right]);
  const maxY = Math.max(d3.max(large, (d) => d[1]), d3.max(single, (d) => d[1])) * 1.08;
  const y = d3.scaleLinear().domain([0, maxY]).range([height - margin.bottom, margin.top]);
  const svg = d3.select(mount).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img")
    .attr("aria-label", "著者11人以上の大規模チーム論文の比率と、単一機関のみで完結する論文の比率の推移");
  baseAxis(svg.append("g").attr("class", "axis").attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(5).tickFormat((v) => `${v}%`).tickSize(-(width - margin.left - margin.right))));
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).ticks(MOBILE ? 5 : 9).tickFormat(d3.format("d"))).select(".domain").attr("stroke", "#1c2839");

  const series = [
    { label: "大規模チーム", color: "#ffb545", values: large },
    { label: "単一機関のみ", color: "#4fd8ff", values: single },
  ];
  for (const s of series) {
    const path = svg.append("path")
      .attr("d", d3.line().x((d) => x(d[0])).y((d) => y(d[1])).curve(d3.curveMonotoneX)(s.values))
      .attr("fill", "none").attr("stroke", s.color).attr("stroke-width", 2.2);
    if (!REDUCED && gsap) {
      const length = path.node().getTotalLength();
      path.attr("stroke-dasharray", length).attr("stroke-dashoffset", length);
      gsap.to(path.node(), { strokeDashoffset: 0, duration: 1.8, ease: "power2.out", scrollTrigger: { trigger: mount, start: "top 78%" } });
    }
    const last = s.values[s.values.length - 1];
    svg.append("text").attr("x", x(last[0]) + 7).attr("y", y(last[1]) + 4).attr("font-size", MOBILE ? 10 : 11.5).attr("font-weight", 600)
      .attr("fill", s.color).attr("font-family", "var(--mono)")
      .text(`${s.label} ${last[1].toFixed(1)}%`);
  }

  const largeFirst = large[0], largeLast = large[large.length - 1];
  const singleFirst = single[0], singleLast = single[single.length - 1];
  setText("#teams-lede", `著者11人以上の大規模チーム論文は${largeFirst[0]}年${fmtPct(largeFirst[1])}から${largeLast[0]}年${fmtPct(largeLast[1])}へ上昇。単一機関のみで完結する論文は${singleFirst[0]}年${fmtPct(singleFirst[1])}から${singleLast[0]}年${fmtPct(singleLast[1])}へ低下。一人と一機関で完結する研究が減り、大人数・多機関連携へ。`);
  setText("#teams-source", `出典: ${block.source?.title || "OpenAlex"}。${block.note || ""} OpenAlexの索引が安定しない直近年（${exclude.join("・")}年）は表示していない。`);
}

/* ==== papers: scisci wave B (2026-08) ==== */

/* 0基準の年次棒グラフ（単色系列・任意の1年に強調色でラベル） */
function drawYearBarChart(mount, { values, color, highlightYear, highlightColor, highlightLabel, height, ariaLabel, valueFmt, titleFmt, tickCount }) {
  mount.innerHTML = "";
  if (!values.length) { mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>'; return null; }
  const fmt = valueFmt || ((v) => fmtInt(v));
  const width = mount.clientWidth || 420;
  const h = height || Math.max(200, width * 0.5);
  const margin = { top: 26, right: 12, bottom: 26, left: 36 };
  const x = d3.scaleBand().domain(values.map((d) => d[0])).range([margin.left, width - margin.right]).padding(0.16);
  const maxV = d3.max(values, (d) => d[1]) * 1.18;
  const y = d3.scaleLinear().domain([0, maxV]).range([h - margin.bottom, margin.top]);
  const svg = d3.select(mount).append("svg").attr("viewBox", `0 0 ${width} ${h}`).attr("role", "img").attr("aria-label", ariaLabel || "");
  baseAxis(svg.append("g").attr("class", "axis").attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(4).tickFormat(fmt).tickSize(-(width - margin.left - margin.right))));
  const step = Math.max(1, Math.ceil(values.length / (tickCount || (MOBILE ? 4 : 7))));
  const tickYears = values.filter((d, i) => i % step === 0 || i === values.length - 1).map((d) => d[0]);
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${h - margin.bottom})`)
    .call(d3.axisBottom(x).tickValues(tickYears).tickFormat(d3.format("d"))).select(".domain").attr("stroke", "#1c2839");
  const bars = svg.append("g").selectAll("rect").data(values).join("rect")
    .attr("x", (d) => x(d[0])).attr("width", x.bandwidth())
    .attr("y", (d) => y(d[1])).attr("height", (d) => h - margin.bottom - y(d[1]))
    .attr("fill", (d) => (highlightYear != null && d[0] === highlightYear ? (highlightColor || "#ff7a45") : color));
  bars.append("title").text((d) => (titleFmt ? titleFmt(d) : `${d[0]}年 ${fmt(d[1])}`));
  if (!REDUCED && gsap) {
    gsap.from(bars.nodes(), { attr: { height: 0, y: h - margin.bottom }, duration: 0.9, ease: "power3.out", stagger: 0.01, scrollTrigger: { trigger: mount, start: "top 84%" } });
  }
  if (highlightYear != null) {
    const hit = values.find((d) => d[0] === highlightYear);
    if (hit) {
      svg.append("text").attr("x", x(highlightYear) + x.bandwidth() / 2).attr("y", y(hit[1]) - 8)
        .attr("text-anchor", "middle").attr("font-size", MOBILE ? 9.5 : 10.5).attr("font-weight", 600)
        .attr("fill", highlightColor || "#ff7a45").attr("font-family", "var(--mono)")
        .text(highlightLabel || `${highlightYear}年 ${fmt(hit[1])}`);
    }
  }
  return { x, y, width, height: h, margin };
}

/* ================================================================ 06 DOMESTIC JOURNALS */

function initDomestic(scisci) {
  const domestic = scisci?.domestic_journals;
  const language = scisci?.language_ja;

  const mount = $("#domestic-chart");
  if (mount) {
    if (domestic?.status === "ok") {
      const values = dictToPairs(domestic.share).map(([y, v]) => [y, v * 100]);
      const geom = drawRefLineChart(mount, {
        values, color: "#ffb545", height: Math.max(280, (mount.clientWidth || 900) * 0.32),
        ariaLabel: "日本の学会・協会発行の査読誌39誌への掲載シェアの推移",
        valueFmt: (v) => fmtPct(v, 1),
      });
      const first = values[0], last = values[values.length - 1];
      if (geom && first) {
        d3.select(mount).select("svg").append("text")
          .attr("x", geom.x(first[0]) + 7).attr("y", geom.y(first[1]) - 9)
          .attr("font-size", MOBILE ? 10 : 11.5).attr("font-weight", 600).attr("fill", "#ffb545")
          .attr("font-family", "var(--mono)").text(`${first[0]}年 ${fmtPct(first[1], 1)}`);
      }
      if (first && last) setText("#domestic-fact", `${first[0]}年${fmtPct(first[1], 1)}→${last[0]}年${fmtPct(last[1], 1)}`);
      setText("#domestic-source", `出典: ${domestic.source?.title || "OpenAlex"}。${domestic.note || ""} Scientific Reports誌1誌だけで、このリスト上位4誌（Japanese Journal of Applied Physics・Internal Medicine・Circulation Journal・日本内科学会雑誌）の2023年JP掲載数の合計を超える。`);
    } else {
      mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>';
      setText("#domestic-source", "出典を取得できませんでした。");
    }
  }

  const mountLang = $("#domestic-lang-chart");
  if (mountLang) {
    if (language?.status === "ok") {
      const exclude = language.partial_years || [];
      const values = dictToPairs(language.share, exclude).map(([y, v]) => [y, v * 100]);
      drawRefLineChart(mountLang, {
        values, color: "#4fd8ff", height: 190,
        ariaLabel: "日本語で書かれた論文の割合の推移",
        valueFmt: (v) => fmtPct(v, 2),
      });
      const first = values[0], last = values[values.length - 1];
      if (first && last) setText("#domestic-lang-fact", `${first[0]}年${fmtPct(first[1], 2)}→${last[0]}年${fmtPct(last[1], 2)}`);
      setText("#domestic-lang-source", `出典: ${language.source?.title || "OpenAlex"}。${language.note || ""}`);
    } else {
      mountLang.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>';
      setText("#domestic-lang-source", "出典を取得できませんでした。");
    }
  }

  const listMount = $("#domestic-journal-list");
  if (listMount) {
    if (domestic?.status === "ok" && Array.isArray(domestic.journals) && domestic.journals.length) {
      listMount.innerHTML = `<ul class="domestic-journal-ul">${domestic.journals
        .map((j) => `<li><span class="dj-name">${escapeHtml(j.name || "")}</span><span class="dj-pub">${escapeHtml(j.publisher || "")}</span></li>`)
        .join("")}</ul>`;
    } else {
      listMount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>';
    }
  }
}

/* ================================================================ 07 A SYSTEM OF SCIENCE */

function renderSystemRetractions(scisci) {
  const mount = $("#system-retract-chart");
  const block = scisci?.retractions;
  if (!mount) return;
  if (!block || block.status !== "ok") {
    mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>';
    setText("#system-retract-source", "出典を取得できませんでした。");
    return;
  }
  const exclude = block.partial_years || [];
  const values = dictToPairs(block.series, exclude);
  const spikeYear = 2022;
  const hasSpike = values.some((d) => d[0] === spikeYear);
  drawYearBarChart(mount, {
    values, color: "#4fd8ff",
    highlightYear: hasSpike ? spikeYear : null, highlightColor: "#ff7a45",
    highlightLabel: hasSpike ? `${spikeYear}年 ${fmtInt(block.series[spikeYear] ?? 0)}件` : "",
    titleFmt: (d) => `${d[0]}年 ${fmtInt(d[1])}件（率 ${((block.rate?.[d[0]] ?? 0) * 100).toFixed(3)}%）`,
    height: 210,
    ariaLabel: "日本の論文の年次撤回件数",
    valueFmt: (v) => `${fmtInt(v)}件`,
  });
  const last = values[values.length - 1];
  const rateLast = last ? block.rate?.[last[0]] : null;
  if (last) setText("#system-retract-fact", `${last[0]}年 ${fmtInt(last[1])}件${rateLast != null ? `（率 ${(rateLast * 100).toFixed(3)}%）` : ""}`);
  const topField = (block.by_field || [])[0];
  setText("#system-retract-source", `出典: ${block.source?.title || "OpenAlex"}。${block.note || ""}${topField ? ` 全期間累計の分野内訳トップは${topField.name}（${fmtInt(topField.count)}件）。` : ""} authorships.countries:jpはwhole counting。OpenAlex CC0。`);
}

const OA_COLORS = { closed: "#2a3444", bronze: "#c9834f", hybrid: "#8d7fb0", green: "#5ad8a1", gold: "#ffb545", diamond: "#4fd8ff" };
const OA_LABELS = { closed: "クローズド", gold: "ゴールドOA", diamond: "ダイヤモンドOA", green: "グリーンOA", bronze: "ブロンズOA", hybrid: "ハイブリッドOA" };
const OA_STACK_ORDER = ["closed", "bronze", "hybrid", "green", "gold", "diamond"]; /* 下から上へ。closedが底・diamondが最上段 */

function renderSystemOa(scisci) {
  const mount = $("#system-oa-chart");
  const block = scisci?.oa_status;
  if (!mount) return;
  if (!block || block.status !== "ok" || !Array.isArray(block.statuses) || !block.statuses.length) {
    mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>';
    setText("#system-oa-source", "出典を取得できませんでした。");
    return;
  }
  mount.innerHTML = "";
  const keys = OA_STACK_ORDER.filter((k) => block.statuses.includes(k));
  const excludeSet = new Set(block.partial_years || []);
  const years = (block.years || []).filter((y) => !excludeSet.has(y));
  const rows = years.map((year) => {
    const row = { year };
    for (const key of keys) row[key] = (block.share?.[key]?.[year] ?? 0) * 100;
    return row;
  });
  if (!rows.length) { mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>'; return; }
  const width = mount.clientWidth || 420, height = 230;
  const margin = { top: 20, right: MOBILE ? 62 : 90, bottom: 24, left: 30 };
  const series = d3.stack().keys(keys)(rows);
  const x = d3.scaleLinear().domain(d3.extent(years)).range([margin.left, width - margin.right]);
  const y = d3.scaleLinear().domain([0, 100]).range([height - margin.bottom, margin.top]);
  const svg = d3.select(mount).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img")
    .attr("aria-label", "日本の論文のオープンアクセス種別シェアの推移（積み上げ面グラフ）");
  baseAxis(svg.append("g").attr("class", "axis").attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(4).tickFormat((v) => `${v}%`).tickSize(-(width - margin.left - margin.right))));
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).ticks(MOBILE ? 4 : 6).tickFormat(d3.format("d"))).select(".domain").attr("stroke", "#1c2839");
  const area = d3.area().x((d) => x(d.data.year)).y0((d) => y(d[0])).y1((d) => y(d[1])).curve(d3.curveMonotoneX);
  const paths = svg.append("g").selectAll("path").data(series).join("path")
    .attr("d", area).attr("fill", (d) => OA_COLORS[d.key] || "#64748f").attr("opacity", 0.9);
  if (!REDUCED && gsap) {
    gsap.from(paths.nodes(), { opacity: 0, duration: 1, stagger: 0.05, ease: "power1.out", scrollTrigger: { trigger: mount, start: "top 84%" } });
  }
  const lastYear = years[years.length - 1];
  const labelRows = [];
  for (const s of series) {
    const last = s.find((d) => d.data.year === lastYear);
    if (last) labelRows.push({ key: s.key, ny: y((last[0] + last[1]) / 2), value: last.data[s.key] });
  }
  const minGap = MOBILE ? 11 : 13;
  for (let i = 1; i < labelRows.length; i += 1) {
    if (labelRows[i - 1].ny - labelRows[i].ny < minGap) labelRows[i].ny = labelRows[i - 1].ny - minGap;
  }
  for (const row of labelRows) {
    svg.append("text").attr("x", x(lastYear) + 6).attr("y", row.ny + 3)
      .attr("font-size", MOBILE ? 8.5 : 9.5).attr("font-family", "var(--mono)")
      .attr("fill", OA_COLORS[row.key]).attr("font-weight", 600)
      .text(`${OA_LABELS[row.key] || row.key} ${row.value.toFixed(0)}%`);
  }
  const closedFirst = rows[0]?.closed, closedLast = rows[rows.length - 1]?.closed;
  if (closedFirst != null && closedLast != null) {
    setText("#system-oa-fact", `クローズド ${years[0]}年${closedFirst.toFixed(0)}%→${lastYear}年${closedLast.toFixed(0)}%`);
  }
  setText("#system-oa-source", `出典: ${block.source?.title || "OpenAlex"}。${block.note || ""} diamond＝著者負担も読者負担もない誌（J-STAGE系に多い）。authorships.countries:jpはwhole counting。OpenAlex CC0。`);
}

function renderSystemPreprints(scisci) {
  const mount = $("#system-preprint-chart");
  const block = scisci?.preprints;
  if (!mount) return;
  if (!block || block.status !== "ok") {
    mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>';
    setText("#system-preprint-source", "出典を取得できませんでした。");
    return;
  }
  const exclude = block.partial_years || [];
  const values = dictToPairs(block.share, exclude).map(([y, v]) => [y, v * 100]);
  const geom = drawRefLineChart(mount, {
    values, color: "#8d7fb0", height: 210,
    ariaLabel: "日本の論文に占めるプレプリントの割合の推移",
    valueFmt: (v) => fmtPct(v, 2),
  });
  const at2018 = values.find((d) => d[0] === 2018);
  if (geom && at2018) {
    const svg = d3.select(mount).select("svg");
    svg.append("circle").attr("cx", geom.x(at2018[0])).attr("cy", geom.y(at2018[1])).attr("r", 2.6).attr("fill", "#8d7fb0");
    svg.append("text").attr("x", geom.x(at2018[0])).attr("y", geom.y(at2018[1]) - 10)
      .attr("text-anchor", "middle").attr("font-size", MOBILE ? 9 : 10).attr("font-family", "var(--mono)")
      .attr("fill", "#8d7fb0").text(`${at2018[0]}年 ${fmtPct(at2018[1], 2)}`);
  }
  const last = values[values.length - 1];
  if (at2018 && last && at2018[1] > 0) {
    const multiple = last[1] / at2018[1];
    setText("#system-preprint-fact", `${at2018[0]}年→${last[0]}年で${multiple.toFixed(1)}倍に加速`);
  }
  setText("#system-preprint-source", `出典: ${block.source?.title || "OpenAlex"}。${block.note || ""} authorships.countries:jpはwhole counting。OpenAlex CC0。`);
}

const CONC_COLORS = { top1: "#ffb545", top5: "#4fd8ff", top10: "#5a6d8c" };

function renderSystemConcentration(scisci) {
  const mount = $("#system-conc-chart");
  const block = scisci?.concentration;
  if (!mount) return;
  if (!block || block.status !== "ok") {
    mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>';
    setText("#system-conc-source", "出典を取得できませんでした。");
    return;
  }
  mount.innerHTML = "";
  const years = (block.years || []).filter((y) => block.series?.[y]);
  const rows = years.map((year) => {
    const s = block.series[year];
    return { year, top1: s.top1_share * 100, top5: s.top5_share * 100, top10: s.top10_share * 100 };
  });
  if (!rows.length) { mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>'; return; }
  const metrics = ["top1", "top5", "top10"];
  const width = mount.clientWidth || 420, height = 230;
  const margin = { top: 26, right: 12, bottom: 26, left: 34 };
  const x0 = d3.scaleBand().domain(rows.map((r) => r.year)).range([margin.left, width - margin.right]).padding(0.28);
  const x1 = d3.scaleBand().domain(metrics).range([0, x0.bandwidth()]).padding(0.14);
  const maxV = d3.max(rows, (r) => r.top10) * 1.2;
  const y = d3.scaleLinear().domain([0, maxV]).range([height - margin.bottom, margin.top]);
  const svg = d3.select(mount).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img")
    .attr("aria-label", "日本の論文産出の機関集中度（上位1・5・10機関シェア）の推移");
  baseAxis(svg.append("g").attr("class", "axis").attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(4).tickFormat((v) => `${v}%`).tickSize(-(width - margin.left - margin.right))));
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x0).tickFormat((yr) => `${yr}年`)).select(".domain").attr("stroke", "#1c2839");
  const groups = svg.append("g").selectAll("g").data(rows).join("g").attr("transform", (r) => `translate(${x0(r.year)},0)`);
  const bars = groups.selectAll("rect").data((r) => metrics.map((m) => ({ metric: m, value: r[m], year: r.year }))).join("rect")
    .attr("x", (d) => x1(d.metric)).attr("width", x1.bandwidth())
    .attr("y", (d) => y(d.value)).attr("height", (d) => height - margin.bottom - y(d.value))
    .attr("fill", (d) => CONC_COLORS[d.metric]);
  bars.append("title").text((d) => `${d.year}年 上位${d.metric.replace("top", "")}機関 ${d.value.toFixed(1)}%`);
  if (!REDUCED && gsap) {
    gsap.from(bars.nodes(), { attr: { height: 0, y: height - margin.bottom }, duration: 0.9, ease: "power3.out", stagger: 0.02, scrollTrigger: { trigger: mount, start: "top 84%" } });
  }
  const legend = svg.append("g").attr("transform", `translate(${margin.left},14)`);
  metrics.forEach((m, i) => {
    const row = legend.append("g").attr("transform", `translate(${i * 72},0)`);
    row.append("rect").attr("width", 8).attr("height", 8).attr("y", -7).attr("fill", CONC_COLORS[m]);
    row.append("text").attr("x", 12).attr("font-size", 9.5).attr("fill", "var(--dim)").attr("font-family", "var(--mono)").text(`上位${m.replace("top", "")}`);
  });
  const lastRow = rows[rows.length - 1];
  const topInst = block.series[lastRow.year]?.top15?.[0];
  setText("#system-conc-fact", `${lastRow.year}年 上位1機関${lastRow.top1.toFixed(1)}% 上位10機関${lastRow.top10.toFixed(1)}%`);
  setText("#system-conc-source", `出典: ${block.source?.title || "OpenAlex"}。${block.note || ""}${topInst ? ` ${lastRow.year}年の上位1機関は${topInst.name}。` : ""} OpenAlex CC0。`);
}

function initSystem(scisci) {
  renderSystemRetractions(scisci);
  renderSystemOa(scisci);
  renderSystemPreprints(scisci);
  renderSystemConcentration(scisci);
}

/* ================================================================ boot */

async function init() {
  bootFooter();
  initRail();
  const [indicatorsResult, topicsResult, scisciResult] = await Promise.allSettled([
    fetchJson("data/indicators.json"), fetchJson("data/topics.json"), fetchJson("data/scisci.json"),
  ]);
  const indicators = indicatorsResult.status === "fulfilled" ? indicatorsResult.value.indicators : null;
  const topics = topicsResult.status === "fulfilled" ? topicsResult.value : null;
  const scisci = scisciResult.status === "fulfilled" ? scisciResult.value : null;
  if (!indicators) {
    setText("#header-status", "研究データを取得できません");
    return;
  }
  $("#header-status-dot")?.classList.add("is-live");
  const shareValues = seriesMap(indicators.papers, "share").jp || [];
  if (shareValues.length) {
    const peak = shareValues.reduce((a, b) => (b[1] > a[1] ? b : a));
    const last = lastPoint(shareValues);
    setText("#papers-lede", `日本が世界の論文に占める割合はピーク時${fmtPct(peak[1])}、直近は${fmtPct(last[1])}。論文数・注目論文・分野構成・機関を観測。`);
    setText("#header-status", `観測中 — 7か国×${shareValues[0][0]}–${last[0]}年 / 4系統の公開データ`);
  } else {
    setText("#header-status", "観測中 — 研究データ");
  }

  initRace(indicators);
  initTerrain(indicators);
  renderInstitutions(indicators);
  try {
    initThemeBump(topics);
  } catch (error) {
    console.error(error);
    const mount = $("#themes-stream");
    if (mount) mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>';
  }
  try {
    initYardsticks(scisci, indicators);
  } catch (error) {
    console.error(error);
    ["#yard-openalex", "#yard-nistep", "#yard-collab"].forEach((sel) => {
      const mount = $(sel);
      if (mount) mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>';
    });
  }
  try {
    initTopJournals(scisci);
  } catch (error) {
    console.error(error);
    const mount = $("#topjournals-chart");
    if (mount) mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>';
  }
  try {
    initTeams(scisci);
  } catch (error) {
    console.error(error);
    const mount = $("#teams-chart");
    if (mount) mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>';
  }
  try {
    initDomestic(scisci);
  } catch (error) {
    console.error(error);
    ["#domestic-chart", "#domestic-lang-chart"].forEach((sel) => {
      const mount = $(sel);
      if (mount) mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>';
    });
  }
  try {
    initSystem(scisci);
  } catch (error) {
    console.error(error);
    ["#system-retract-chart", "#system-oa-chart", "#system-preprint-chart", "#system-conc-chart"].forEach((sel) => {
      const mount = $(sel);
      if (mount) mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>';
    });
  }
  renderLedgerEntries([
    blockEntry(indicators.papers), blockEntry(indicators.field_share), blockEntry(indicators.openalex), blockEntry(topics, "OpenAlex API"),
    blockEntry(scisci?.cited_top10, "OpenAlex Works API"), blockEntry(scisci?.top_journals, "OpenAlex Works API"), blockEntry(scisci?.team_size, "OpenAlex Works API"),
    blockEntry(scisci?.domestic_journals, "OpenAlex Works API"), blockEntry(scisci?.language_ja, "OpenAlex Works API"),
    blockEntry(scisci?.retractions, "OpenAlex Works API"), blockEntry(scisci?.oa_status, "OpenAlex Works API"),
    blockEntry(scisci?.preprints, "OpenAlex Works API"), blockEntry(scisci?.concentration, "OpenAlex Works API"),
  ].filter(Boolean));
}

init().catch((error) => {
  console.error(error);
  setText("#header-status", "研究データを取得できません");
});
