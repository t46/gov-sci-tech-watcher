/* SCIENCE SIGNAL / PEOPLE — 研究人材の観測ページ。obs-core.js の後に読み込む。 */
"use strict";

/* ================================================================ 01 PHD */

function renderPhdIntl(indicators) {
  const mount = $("#phd-intl");
  const block = indicators?.phd_degrees;
  if (!mount || !block || block.status !== "ok") { if (mount) mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>'; return; }
  mount.innerHTML = "";
  const data = seriesMap(block);
  const KEYS = Object.keys(data).filter((k) => COLORS[k] && data[k]?.length);
  if (!KEYS.length) { mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>'; return; }
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
  const rows = block.rows || [];
  if (!rows.length) { mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>'; return; }
  const fields = Object.keys(rows[rows.length - 1].fields || {});
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

const FIELD_COLORS = {
  "人文科学": "#8d7fb0", "社会科学": "#5ad8a1", "理学": "#4fd8ff", "工学": "#ffb545",
  "農学": "#c9a76a", "保健": "#a06a8c", "その他": "#59687f", "人文社会科学": "#8d7fb0",
};
const FIELD_SHORT = {
  "人文科学": "人文", "社会科学": "社会", "理学": "理学", "工学": "工学",
  "農学": "農学", "保健": "保健", "その他": "他", "人文社会科学": "人文社会",
};

function renderPhdAdvanceRate(indicators) {
  const mount = $("#phd-advance");
  const block = indicators?.phd_advance_rate;
  if (!mount || !block || block.status !== "ok") { if (mount) mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>'; return; }
  mount.innerHTML = "";
  const rows = block.rows || [];
  if (!rows.length) { mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>'; return; }
  const fields = Object.keys(rows[rows.length - 1].fields || {});
  const width = mount.clientWidth || 900, height = Math.max(360, width * 0.42);
  const margin = { top: 24, right: 84, bottom: 34, left: 40 };
  const x = d3.scaleLinear().domain(d3.extent(rows, (r) => r.year)).range([margin.left, width - margin.right]);
  const maxV = d3.max(rows, (r) => d3.max(fields, (f) => r.fields[f] ?? 0));
  const y = d3.scaleLinear().domain([0, maxV * 1.05]).range([height - margin.bottom, margin.top]);
  const svg = d3.select(mount).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img")
    .attr("aria-label", "修士課程修了者の進学率の専攻別推移。工学は一貫して10%を下回る。");
  const gy = svg.append("g").attr("class", "axis").attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(5).tickFormat((v) => `${v}%`).tickSize(-(width - margin.left - margin.right)));
  gy.select(".domain").remove();
  gy.selectAll("line").attr("stroke", "#16202f").attr("stroke-dasharray", "2 4");
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).ticks(8).tickFormat(d3.format("d"))).select(".domain").attr("stroke", "#1c2839");
  svg.append("line").attr("x1", margin.left).attr("x2", width - margin.right).attr("y1", y(10)).attr("y2", y(10))
    .attr("stroke", "#4c5a72").attr("stroke-dasharray", "3 4");
  svg.append("text").attr("x", margin.left + 4).attr("y", y(10) - 6).attr("class", "annot-sub").text("10%");

  const line = d3.line().x((d) => x(d.year)).y((d) => y(d.value)).curve(d3.curveMonotoneX);
  const seriesFor = (field) => rows.filter((r) => r.fields[field] != null).map((r) => ({ year: r.year, value: r.fields[field] }));
  const tips = fields.map((f) => { const pts = seriesFor(f); const last = pts[pts.length - 1]; return { field: f, y: last ? y(last.value) : 0 }; }).sort((a, b) => a.y - b.y);
  for (let i = 1; i < tips.length; i += 1) { if (tips[i].y - tips[i - 1].y < 13) tips[i].y = tips[i - 1].y + 13; }
  const tipY = Object.fromEntries(tips.map((t) => [t.field, t.y]));
  for (const field of fields) {
    const isEng = field === "工学";
    const pts = seriesFor(field);
    const path = svg.append("path").attr("d", line(pts)).attr("fill", "none")
      .attr("stroke", FIELD_COLORS[field] || "#8b96ab").attr("stroke-width", isEng ? 2.6 : 1.2).attr("opacity", isEng ? 1 : 0.6);
    if (isEng) path.attr("filter", "drop-shadow(0 0 6px rgba(255,181,69,0.5))");
    if (!REDUCED && gsap) {
      const length = path.node().getTotalLength();
      path.attr("stroke-dasharray", length).attr("stroke-dashoffset", length);
      gsap.to(path.node(), { strokeDashoffset: 0, duration: isEng ? 2 : 1.4, ease: "power2.out", scrollTrigger: { trigger: mount, start: "top 75%" } });
    }
    const last = pts[pts.length - 1];
    if (last) {
      svg.append("text").attr("x", x(last.year) + 7).attr("y", tipY[field] + 4)
        .attr("fill", isEng ? FIELD_COLORS["工学"] : "#8b96ab").attr("font-size", isEng ? 12 : 10).attr("font-weight", isEng ? 600 : 400)
        .text(`${FIELD_SHORT[field] || field} ${last.value.toFixed(1)}`);
    }
  }
  const engPts = seriesFor("工学");
  if (engPts.length) {
    const first = engPts[0], last = engPts[engPts.length - 1];
    setText("#phd-advance-source", `出典: ${block.source?.title || ""}。${block.note || ""} 工学は${first.year}年${first.value.toFixed(1)}%→${last.year}年${last.value.toFixed(1)}%、一貫して10%未満。`);
  } else {
    setText("#phd-advance-source", `出典: ${block.source?.title || ""}。${block.note || ""}`);
  }
}

function renderPhdDegreesField(indicators) {
  const mount = $("#phd-degrees-field");
  const block = indicators?.phd_degrees_field;
  if (!mount || !block || block.status !== "ok") { if (mount) mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>'; return; }
  mount.innerHTML = "";
  const rows = (block.rows || []).map((r) => ({ ...r, total: r.total ?? d3.sum(Object.values(r.fields || {})) }));
  if (!rows.length) { mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>'; return; }
  const fields = Object.keys(rows[rows.length - 1].fields || {});
  const color = d3.scaleOrdinal().domain(fields).range(fields.map((f) => FIELD_COLORS[f] || "#64748f"));
  const width = mount.clientWidth || 900, height = Math.max(320, width * 0.4);
  const margin = { top: 20, right: 16, bottom: 34, left: 48 };
  const stack = d3.stack().keys(fields).value((row, key) => row.fields[key] ?? 0);
  const series = stack(rows);
  const x = d3.scaleLinear().domain(d3.extent(rows, (r) => r.year)).range([margin.left, width - margin.right]);
  const y = d3.scaleLinear().domain([0, d3.max(rows, (r) => r.total) * 1.05]).range([height - margin.bottom, margin.top]);
  const svg = d3.select(mount).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img")
    .attr("aria-label", "日本の博士号取得者数の専攻別積み上げ推移。");
  const gy = svg.append("g").attr("class", "axis").attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(5).tickFormat((v) => fmtInt(v)).tickSize(-(width - margin.left - margin.right)));
  gy.select(".domain").remove();
  gy.selectAll("line").attr("stroke", "#16202f").attr("stroke-dasharray", "2 4");
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).ticks(8).tickFormat(d3.format("d"))).select(".domain").attr("stroke", "#1c2839");
  const area = d3.area().x((d) => x(d.data.year)).y0((d) => y(d[0])).y1((d) => y(d[1])).curve(d3.curveMonotoneX);
  svg.append("g").selectAll("path").data(series).join("path")
    .attr("d", area).attr("fill", (d) => color(d.key)).attr("opacity", 0.82)
    .append("title").text((d) => d.key);
  const last = rows[rows.length - 1];
  svg.append("text").attr("class", "annot-sub").attr("x", x(last.year) - 4).attr("y", y(last.total) - 10).attr("text-anchor", "end")
    .text(`${last.year}年度 ${fmtInt(last.total)}人`);
  const legend = svg.append("g").attr("transform", `translate(${margin.left + 8},${margin.top + 2})`);
  fields.forEach((field, i) => {
    const row = legend.append("g").attr("transform", `translate(0,${i * 16})`);
    row.append("rect").attr("width", 9).attr("height", 9).attr("y", -8).attr("fill", color(field));
    row.append("text").attr("x", 14).attr("font-size", 10).attr("fill", "#8b96ab").text(`${field} ${fmtInt(last.fields[field] ?? 0)}`);
  });
  setText("#phd-degrees-field-source", `出典: ${block.source?.title || ""}。${block.note || ""}`);
}

/* ================================================================ 01 CAREER STRUCTURE */

const AGE_COLORS = { "25-39歳": "#ffb545", "40-49歳": "#5fb3c9", "50-59歳": "#4f7ca6", "60歳以上": "#445370" };
const AGE_SHORT = { "25-39歳": "25-39", "40-49歳": "40-49", "50-59歳": "50-59", "60歳以上": "60+" };

function renderFacultyAge(indicators) {
  const mount = $("#faculty-age");
  const block = indicators?.faculty_age;
  if (!mount || !block || block.status !== "ok") { if (mount) mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>'; return; }
  mount.innerHTML = "";
  const rows = block.hire_rows || [];
  const allRows = block.all_rows || [];
  if (!rows.length) { mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>'; return; }
  const bands = ["25-39歳", "40-49歳", "50-59歳", "60歳以上"];
  const width = mount.clientWidth || 560, height = Math.max(340, width * 0.62);
  const margin = { top: 20, right: 68, bottom: 34, left: 38 };
  const stack = d3.stack().keys(bands).value((row, key) => row.fields[key] ?? 0);
  const series = stack(rows);
  const x = d3.scaleLinear().domain(d3.extent(rows, (r) => r.year)).range([margin.left, width - margin.right]);
  const y = d3.scaleLinear().domain([0, 100]).range([height - margin.bottom, margin.top]);
  const svg = d3.select(mount).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img")
    .attr("aria-label", "大学の採用教員の年齢階層構成の推移。25-39歳の割合が縮んでいる。");
  const gy = svg.append("g").attr("class", "axis").attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(5).tickFormat((v) => `${v}%`).tickSize(-(width - margin.left - margin.right)));
  gy.select(".domain").remove();
  gy.selectAll("line").attr("stroke", "#16202f").attr("stroke-dasharray", "2 4");
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).ticks(6).tickFormat(d3.format("d"))).select(".domain").attr("stroke", "#1c2839");
  const area = d3.area().x((d) => x(d.data.year)).y0((d) => y(d[0])).y1((d) => y(d[1])).curve(d3.curveMonotoneX);
  svg.append("g").selectAll("path").data(series).join("path")
    .attr("d", area).attr("fill", (d) => AGE_COLORS[d.key]).attr("opacity", (d) => (d.key === "25-39歳" ? 0.92 : 0.55))
    .append("title").text((d) => d.key);
  for (const key of bands) {
    const s = series.find((d) => d.key === key);
    const lastSeg = s[s.length - 1];
    const midY = (y(lastSeg[0]) + y(lastSeg[1])) / 2;
    svg.append("text").attr("x", width - margin.right + 6).attr("y", midY + 3)
      .attr("font-size", 10).attr("font-weight", key === "25-39歳" ? 600 : 400)
      .attr("fill", key === "25-39歳" ? AGE_COLORS[key] : "#8b96ab")
      .text(`${AGE_SHORT[key]} ${(lastSeg[1] - lastSeg[0]).toFixed(0)}%`);
  }
  if (allRows.length) {
    const allLine = d3.line().x((r) => x(r.year)).y((r) => y(r.fields["25-39歳"] ?? 0)).curve(d3.curveMonotoneX);
    svg.append("path").attr("d", allLine(allRows)).attr("fill", "none").attr("stroke", "#e9eef7")
      .attr("stroke-width", 1.2).attr("stroke-dasharray", "2 3").attr("opacity", 0.7);
    const allLast = allRows[allRows.length - 1];
    svg.append("text").attr("x", x(allLast.year)).attr("y", y(allLast.fields["25-39歳"]) - 8).attr("text-anchor", "end")
      .attr("font-size", 9).attr("fill", "#e9eef7").text(`全教員(参考) ${allLast.fields["25-39歳"]}%`);
  }
  setText("#faculty-age-source", `出典: ${block.source?.title || ""}。${block.note || ""}`);
}

function renderFemaleTrend(indicators) {
  const mount = $("#female-trend");
  const block = indicators?.female_researchers;
  if (!mount || !block || block.status !== "ok") { if (mount) mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>'; return; }
  mount.innerHTML = "";
  const series = block.series || [];
  if (!series.length) { mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>'; return; }
  const width = mount.clientWidth || 560, height = Math.max(340, width * 0.62);
  const margin = { top: 24, right: 54, bottom: 34, left: 40 };
  const x = d3.scaleLinear().domain(d3.extent(series, (d) => d[0])).range([margin.left, width - margin.right]);
  const y = d3.scaleLinear().domain([0, d3.max(series, (d) => d[1]) * 1.15]).range([height - margin.bottom, margin.top]);
  const svg = d3.select(mount).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img")
    .attr("aria-label", "日本の女性研究者比率の推移。1981年から長期的には上昇。");
  const gy = svg.append("g").attr("class", "axis").attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(5).tickFormat((v) => `${v}%`).tickSize(-(width - margin.left - margin.right)));
  gy.select(".domain").remove();
  gy.selectAll("line").attr("stroke", "#16202f").attr("stroke-dasharray", "2 4");
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).ticks(6).tickFormat(d3.format("d"))).select(".domain").attr("stroke", "#1c2839");
  const area = d3.area().x((d) => x(d[0])).y0(y(0)).y1((d) => y(d[1])).curve(d3.curveMonotoneX);
  svg.append("path").attr("d", area(series)).attr("fill", "rgba(255,181,69,0.12)");
  const line = d3.line().x((d) => x(d[0])).y((d) => y(d[1])).curve(d3.curveMonotoneX);
  const path = svg.append("path").attr("d", line(series)).attr("fill", "none").attr("stroke", "#ffb545").attr("stroke-width", 2.4)
    .attr("filter", "drop-shadow(0 0 6px rgba(255,181,69,0.5))");
  if (!REDUCED && gsap) {
    const length = path.node().getTotalLength();
    path.attr("stroke-dasharray", length).attr("stroke-dashoffset", length);
    gsap.to(path.node(), { strokeDashoffset: 0, duration: 2, ease: "power2.out", scrollTrigger: { trigger: mount, start: "top 75%" } });
  }
  const first = series[0], last = series[series.length - 1];
  svg.append("text").attr("x", x(last[0]) + 6).attr("y", y(last[1]) + 4).attr("font-size", 12).attr("font-weight", 600).attr("fill", "#ffb545")
    .text(`${last[0]}年 ${last[1]}%`);
  svg.append("text").attr("x", x(first[0]) + 4).attr("y", y(first[1]) - 10).attr("font-size", 10).attr("fill", "#8b96ab")
    .text(`${first[0]}年 ${first[1]}%`);
  setText("#female-trend-source", `出典: ${block.source?.title || ""}。${block.note || ""}`);
}

function renderFemaleIntl(indicators) {
  const mount = $("#female-intl");
  const block = indicators?.female_researchers;
  if (!mount || !block || block.status !== "ok" || !(block.intl || []).length) { if (mount) mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>'; return; }
  mount.innerHTML = "";
  const rows = block.intl;
  const width = mount.clientWidth || 1000, height = Math.max(360, rows.length * 24 + 50);
  const margin = { top: 8, right: 60, bottom: 30, left: 100 };
  const x = d3.scaleLinear().domain([0, d3.max(rows, (r) => r.share) * 1.08]).range([margin.left, width - margin.right]);
  const y = d3.scaleBand().domain(rows.map((r) => r.country)).range([margin.top, height - margin.bottom]).padding(0.3);
  const svg = d3.select(mount).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img")
    .attr("aria-label", "女性研究者比率の国際比較。日本は最下位。");
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).ticks(6).tickFormat((v) => `${v}%`)).select(".domain").attr("stroke", "#1c2839");
  const bars = svg.append("g").selectAll("rect").data(rows).join("rect")
    .attr("x", x(0)).attr("y", (r) => y(r.country)).attr("height", y.bandwidth())
    .attr("width", (r) => x(r.share) - x(0))
    .attr("fill", (r) => (r.country === "日本" ? "#ffb545" : "#4f7ca6")).attr("opacity", (r) => (r.country === "日本" ? 0.95 : 0.55));
  svg.append("g").selectAll("text.flabel").data(rows).join("text")
    .attr("x", margin.left - 8).attr("y", (r) => y(r.country) + y.bandwidth() / 2 + 4)
    .attr("text-anchor", "end").attr("font-size", 11).attr("fill", (r) => (r.country === "日本" ? "#ffb545" : "#e9eef7"))
    .text((r) => r.country);
  svg.append("g").selectAll("text.fvalue").data(rows).join("text")
    .attr("x", (r) => x(r.share) + 6).attr("y", (r) => y(r.country) + y.bandwidth() / 2 + 4)
    .attr("font-size", 10).attr("fill", "#8b96ab").text((r) => `${r.share}%（${r.year}年）`);
  if (!REDUCED && gsap) {
    gsap.from(bars.nodes(), { attr: { width: 0 }, duration: 1, ease: "power3.out", stagger: 0.02, scrollTrigger: { trigger: mount, start: "top 80%" } });
  }
  const jp = rows.find((r) => r.country === "日本");
  setText("#female-intl-source", `出典: ${block.source?.title || ""}。${block.note || ""}${jp ? ` 日本は${rows.length}か国・地域中、最下位（${jp.share}%）。` : ""}`);
}

function renderResearcherDensity(indicators) {
  const mount = $("#researcher-density");
  const block = indicators?.researchers_density;
  if (!mount || !block || block.status !== "ok") { if (mount) mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>'; return; }
  mount.innerHTML = "";
  const data = seriesMap(block);
  const KEYS = ["jp_hc", "us", "de", "fr", "gb", "cn", "kr", "eu27"].filter((k) => data[k]?.length);
  if (!KEYS.length) { mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>'; return; }
  const width = mount.clientWidth || 1000, height = Math.max(360, width * 0.42);
  const margin = { top: 24, right: 84, bottom: 34, left: 44 };
  const allYears = [...KEYS.flatMap((k) => data[k].map(([y]) => y)), ...(data.jp_old || []).map(([y]) => y)];
  const x = d3.scaleLinear().domain(d3.extent(allYears)).range([margin.left, width - margin.right]);
  const maxV = d3.max(KEYS.flatMap((k) => data[k].map(([, v]) => v)));
  const y = d3.scaleLinear().domain([0, maxV * 1.08]).range([height - margin.bottom, margin.top]);
  const svg = d3.select(mount).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img")
    .attr("aria-label", "主要国の人口1万人当たりの研究者数の推移。");
  const gy = svg.append("g").attr("class", "axis").attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(5).tickSize(-(width - margin.left - margin.right)));
  gy.select(".domain").remove();
  gy.selectAll("line").attr("stroke", "#16202f").attr("stroke-dasharray", "2 4");
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).ticks(8).tickFormat(d3.format("d"))).select(".domain").attr("stroke", "#1c2839");
  const line = d3.line().x(([yr]) => x(yr)).y(([, v]) => y(v)).curve(d3.curveMonotoneX);
  if (data.jp_old?.length) {
    svg.append("path").attr("d", line(data.jp_old)).attr("fill", "none").attr("stroke", "#ffb545").attr("stroke-width", 1.4).attr("stroke-dasharray", "2 3").attr("opacity", 0.55);
  }
  const tips = KEYS.map((key) => ({ key, y: y(lastPoint(data[key])[1]) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < tips.length; i += 1) { if (tips[i].y - tips[i - 1].y < 13) tips[i].y = tips[i - 1].y + 13; }
  const tipY = Object.fromEntries(tips.map((t) => [t.key, t.y]));
  for (const key of KEYS) {
    const isJp = key === "jp_hc";
    const path = svg.append("path").attr("d", line(data[key])).attr("fill", "none")
      .attr("stroke", isJp ? COLORS.jp : COLORS[key] || "#8b96ab").attr("stroke-width", isJp ? 2.6 : 1.2).attr("opacity", isJp ? 1 : 0.65);
    if (isJp) path.attr("filter", "drop-shadow(0 0 6px rgba(255,181,69,0.55))");
    if (!REDUCED && gsap) {
      const length = path.node().getTotalLength();
      path.attr("stroke-dasharray", length).attr("stroke-dashoffset", length);
      gsap.to(path.node(), { strokeDashoffset: 0, duration: isJp ? 2.2 : 1.5, ease: "power2.out", scrollTrigger: { trigger: mount, start: "top 75%" } });
    }
    const tip = lastPoint(data[key]);
    svg.append("text").attr("x", x(tip[0]) + 7).attr("y", tipY[key] + 4)
      .attr("fill", isJp ? COLORS.jp : "#8b96ab").attr("font-size", isJp ? 12 : 10).attr("font-weight", isJp ? 600 : 400)
      .text(`${isJp ? "日本" : SHORT[key]} ${tip[1].toFixed(1)}`);
  }
  setText("#researcher-density-source", `出典: ${block.source?.title || ""}。${block.note || ""} 破線は日本の旧定義（2001年まで）。`);
}

function renderFacultyTenure(indicators) {
  const mount = $("#faculty-tenure");
  const block = indicators?.faculty_tenure;
  if (!mount || !block || block.status !== "ok" || !(block.rows || []).length) { if (mount) mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>'; return; }
  mount.innerHTML = "";
  const all = block.rows.find((r) => r.label === "全大学");
  const rows = block.rows.filter((r) => r.label !== "全大学").sort((a, b) => b.share - a.share);
  if (!rows.length) { mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>'; return; }
  const width = mount.clientWidth || 560, height = Math.max(300, rows.length * 40 + 50);
  const margin = { top: 10, right: 60, bottom: 30, left: 84 };
  const x = d3.scaleLinear().domain([0, Math.max(d3.max(rows, (r) => r.share), all?.share ?? 0) * 1.15]).range([margin.left, width - margin.right]);
  const y = d3.scaleBand().domain(rows.map((r) => r.label)).range([margin.top, height - margin.bottom]).padding(0.35);
  const svg = d3.select(mount).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img")
    .attr("aria-label", "大学等の任期付き研究者比率の分野別比較（2024年断面）。保健分野が最も高い。");
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).ticks(5).tickFormat((v) => `${v}%`)).select(".domain").attr("stroke", "#1c2839");
  if (all) {
    svg.append("line").attr("x1", x(all.share)).attr("x2", x(all.share)).attr("y1", margin.top).attr("y2", height - margin.bottom)
      .attr("stroke", "#8b96ab").attr("stroke-dasharray", "3 4");
    svg.append("text").attr("x", x(all.share) + 4).attr("y", margin.top + 10).attr("font-size", 9).attr("fill", "#8b96ab").text(`全大学 ${all.share}%`);
  }
  const bars = svg.append("g").selectAll("rect").data(rows).join("rect")
    .attr("x", x(0)).attr("y", (r) => y(r.label)).attr("height", y.bandwidth())
    .attr("width", (r) => x(r.share) - x(0))
    .attr("fill", (r, i) => (i === 0 ? "#ffb545" : "#4f7ca6")).attr("opacity", (r, i) => (i === 0 ? 0.95 : 0.55));
  svg.append("g").selectAll("text.tlabel").data(rows).join("text")
    .attr("x", margin.left - 8).attr("y", (r) => y(r.label) + y.bandwidth() / 2 + 4)
    .attr("text-anchor", "end").attr("font-size", 11).attr("fill", "#e9eef7").text((r) => r.label);
  svg.append("g").selectAll("text.tvalue").data(rows).join("text")
    .attr("x", (r) => x(r.share) + 6).attr("y", (r) => y(r.label) + y.bandwidth() / 2 + 4)
    .attr("font-size", 10).attr("fill", "#8b96ab").text((r) => `${r.share}%`);
  if (!REDUCED && gsap) {
    gsap.from(bars.nodes(), { attr: { width: 0 }, duration: 0.9, ease: "power3.out", stagger: 0.05, scrollTrigger: { trigger: mount, start: "top 80%" } });
  }
  const max = rows[0], min = rows[rows.length - 1];
  setText("#faculty-tenure-source", `出典: ${block.source?.title || ""}（${block.year_label}の断面）。${block.note || ""} ${max.label}${max.share}% 対 ${min.label}${min.share}%。`);
}

function renderCorporatePhd(indicators) {
  const mount = $("#corporate-phd");
  const block = indicators?.corporate_phd_hiring;
  if (!mount || !block || block.status !== "ok") { if (mount) mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>'; return; }
  mount.innerHTML = "";
  const pick = ["全産業", "医薬品製造業", "化学工業", "情報サービス業"];
  const industries = pick.map((label) => (block.industries || []).find((i) => i.label === label)).filter(Boolean);
  if (!industries.length) { mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>'; return; }
  const width = mount.clientWidth || 560, height = Math.max(340, width * 0.62);
  const margin = { top: 24, right: 80, bottom: 34, left: 36 };
  const years = industries.flatMap((i) => i.values.map((v) => v.year));
  const x = d3.scaleLinear().domain(d3.extent(years)).range([margin.left, width - margin.right]);
  const maxV = d3.max(industries.flatMap((i) => i.values.map((v) => v.share)));
  const y = d3.scaleLinear().domain([0, maxV * 1.1]).range([height - margin.bottom, margin.top]);
  const svg = d3.select(mount).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img")
    .attr("aria-label", "企業の新規採用研究者に占める博士号保持者の割合、産業別の推移。医薬品製造業が突出している。");
  const gy = svg.append("g").attr("class", "axis").attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(5).tickFormat((v) => `${v}%`).tickSize(-(width - margin.left - margin.right)));
  gy.select(".domain").remove();
  gy.selectAll("line").attr("stroke", "#16202f").attr("stroke-dasharray", "2 4");
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).ticks(6).tickFormat(d3.format("d"))).select(".domain").attr("stroke", "#1c2839");
  const palette = { "全産業": "#8b96ab", "医薬品製造業": "#ffb545", "化学工業": "#5fb3c9", "情報サービス業": "#8d7fb0" };
  const line = d3.line().x((d) => x(d.year)).y((d) => y(d.share)).curve(d3.curveMonotoneX);
  const tips = industries.map((ind) => ({ label: ind.label, y: y(ind.values[ind.values.length - 1].share) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < tips.length; i += 1) { if (tips[i].y - tips[i - 1].y < 13) tips[i].y = tips[i - 1].y + 13; }
  const tipY = Object.fromEntries(tips.map((t) => [t.label, t.y]));
  for (const ind of industries) {
    const isMain = ind.label === "医薬品製造業";
    const path = svg.append("path").attr("d", line(ind.values)).attr("fill", "none")
      .attr("stroke", palette[ind.label] || "#8b96ab").attr("stroke-width", isMain ? 2.4 : 1.2).attr("opacity", isMain ? 1 : 0.7);
    if (isMain) path.attr("filter", "drop-shadow(0 0 6px rgba(255,181,69,0.5))");
    if (!REDUCED && gsap) {
      const length = path.node().getTotalLength();
      path.attr("stroke-dasharray", length).attr("stroke-dashoffset", length);
      gsap.to(path.node(), { strokeDashoffset: 0, duration: isMain ? 2 : 1.4, ease: "power2.out", scrollTrigger: { trigger: mount, start: "top 75%" } });
    }
    const last = ind.values[ind.values.length - 1];
    svg.append("text").attr("x", x(last.year) + 6).attr("y", tipY[ind.label] + 4)
      .attr("fill", isMain ? palette[ind.label] : "#8b96ab").attr("font-size", isMain ? 11 : 9.5).attr("font-weight", isMain ? 600 : 400)
      .text(`${ind.label.replace("製造業", "").replace("業", "")} ${last.share}%`);
  }
  setText("#corporate-phd-source", `出典: ${block.source?.title || ""}。${block.note || ""}`);
}

function renderStemOutcomes(indicators) {
  const mount = $("#stem-outcomes");
  const block = indicators?.stem_phd_outcomes;
  if (!mount || !block || block.status !== "ok") { if (mount) mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>'; return; }
  mount.innerHTML = "";
  const rows = (block.rows || []).map((r) => ({
    year: r.year,
    fields: {
      "進学": r.advance ?? 0,
      "就職（無期・11年度以前は就職計）": r.employed_no_term ?? 0,
      "就職（有期・12年度〜）": r.employed_fixed_term ?? 0,
      "その他": r.other ?? 0,
      "不明": r.unknown ?? 0,
    },
    total: r.graduates ?? 0,
  }));
  if (!rows.length) { mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>'; return; }
  const keys = ["進学", "就職（無期・11年度以前は就職計）", "就職（有期・12年度〜）", "その他", "不明"];
  const palette = { "進学": "#5ad8a1", "就職（無期・11年度以前は就職計）": "#4f7ca6", "就職（有期・12年度〜）": "#c9a76a", "その他": "#59687f", "不明": "#2c3648" };
  const width = mount.clientWidth || 900, height = Math.max(320, width * 0.4);
  const margin = { top: 20, right: 16, bottom: 34, left: 48 };
  const stack = d3.stack().keys(keys).value((row, key) => row.fields[key] ?? 0);
  const series = stack(rows);
  const x = d3.scaleLinear().domain(d3.extent(rows, (r) => r.year)).range([margin.left, width - margin.right]);
  const y = d3.scaleLinear().domain([0, d3.max(rows, (r) => r.total) * 1.05]).range([height - margin.bottom, margin.top]);
  const svg = d3.select(mount).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img")
    .attr("aria-label", "理工系博士課程修了者の進路の推移。2012年度以降は就職者を無期雇用と有期雇用に区分。");
  const gy = svg.append("g").attr("class", "axis").attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(5).tickFormat((v) => fmtInt(v)).tickSize(-(width - margin.left - margin.right)));
  gy.select(".domain").remove();
  gy.selectAll("line").attr("stroke", "#16202f").attr("stroke-dasharray", "2 4");
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).ticks(8).tickFormat(d3.format("d"))).select(".domain").attr("stroke", "#1c2839");
  const area = d3.area().x((d) => x(d.data.year)).y0((d) => y(d[0])).y1((d) => y(d[1])).curve(d3.curveMonotoneX);
  svg.append("g").selectAll("path").data(series).join("path")
    .attr("d", area).attr("fill", (d) => palette[d.key]).attr("opacity", 0.85)
    .append("title").text((d) => d.key);
  svg.append("line").attr("x1", x(2012)).attr("x2", x(2012)).attr("y1", margin.top).attr("y2", height - margin.bottom)
    .attr("stroke", "#e9eef7").attr("stroke-dasharray", "2 3").attr("opacity", 0.5);
  svg.append("text").attr("x", x(2012) + 5).attr("y", margin.top + 12).attr("font-size", 9.5).attr("fill", "#8b96ab")
    .text("2012年度〜 無期/有期の区分開始");
  const legend = svg.append("g").attr("transform", `translate(${margin.left + 8},${margin.top + 2})`);
  keys.forEach((key, i) => {
    const row = legend.append("g").attr("transform", `translate(0,${i * 15})`);
    row.append("rect").attr("width", 9).attr("height", 9).attr("y", -8).attr("fill", palette[key]);
    row.append("text").attr("x", 14).attr("font-size", 10).attr("fill", "#8b96ab").text(key);
  });
  setText("#stem-outcomes-source", `出典: ${block.source?.title || ""}。${block.note || ""}`);
}

/* ================================================================ 02 MOBILITY */

function initFlows(analytics) {
  const canvas = $("#flow-canvas");
  const people = analytics?.reality?.people;
  if (!canvas || !people || people.status !== "ok") {
    if (canvas) canvas.closest(".flow-stage").innerHTML = '<p class="data-empty" style="padding:30px">研究者移動のデータを取得できませんでした。</p>';
    return;
  }
  const sectorColor = { "企業": "#a7b4cc", "非営利団体": "#8d7fb0", "公的機関": "#5ad8a1", "大学等": "#ffb545", "その他": "#59687f" };
  const peopleTotal = d3.sum(people.links || [], (l) => l.value);
  const mode = {
    links: (people.links || []).filter((l) => l.value > 0),
    sourceNames: ["企業", "非営利団体", "公的機関", "大学等", "その他"],
    targetNames: ["企業", "非営利団体", "公的機関", "大学等"],
    perParticle: 50,
    fmtValue: (v) => `${fmtInt(v)}人`,
  };
  setText("#flows-lede", `${analytics.reality.survey_year}年調査で観測された研究者の組織間移動は${fmtInt(peopleTotal)}人。粒子1つ＝研究者50人として流している。`);
  setText("#flows-source", `出典: 総務省 科学技術研究調査（${analytics.reality.survey_year}年調査）。「大学等→大学等」等の同一部門間移動を含む。`);

  let geom = null;
  let focus = null;
  let running = true;
  const particles = [];

  function layout() {
    const { ctx, width, height } = fitCanvas(canvas);
    const { links, sourceNames, targetNames, perParticle } = mode;
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
        const n = Math.max(1, Math.round(link.value / perParticle));
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
      ctx.fillText(mode.fmtValue(node.total), node.x + (isSource ? -12 : 12), (node.y0 + node.y1) / 2 + 19);
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
    const outbound = mode.links.filter((l) => l.source === name).sort((a, b) => b.value - a.value);
    const inbound = mode.links.filter((l) => l.target === name).sort((a, b) => b.value - a.value);
    const top = (list, dir) => list.slice(0, 2).map((l) => `${dir === "out" ? l.target : l.source} ${mode.fmtValue(l.value)}`).join(" / ");
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
}

function renderIntlStudents(indicators) {
  const mount = $("#intl-students");
  const block = indicators?.intl_grad_students;
  if (!mount || !block || block.status !== "ok") { if (mount) mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>'; return; }
  mount.innerHTML = "";
  const countries = block.countries || [];
  const total = block.total || [];
  if (!countries.length || !total.length) { mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>'; return; }
  const years = total.map(([y]) => y);
  /* 公表開始が遅い国（台湾2013年〜）は、それ以前は総数の残差=「その他」に含まれる。凡例名で明示する */
  const topN = countries.slice(0, 7).map((c) => ({
    ...c,
    display: c.values.length && c.values[0][0] > years[0] ? `${c.label}（${c.values[0][0]}年〜公表）` : c.label,
  }));
  const totalMap = new Map(total);
  const rows = years.map((year) => {
    const fields = {};
    let known = 0;
    for (const c of topN) {
      const v = (c.values.find(([y]) => y === year) || [year, 0])[1];
      fields[c.display] = v;
      known += v;
    }
    fields["その他"] = Math.max(0, (totalMap.get(year) ?? known) - known);
    return { year, fields, total: totalMap.get(year) ?? known };
  });
  const keys = [...topN.map((c) => c.display), "その他"];
  const palette = ["#ffb545", "#5fb3c9", "#4fd8ff", "#8d7fb0", "#7f96c9", "#5ad8a1", "#c9a76a", "#46536b"];
  const color = d3.scaleOrdinal().domain(keys).range(palette);
  const width = mount.clientWidth || 900, height = Math.max(340, width * 0.42);
  const margin = { top: 20, right: 16, bottom: 34, left: 48 };
  const stack = d3.stack().keys(keys).value((row, key) => row.fields[key] ?? 0);
  const series = stack(rows);
  const x = d3.scaleLinear().domain(d3.extent(years)).range([margin.left, width - margin.right]);
  const y = d3.scaleLinear().domain([0, d3.max(rows, (r) => r.total) * 1.05]).range([height - margin.bottom, margin.top]);
  const svg = d3.select(mount).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img")
    .attr("aria-label", "日本の外国人大学院生数の推移、国・地域別の積み上げ。中国が最大。");
  const gy = svg.append("g").attr("class", "axis").attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(5).tickFormat((v) => fmtInt(v)).tickSize(-(width - margin.left - margin.right)));
  gy.select(".domain").remove();
  gy.selectAll("line").attr("stroke", "#16202f").attr("stroke-dasharray", "2 4");
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).ticks(8).tickFormat(d3.format("d"))).select(".domain").attr("stroke", "#1c2839");
  const area = d3.area().x((d) => x(d.data.year)).y0((d) => y(d[0])).y1((d) => y(d[1])).curve(d3.curveMonotoneX);
  svg.append("g").selectAll("path").data(series).join("path")
    .attr("d", area).attr("fill", (d) => color(d.key)).attr("opacity", 0.85)
    .append("title").text((d) => d.key);
  const last = rows[rows.length - 1];
  svg.append("text").attr("class", "annot-sub").attr("x", x(last.year) - 4).attr("y", y(last.total) - 10).attr("text-anchor", "end")
    .text(`${last.year}年 合計${fmtInt(last.total)}人`);
  const legend = svg.append("g").attr("transform", `translate(${margin.left + 8},${margin.top + 2})`);
  keys.forEach((key, i) => {
    const row = legend.append("g").attr("transform", `translate(0,${i * 15})`);
    row.append("rect").attr("width", 9).attr("height", 9).attr("y", -8).attr("fill", color(key));
    row.append("text").attr("x", 14).attr("font-size", 10).attr("fill", "#8b96ab").text(`${key} ${fmtInt(last.fields[key] ?? 0)}`);
  });
  const first = rows[0];
  setText("#intl-students-source", `出典: ${block.source?.title || ""}。${block.note || ""} ${first.year}年${fmtInt(first.total)}人→${last.year}年${fmtInt(last.total)}人。`);
}

/* ================================================================ boot */

async function init() {
  bootFooter();
  initRail();
  const [indicatorsResult, analyticsResult] = await Promise.allSettled([
    fetchJson("data/indicators.json"),
    fetchJson("data/analytics.json"),
  ]);
  const indicators = indicatorsResult.status === "fulfilled" ? indicatorsResult.value.indicators : null;
  const analytics = analyticsResult.status === "fulfilled" ? analyticsResult.value : null;
  if (!indicators && !analytics) {
    setText("#header-status", "人材データを取得できません");
    return;
  }
  $("#header-status-dot")?.classList.add("is-live");

  const phdRows = indicators?.phd_enrollment?.rows || [];
  if (phdRows.length) {
    const peak = phdRows.reduce((a, b) => (b.total > a.total ? b : a));
    const last = phdRows[phdRows.length - 1];
    const title = $("#people-title");
    if (title) title.innerHTML = `博士課程入学者、<em>${fmtInt(peak.total)}人</em> → <em>${fmtInt(last.total)}人</em>。`;
    setText("#people-lede", `${peak.year}年をピークに減り続ける日本の博士。博士号・キャリアの構造・研究者の移動を一次データで描く。`);
    setText("#header-status", `観測中 — 学校基本調査${phdRows[0].year}–${last.year}年度 / 複数系統の一次データ`);
  } else {
    setText("#header-status", "観測中 — 人材データ");
  }

  renderPhdIntl(indicators);
  renderPhdStream(indicators);
  renderPhdAdvanceRate(indicators);
  renderPhdDegreesField(indicators);
  renderFacultyAge(indicators);
  renderFemaleTrend(indicators);
  renderFemaleIntl(indicators);
  renderResearcherDensity(indicators);
  renderFacultyTenure(indicators);
  renderCorporatePhd(indicators);
  renderStemOutcomes(indicators);
  initFlows(analytics);
  renderIntlStudents(indicators);

  const hireRows = indicators?.faculty_age?.hire_rows || [];
  const femaleSeries = indicators?.female_researchers?.series || [];
  if (hireRows.length && femaleSeries.length) {
    const first = hireRows[0], last = hireRows[hireRows.length - 1];
    const fFirst = femaleSeries[0], fLast = femaleSeries[femaleSeries.length - 1];
    setText("#career-lede", `大学の新規採用教員に占める25-39歳の割合は${first.year}年度${first.fields["25-39歳"]}%→${last.year}年度${last.fields["25-39歳"]}%へ低下。女性研究者比率は${fFirst[0]}年${fFirst[1]}%→${fLast[0]}年${fLast[1]}%へ上昇。任期付き雇用や博士採用の分野差もあわせて見る。`);
  }

  const entries = [
    blockEntry(indicators?.phd_degrees), blockEntry(indicators?.phd_enrollment),
    blockEntry(indicators?.phd_advance_rate), blockEntry(indicators?.phd_degrees_field),
    blockEntry(indicators?.faculty_age), blockEntry(indicators?.female_researchers),
    blockEntry(indicators?.researchers_density), blockEntry(indicators?.faculty_tenure),
    blockEntry(indicators?.stem_phd_outcomes), blockEntry(indicators?.corporate_phd_hiring),
    blockEntry(indicators?.intl_grad_students),
    ...(analytics?.reality?.sources || []).map((s) => ({ title: s.title, url: s.url, status: s.status === "ok" ? "ok" : "unavailable" })),
  ].filter(Boolean);
  renderLedgerEntries(entries);
}

init().catch((error) => {
  console.error(error);
  setText("#header-status", "人材データを取得できません");
});
