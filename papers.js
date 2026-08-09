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
    initThemeBump(topics);
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
