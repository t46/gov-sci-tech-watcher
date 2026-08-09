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

/* ================================================================ 03 GRADUATE ECONOMICS */

/* 断片的な一次資料（国会会議録・Wayback保存のJSPS公式ページ）から復元したDC月額の
   確認済み年度のみを点として描く。未確認区間は補間せず「未確認」帯として明示する。
   出典・注記は data/phd_support.json の dc_stipend_history ブロックを参照。 */

function renderDcRealValue(phdSupport, economy) {
  const mount = $("#dc-real-value");
  const stipend = phdSupport?.dc_stipend_history;
  const cpiBlock = economy?.cpi;
  if (!mount || !stipend || stipend.status !== "ok" || !(stipend.points || []).length || !cpiBlock || cpiBlock.status !== "ok") {
    if (mount) mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>';
    return;
  }
  mount.innerHTML = "";
  const cpiMap = new Map((cpiBlock.calendar_year || []).filter(([, v]) => Number.isFinite(v) && v > 0));
  const lastCpiYear = d3.max([...cpiMap.keys()]);

  const allPoints = [...stipend.points].sort((a, b) => a.fiscal_year - b.fiscal_year);
  const confirmed = allPoints.filter((p) => !p.planned);
  const planned = allPoints.find((p) => p.planned);
  const gaps = stipend.gaps || [];
  if (!confirmed.length) { mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>'; return; }

  /* 確認済み点を、宣言済みの空白区間で分断してセグメント化（＝空白は線を引かない） */
  const segments = [[confirmed[0]]];
  for (let i = 1; i < confirmed.length; i += 1) {
    const prev = confirmed[i - 1], next = confirmed[i];
    const bridged = gaps.some((g) => g.from > prev.fiscal_year && g.to < next.fiscal_year);
    if (bridged) segments.push([next]);
    else segments[segments.length - 1].push(next);
  }
  const lastSegment = segments[segments.length - 1];
  const lastConfirmed = lastSegment[lastSegment.length - 1];
  if (planned && lastConfirmed.fiscal_year < planned.fiscal_year - 1) {
    /* 直近の確定額を、予定額が始まる前年まで平らに延長して据え置きを視覚化する
       （最後の確認点が予定年の前年そのものなら、既にそこまで実データがあるので不要） */
    lastSegment.push({ fiscal_year: planned.fiscal_year - 1, amount_yen: lastConfirmed.amount_yen, virtual: true });
  }

  const nominalAt = (segment, year) => {
    let value = segment[0].amount_yen;
    for (const p of segment) { if (p.fiscal_year <= year) value = p.amount_yen; else break; }
    return value;
  };
  /* 実質値は名目が確定している年についてのみ、CPIが取得できる範囲で年次計算する */
  const realSegments = segments
    .map((segment) => {
      const startYear = segment[0].fiscal_year, endYear = Math.min(segment[segment.length - 1].fiscal_year, lastCpiYear);
      const pts = [];
      for (let year = startYear; year <= endYear; year += 1) {
        const cpi = cpiMap.get(year);
        if (cpi == null) continue;
        pts.push([year, (nominalAt(segment, year) * 100) / cpi]);
      }
      return pts;
    })
    .filter((pts) => pts.length > 1);

  const allYears = confirmed.map((p) => p.fiscal_year).concat(planned ? [planned.fiscal_year] : []);
  const allNominalVals = confirmed.map((p) => p.amount_yen).concat(planned ? [planned.amount_yen] : []);
  const allRealVals = realSegments.flat().map(([, v]) => v);
  const width = mount.clientWidth || 900, height = Math.max(360, width * 0.42);
  const margin = { top: 32, right: 24, bottom: 34, left: 56 };
  const x = d3.scaleLinear().domain([d3.min(allYears) - 1, d3.max(allYears) + 1]).range([margin.left, width - margin.right]);
  const yMin = Math.min(d3.min(allNominalVals), d3.min(allRealVals.length ? allRealVals : allNominalVals));
  const yMax = Math.max(d3.max(allNominalVals), d3.max(allRealVals.length ? allRealVals : allNominalVals));
  const y = d3.scaleLinear().domain([yMin * 0.93, yMax * 1.08]).range([height - margin.bottom, margin.top]);

  const svg = d3.select(mount).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img")
    .attr("aria-label", "学振DC研究奨励金の月額の推移（復元した名目額）と、それを各年の物価で2020年価格に換算した実質価値。2000〜01年度の20.5万円をピークに減額され、2004年度から2026年度まで月額20万円で据え置かれ、2027年度に227,000円へ増額される予定。1989〜1996年度、1999年度、2002年度は未確認区間。");

  const gy = svg.append("g").attr("class", "axis").attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(5).tickFormat((v) => fmtMan(v)).tickSize(-(width - margin.left - margin.right)));
  gy.select(".domain").remove();
  gy.selectAll("line").attr("stroke", "#16202f").attr("stroke-dasharray", "2 4");
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).ticks(10).tickFormat(d3.format("d"))).select(".domain").attr("stroke", "#1c2839");

  /* 未確認区間の帯。単年ギャップ（from===to）は幅0になってしまうので、1年分の幅を確保して
     その年を中心に描く（"視覚上は小さな切れ目でよい"という方針どおり細くてよいが、0だと見えない）。 */
  const yearPx = x(confirmed[0].fiscal_year + 1) - x(confirmed[0].fiscal_year);
  for (const g of gaps) {
    const isNarrow = g.from === g.to;
    const bandX = isNarrow ? x(g.from) - yearPx / 2 : x(g.from);
    const bandWidth = isNarrow ? yearPx : x(g.to) - x(g.from);
    svg.append("rect").attr("x", bandX).attr("width", Math.max(2, bandWidth))
      .attr("y", margin.top).attr("height", height - margin.top - margin.bottom)
      .attr("fill", "rgba(139,150,171,0.09)")
      .append("title").text(g.note);
    if (bandWidth > 46) {
      svg.append("text").attr("x", bandX + bandWidth / 2).attr("y", margin.top + 13)
        .attr("text-anchor", "middle").attr("font-size", 9.5).attr("fill", "#5a6579").text("未確認");
    }
  }

  /* 実質価値（2020年価格）— 名目より細く、奥に */
  const realLine = d3.line().x((d) => x(d[0])).y((d) => y(d[1])).curve(d3.curveMonotoneX);
  for (const seg of realSegments) {
    svg.append("path").attr("d", realLine(seg)).attr("fill", "none").attr("stroke", "#5fb3c9").attr("stroke-width", 1.8).attr("opacity", 0.85);
  }

  /* 名目額（確認済み区間、階段関数） */
  const nominalLine = d3.line().x((d) => x(d.fiscal_year)).y((d) => y(d.amount_yen)).curve(d3.curveStepAfter);
  const nominalPaths = [];
  for (const seg of segments) {
    const path = svg.append("path").attr("d", nominalLine(seg)).attr("fill", "none").attr("stroke", "#ffb545").attr("stroke-width", 2.6)
      .attr("filter", "drop-shadow(0 0 6px rgba(255,181,69,0.45))");
    nominalPaths.push(path);
  }
  if (!REDUCED && gsap) {
    for (const path of nominalPaths) {
      const length = path.node().getTotalLength();
      path.attr("stroke-dasharray", length).attr("stroke-dashoffset", length);
      gsap.to(path.node(), { strokeDashoffset: 0, duration: 1.8, ease: "power2.out", scrollTrigger: { trigger: mount, start: "top 75%" } });
    }
  }

  /* 予定額（2027年度・破線） */
  if (planned) {
    const preJumpYear = planned.fiscal_year - 1;
    svg.append("line").attr("x1", x(preJumpYear)).attr("x2", x(planned.fiscal_year))
      .attr("y1", y(lastConfirmed.amount_yen)).attr("y2", y(lastConfirmed.amount_yen))
      .attr("stroke", "#ffb545").attr("stroke-width", 1.6).attr("stroke-dasharray", "1 3").attr("opacity", 0.5);
    svg.append("line").attr("x1", x(planned.fiscal_year)).attr("x2", x(planned.fiscal_year))
      .attr("y1", y(lastConfirmed.amount_yen)).attr("y2", y(planned.amount_yen))
      .attr("stroke", "#ffb545").attr("stroke-width", 2).attr("stroke-dasharray", "3 3").attr("opacity", 0.85);
    svg.append("circle").attr("cx", x(planned.fiscal_year)).attr("cy", y(planned.amount_yen)).attr("r", 4)
      .attr("fill", "#06090f").attr("stroke", "#ffb545").attr("stroke-width", 2);
    svg.append("text").attr("x", x(planned.fiscal_year) - 8).attr("y", y(planned.amount_yen) - 10)
      .attr("text-anchor", "end").attr("font-size", 11).attr("font-weight", 600).attr("fill", "#ffb545")
      .text(`${planned.fiscal_year}年度 ${fmtMan(planned.amount_yen)}（予定・新規採用分）`);
  }

  /* 据え置き期間のブラケット注釈（2004年度〜直近の確認済み据え置き終端）。開始年を明記する */
  const plateauStart = confirmed.find((p) => p.amount_yen === 200000 && p.fiscal_year >= 2004);
  const plateauEndYear = planned ? planned.fiscal_year - 1 : lastConfirmed.fiscal_year;
  if (plateauStart) {
    const plateauY = y(200000) + 22;
    svg.append("line").attr("x1", x(plateauStart.fiscal_year)).attr("x2", x(plateauEndYear)).attr("y1", plateauY).attr("y2", plateauY)
      .attr("stroke", "#8b96ab").attr("stroke-width", 1);
    [plateauStart.fiscal_year, plateauEndYear].forEach((yr) => {
      svg.append("line").attr("x1", x(yr)).attr("x2", x(yr)).attr("y1", plateauY - 4).attr("y2", plateauY + 4).attr("stroke", "#8b96ab");
    });
    const plateauYears = plateauEndYear - plateauStart.fiscal_year + 1;
    const plateauLabel = width < 560
      ? `凍結開始${plateauStart.fiscal_year}〜 ${plateauYears}年間据え置き`
      : `${plateauStart.fiscal_year}年度〜${plateauEndYear}年度（凍結開始→${plateauYears}年間）月額20万円で据え置き`;
    svg.append("text").attr("x", (x(plateauStart.fiscal_year) + x(plateauEndYear)) / 2).attr("y", plateauY + 15)
      .attr("text-anchor", "middle").attr("font-size", 10.5).attr("fill", "#8b96ab").text(plateauLabel);
  }

  /* 確認済み全点にドット＋ホバー用ツールチップ */
  for (const p of confirmed) {
    svg.append("circle").attr("cx", x(p.fiscal_year)).attr("cy", y(p.amount_yen)).attr("r", 2.6).attr("fill", "#ffb545")
      .append("title").text(`${p.fiscal_year}年度 ${fmtMan(p.amount_yen)}${p.approx ? "（概数）" : ""}`);
  }
  /* 隣接年（1997/1998・2003/2004）は常時ラベルだと（特に狭幅で）文字が重なるため、まとめラベルにする。
     狭幅ではまとめラベルも省略し、ドット＋ツールチップのみにする。 */
  const clusterLabel = (points, text) => {
    if (width < 560) return;
    const midX = d3.mean(points, (p) => x(p.fiscal_year));
    const topY = d3.min(points, (p) => y(p.amount_yen));
    svg.append("text").attr("x", midX).attr("y", topY - 10)
      .attr("text-anchor", "middle").attr("font-size", 9.5).attr("fill", "#8b96ab").text(text);
  };
  const p1987 = confirmed.find((p) => p.fiscal_year === 1987);
  if (p1987) {
    svg.append("text").attr("x", x(1987)).attr("y", y(p1987.amount_yen) - 9)
      .attr("text-anchor", "middle").attr("font-size", 9.5).attr("fill", "#8b96ab").text(`1987頃 ${fmtMan(p1987.amount_yen)}`);
  }
  const p9798 = confirmed.filter((p) => [1997, 1998].includes(p.fiscal_year));
  if (p9798.length === 2) clusterLabel(p9798, `'97→98 ${fmtMan(p9798[0].amount_yen)}→${fmtMan(p9798[1].amount_yen)}`);
  const p0304 = confirmed.filter((p) => [2003, 2004].includes(p.fiscal_year));
  if (p0304.length === 2) clusterLabel(p0304, `'03→04 ${fmtMan(p0304[0].amount_yen)}→${fmtMan(p0304[1].amount_yen)}`);

  /* ピーク（2000〜01年度 20.5万円）— 山型の頂点として他の章と同じannot-line/annot-textの見せ方で強調 */
  const peak = confirmed.reduce((a, b) => (b.amount_yen > a.amount_yen ? b : a), confirmed[0]);
  if (peak.amount_yen > 200000) {
    const peakTextY = Math.max(margin.top + 10, y(peak.amount_yen) - 34);
    svg.append("circle").attr("cx", x(peak.fiscal_year)).attr("cy", y(peak.amount_yen)).attr("r", 4).attr("fill", "#ffb545")
      .attr("filter", "drop-shadow(0 0 6px rgba(255,181,69,0.6))");
    svg.append("line").attr("class", "annot-line").attr("x1", x(peak.fiscal_year)).attr("x2", x(peak.fiscal_year))
      .attr("y1", y(peak.amount_yen)).attr("y2", peakTextY + 6);
    svg.append("text").attr("class", "annot-text").attr("x", x(peak.fiscal_year)).attr("y", peakTextY)
      .attr("text-anchor", "middle").attr("font-size", 12.5)
      .text(`ピーク ${peak.fiscal_year}年度 ${fmtMan(peak.amount_yen)}`);
  }

  /* 凡例。狭幅では横並びだと右端があふれるので縦積みにする */
  const stackLegend = width < 560;
  const legend = svg.append("g").attr("transform", `translate(${margin.left + 4},${margin.top - (stackLegend ? 26 : 20)})`);
  const legendItems = [
    { label: "名目額（確認済み）", color: "#ffb545" },
    { label: "実質価値（2020年価格）", color: "#5fb3c9" },
  ];
  legendItems.forEach((item, i) => {
    const row = legend.append("g").attr("transform", stackLegend ? `translate(0,${i * 13})` : `translate(${i * 160},0)`);
    row.append("line").attr("x1", 0).attr("x2", 14).attr("y1", -4).attr("y2", -4).attr("stroke", item.color).attr("stroke-width", 2.2);
    row.append("text").attr("x", 18).attr("y", -1).attr("font-size", 10).attr("fill", "#8b96ab").text(item.label);
  });

  const first = confirmed[0];
  const realLast = realSegments.length ? realSegments[realSegments.length - 1] : [];
  const realLastPoint = realLast[realLast.length - 1];
  const plateauPeak = realSegments.flat().reduce((a, b) => (b[1] > a[1] ? b : a), realSegments.flat()[0] || [0, 0]);
  let summary = "";
  if (realLastPoint && plateauPeak) {
    const declinePct = ((plateauPeak[1] - realLastPoint[1]) / plateauPeak[1]) * 100;
    summary = ` 実質価値は物価が安定していた${plateauPeak[0]}年に${fmtMan(plateauPeak[1])}まで上がったが、名目額が20万円のまま2020年代の物価上昇にさらされ、${realLastPoint[0]}年には${fmtMan(realLastPoint[1])}まで実質${declinePct.toFixed(1)}%目減りした（名目額は変わっていない）。`;
  }
  setText("#dc-real-value-source",
    `出典: 国会会議録検索システム（kokkai.ndl.go.jp）＋Wayback Machineに保存されたJSPS公式ページ・PDF、直近はJSPS特別研究員-DC募集要項（令和9年度採用分）。JSPSはDC月額改定の沿革表を公開しておらず、断片的な一次資料から復元した確認済み年度のみを点として描いている（灰色の帯は未確認区間、補間はしていない）。${first.fiscal_year}${first.approx ? "年頃" : "年度"}${fmtMan(first.amount_yen)}${first.approx ? "（概数）" : ""}→2000〜01年度の20.5万円をピークに2003〜04年度にかけて減額→2004〜${plateauEndYear}年度は月額20万円で据え置き→2027年度に${planned ? fmtMan(planned.amount_yen) : "?"}へ増額予定（新規採用分、+13.5%）。${summary}`);
}

const DC_ACCEPTANCE_COLORS = { applicants: "#4f7ca6", accepted: "#ffb545" };

function renderDcAcceptance(phdSupport) {
  const mount = $("#dc-acceptance");
  const block = phdSupport?.dc_acceptance;
  const rows = block?.rows || [];
  if (!mount || !block || block.status !== "ok" || !rows.length) {
    if (mount) mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>';
    return;
  }
  mount.innerHTML = "";
  const data = rows
    .filter((r) => [r.fiscal_year, r.dc1_applicants, r.dc2_applicants, r.dc1_accepted, r.dc2_accepted].every(Number.isFinite))
    .map((r) => {
      const applicants = r.dc1_applicants + r.dc2_applicants;
      const accepted = r.dc1_accepted + r.dc2_accepted;
      return { year: r.fiscal_year, applicants, accepted, rate: applicants > 0 ? (accepted / applicants) * 100 : 0 };
    });
  if (!data.length) { mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>'; return; }
  const width = mount.clientWidth || 560, height = Math.max(340, width * 0.62);
  const margin = { top: 30, right: 16, bottom: 34, left: 48 };
  const x0 = d3.scaleBand().domain(data.map((d) => d.year)).range([margin.left, width - margin.right]).padding(0.32);
  const x1 = d3.scaleBand().domain(["applicants", "accepted"]).range([0, x0.bandwidth()]).padding(0.14);
  const y = d3.scaleLinear().domain([0, d3.max(data, (d) => d.applicants) * 1.18]).range([height - margin.bottom, margin.top]);
  const svg = d3.select(mount).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img")
    .attr("aria-label", "学振DC1・DC2合計の申請者数・採用者数・採用率の推移。申請者は増え続ける一方、採用者数はほぼ横ばいで採用率が下がっている。");
  const gy = svg.append("g").attr("class", "axis").attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(5).tickFormat((v) => fmtMan(v)).tickSize(-(width - margin.left - margin.right)));
  gy.select(".domain").remove();
  gy.selectAll("line").attr("stroke", "#16202f").attr("stroke-dasharray", "2 4");
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x0).tickFormat((yr) => `${yr}年度`)).select(".domain").attr("stroke", "#1c2839");

  const groups = svg.append("g").selectAll("g").data(data).join("g").attr("transform", (d) => `translate(${x0(d.year)},0)`);
  const bar = (key) => groups.append("rect")
    .attr("x", x1(key)).attr("width", x1.bandwidth())
    .attr("y", (d) => y(d[key])).attr("height", (d) => height - margin.bottom - y(d[key]))
    .attr("fill", DC_ACCEPTANCE_COLORS[key]).attr("opacity", key === "applicants" ? 0.4 : 0.95)
    .append("title").text((d) => `${d.year}年度 ${key === "applicants" ? "申請者数" : "採用者数"} ${fmtInt(d[key])}人`);
  bar("applicants");
  bar("accepted");
  if (!REDUCED && gsap) {
    gsap.from(groups.selectAll("rect").nodes(), {
      attr: { height: 0, y: height - margin.bottom },
      duration: 0.9, ease: "power3.out", stagger: 0.06, scrollTrigger: { trigger: mount, start: "top 80%" },
    });
  }
  groups.append("text").attr("x", x0.bandwidth() / 2).attr("y", (d) => y(d.applicants) - 8)
    .attr("text-anchor", "middle").attr("font-size", 11).attr("font-weight", 600).attr("fill", "#ffb545")
    .text((d) => `${d.rate.toFixed(1)}%`);
  const legend = svg.append("g").attr("transform", `translate(${margin.left + 4},${margin.top - 18})`);
  [["applicants", "申請者数（DC1+DC2）"], ["accepted", "採用者数"]].forEach(([key, label], i) => {
    const row = legend.append("g").attr("transform", `translate(${i * 140},0)`);
    row.append("rect").attr("width", 9).attr("height", 9).attr("y", -8).attr("fill", DC_ACCEPTANCE_COLORS[key]).attr("opacity", key === "applicants" ? 0.4 : 0.95);
    row.append("text").attr("x", 14).attr("font-size", 10).attr("fill", "#8b96ab").text(label);
  });
  const first = data[0], last = data[data.length - 1];
  setText("#dc-acceptance-source",
    `出典: ${block.source?.title || ""}。${block.note || ""} ${first.year}年度は申請${fmtInt(first.applicants)}人・採用${fmtInt(first.accepted)}人（採用率${first.rate.toFixed(1)}%）、${last.year}年度は申請${fmtInt(last.applicants)}人・採用${fmtInt(last.accepted)}人（採用率${last.rate.toFixed(1)}%）。上部の%は採用率。`);
}

const LIVING_SUPPORT_PALETTE = ["#ffb545", "#5fb3c9", "#8d7fb0", "#59687f"];

function renderPhdLivingSupport(phdSupport) {
  const mount = $("#phd-living-support");
  const block = phdSupport?.living_support;
  if (!mount || !block || block.status !== "ok") { if (mount) mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>'; return; }
  mount.innerHTML = "";
  const segments = (block.baseline_breakdown || []).filter((s) => Number.isFinite(s.count) && s.count > 0);
  if (!segments.length || !Number.isFinite(block.target_count) || block.target_count <= 0) {
    mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>'; return;
  }
  /* 報告書の「約16,000人」は丸め表記で内訳合算(16,300人)と一致しない。積み上げ・ラベルとも内訳合算に統一し概数と明記 */
  const segSum = d3.sum(segments, (s) => s.count);
  const rows = [
    { label: `現状（令和${block.baseline_fiscal_year - 2018}年度）`, total: segSum, segments },
    { label: `目標（${block.target_fiscal_year}年度）`, total: block.target_count, segments: null },
  ];
  const width = mount.clientWidth || 560, height = Math.max(300, segments.length * 20 + 190);
  const margin = { top: 16, right: 70, bottom: 30, left: 118 };
  const x = d3.scaleLinear().domain([0, block.target_count * 1.08]).range([margin.left, width - margin.right]);
  const y = d3.scaleBand().domain(rows.map((r) => r.label)).range([margin.top, margin.top + 130]).padding(0.42);
  const svg = d3.select(mount).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img")
    .attr("aria-label", "生活費相当額を受給する博士学生数（特別研究員DC・大学フェローシップ・SPRING・RA支援の4施策合計の推計）の現状と政府目標の比較。現状は目標の7割程度。");
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${margin.top + 130})`)
    .call(d3.axisBottom(x).ticks(5).tickFormat((v) => fmtMan(v))).select(".domain").attr("stroke", "#1c2839");

  /* 現状: 内訳を積み上げ */
  const baseline = rows[0];
  let cursor = x(0);
  const bGroup = svg.append("g");
  baseline.segments.forEach((seg, i) => {
    const w = x(seg.count) - x(0);
    bGroup.append("rect").attr("x", cursor).attr("y", y(baseline.label)).attr("height", y.bandwidth())
      .attr("width", w).attr("fill", LIVING_SUPPORT_PALETTE[i % LIVING_SUPPORT_PALETTE.length]).attr("opacity", 0.88)
      .append("title").text(`${seg.label}: ${fmtInt(seg.count)}人`);
    cursor += w;
  });
  if (!REDUCED && gsap) {
    gsap.from(bGroup.selectAll("rect").nodes(), { attr: { width: 0 }, duration: 0.9, ease: "power3.out", stagger: 0.1, scrollTrigger: { trigger: mount, start: "top 80%" } });
  }
  svg.append("text").attr("x", x(baseline.total) + 8).attr("y", y(baseline.label) + y.bandwidth() / 2 + 4)
    .attr("font-size", 11).attr("font-weight", 600).attr("fill", "#e9eef7").text(`約${fmtInt(baseline.total)}人`);

  /* 目標: 破線の枠のみ（未達成の目印） */
  const target = rows[1];
  svg.append("rect").attr("x", x(0)).attr("y", y(target.label)).attr("height", y.bandwidth())
    .attr("width", x(target.total) - x(0)).attr("fill", "none").attr("stroke", "#8b96ab").attr("stroke-dasharray", "3 4");
  svg.append("line").attr("x1", x(baseline.total)).attr("x2", x(baseline.total)).attr("y1", y(target.label) - 4).attr("y2", y(target.label) + y.bandwidth() + 4)
    .attr("stroke", "#4c5a72").attr("stroke-dasharray", "2 3");
  svg.append("text").attr("x", x(target.total) + 8).attr("y", y(target.label) + y.bandwidth() / 2 + 4)
    .attr("font-size", 11).attr("fill", "#8b96ab").text(`${fmtInt(target.total)}人（目標）`);

  svg.append("g").selectAll("text.rowlabel").data(rows).join("text")
    .attr("x", margin.left - 10).attr("y", (r) => y(r.label) + y.bandwidth() / 2 + 4)
    .attr("text-anchor", "end").attr("font-size", 11).attr("fill", "#e9eef7").text((r) => r.label);

  /* 内訳の凡例 */
  const legend = svg.append("g").attr("transform", `translate(${margin.left},${margin.top + 158})`);
  segments.forEach((seg, i) => {
    const row = legend.append("g").attr("transform", `translate(0,${i * 16})`);
    row.append("rect").attr("width", 9).attr("height", 9).attr("y", -8).attr("fill", LIVING_SUPPORT_PALETTE[i % LIVING_SUPPORT_PALETTE.length]).attr("opacity", 0.88);
    row.append("text").attr("x", 14).attr("font-size", 10).attr("fill", "#8b96ab").text(`${seg.label} ${fmtInt(seg.count)}人`);
  });

  const gap = block.target_count - segSum;
  setText("#phd-living-support-source",
    `出典: ${block.source?.title || ""}。${block.note || ""} 内訳の合算は${fmtInt(segSum)}人（報告書の丸め表記は約16,000人。いずれも概数）。目標まで残り約${fmtInt(gap)}人（${block.target_note || ""}）`);
}

/* ================================================================ 03 GLOBAL MOBILITY */

/* 1つの章の描画失敗が他の章を巻き込まないようにする（money.js と同じ隔離パターン）。
   mobility.json自体の取得失敗はinit()側でこの章の全レンダラーをスキップするので、
   ここはレンダラー内部の想定外エラーに対する最後の砦。 */
function safeCall(name, fn) {
  try {
    fn();
  } catch (error) {
    console.error(`[people] ${name} failed`, error);
  }
}

const MOB_DISPATCH_COLOR = "#ffb545";
const MOB_INFLOW_COLOR = "#4fd8ff";
/* 派遣・受入研究者数の対象範囲が変わった年度（軸上に小さなティックを打ち、脚注でまとめて説明する） */
const MOB_DEF_CHANGE_YEARS = [2008, 2010, 2013, 2014];
const MOB_REGION_SHORT = { "ヨーロッパ（含NIS諸国）": "ヨーロッパ" };

/* ================================================================ 03-A 純流出（ReICO、移籍が主役） */

/* annual_net: [year, netFlow] のゼロ線バー。負=純流出（amber、この章の主役）、
   唯一の正の年（2011）は控えめな灰色で描き、視覚的に「良いこと」として強調しない */
function renderMobReicoNetBars(mount, rf) {
  mount.innerHTML = "";
  const net = (rf.annual_net || []).filter(([yr, v]) => Number.isFinite(yr) && Number.isFinite(v));
  if (!net.length) { mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>'; return; }
  const width = mount.clientWidth || 900, height = Math.max(260, width * 0.32);
  const margin = { top: 22, right: 16, bottom: 24, left: 58 };
  const x = d3.scaleBand().domain(net.map(([yr]) => yr)).range([margin.left, width - margin.right]).padding(0.26);
  const maxAbs = d3.max(net, ([, v]) => Math.abs(v)) || 1;
  const y = d3.scaleLinear().domain([-maxAbs * 1.18, maxAbs * 1.18]).range([height - margin.bottom, margin.top]);
  const svg = d3.select(mount).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img")
    .attr("aria-label", "日本の研究者の純移動（流入-流出）の年次推移、2011-2024年。2011年を除き一貫して純流出。");
  const gy = svg.append("g").attr("class", "axis").attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(5).tickFormat((v) => fmtInt(v)).tickSize(-(width - margin.left - margin.right)));
  gy.select(".domain").remove();
  gy.selectAll("line").attr("stroke", "#16202f").attr("stroke-dasharray", "2 4");
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${y(0)})`)
    .call(d3.axisBottom(x).tickFormat(d3.format("d")).tickSize(0)).select(".domain").attr("stroke", "#4c5a72");

  const bars = svg.append("g").selectAll("rect").data(net).join("rect")
    .attr("x", ([yr]) => x(yr)).attr("width", x.bandwidth())
    .attr("y", ([, v]) => y(Math.max(0, v))).attr("height", ([, v]) => Math.abs(y(v) - y(0)))
    .attr("fill", ([, v]) => (v < 0 ? MOB_DISPATCH_COLOR : "#4c5a72"))
    .attr("opacity", ([, v]) => (v < 0 ? 0.85 : 0.55));
  bars.append("title").text(([yr, v]) => `${yr}年 ${v >= 0 ? "純流入" : "純流出"} ${fmtInt(Math.abs(Math.round(v)))}人（按分推計）`);
  if (!REDUCED && gsap) {
    gsap.from(bars.nodes(), { attr: { height: 0, y: y(0) }, duration: 0.85, ease: "power3.out", stagger: 0.025, scrollTrigger: { trigger: mount, start: "top 82%" } });
  }

  /* 最大の純流出年を1回だけ注釈（このデータで最も大きな出来事） */
  const worst = net.reduce((a, b) => (b[1] < a[1] ? b : a));
  const worstX = x(worst[0]) + x.bandwidth() / 2;
  const worstY = y(worst[1]);
  const textY = Math.min(height - margin.bottom - 8, worstY + 24);
  svg.append("line").attr("class", "annot-line").attr("x1", worstX).attr("x2", worstX).attr("y1", worstY).attr("y2", textY - 6);
  svg.append("text").attr("class", "annot-text").attr("x", worstX).attr("y", textY + 10)
    .attr("text-anchor", "middle").attr("font-size", 11).text(`${worst[0]}年 純流出${fmtInt(Math.abs(Math.round(worst[1])))}人（最大）`);
}

/* latest_breakdown（2024年のみ）を4セルの数値行で表示。既存の.money-strip/.money-cellを再利用 */
function renderMobReicoBreakdown(mount, lb) {
  const cells = [
    { name: "流入", value: lb.inflow, note: "他国から日本へ" },
    { name: "流出", value: lb.outflow, note: "日本から他国へ" },
    { name: "帰国", value: lb.returnees, note: "海外在住から日本へ" },
    { name: "国際移動経験", value: lb.mobility, note: "流入＋流出＋帰国" },
  ];
  mount.innerHTML = cells.map((c) => `
    <div class="money-cell">
      <span class="m-name">${escapeHtml(c.name)}</span>
      <span class="m-value">${Number.isFinite(c.value) ? fmtInt(Math.round(c.value)) : "—"}<span class="mob-unit">人</span></span>
      <span class="m-note">${escapeHtml(c.note)}（${lb.fiscal_year}年、按分推計）</span>
    </div>`).join("");
}

/* country_comparison: net_flow_rate_pctの国別横棒。日本=amber・他国=slate（既存の流儀。正負で色分けはしない） */
function renderMobReicoCountries(mount, rf) {
  mount.innerHTML = "";
  const rows = (rf.country_comparison || []).filter((r) => Number.isFinite(r.net_flow_rate_pct)).sort((a, b) => b.net_flow_rate_pct - a.net_flow_rate_pct);
  if (!rows.length) { mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>'; return; }
  const width = mount.clientWidth || 900, height = Math.max(260, rows.length * 28 + 30);
  const margin = { top: 10, right: 60, bottom: 26, left: 96 };
  const maxAbs = d3.max(rows, (r) => Math.abs(r.net_flow_rate_pct)) || 1;
  const x = d3.scaleLinear().domain([-maxAbs * 1.2, maxAbs * 1.2]).range([margin.left, width - margin.right]);
  const y = d3.scaleBand().domain(rows.map((r) => r.country_name_ja)).range([margin.top, height - margin.bottom]).padding(0.3);
  const svg = d3.select(mount).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img")
    .attr("aria-label", "研究者の純移動率（総著者数に対する年間純流入の割合）の国際比較。日本はマイナス圏、米豪加英独はプラス圏、韓国は日本より大きなマイナス。");
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).ticks(6).tickFormat((v) => `${v}%`)).select(".domain").attr("stroke", "#1c2839");
  svg.append("line").attr("x1", x(0)).attr("x2", x(0)).attr("y1", margin.top - 4).attr("y2", height - margin.bottom + 4).attr("stroke", "#4c5a72");
  const bars = svg.append("g").selectAll("rect").data(rows).join("rect")
    .attr("x", (r) => x(Math.min(0, r.net_flow_rate_pct))).attr("y", (r) => y(r.country_name_ja)).attr("height", y.bandwidth())
    .attr("width", (r) => Math.abs(x(r.net_flow_rate_pct) - x(0)))
    .attr("fill", (r) => (r.country_code === "JPN" ? MOB_DISPATCH_COLOR : "#4f7ca6"))
    .attr("opacity", (r) => (r.country_code === "JPN" ? 0.95 : 0.55));
  bars.append("title").text((r) => `${r.country_name_ja}: ${r.net_flow_rate_pct}%（総著者数${fmtInt(r.authors_total ?? 0)}人）`);
  svg.append("g").selectAll("text.rcnlabel").data(rows).join("text")
    .attr("x", margin.left - 8).attr("y", (r) => y(r.country_name_ja) + y.bandwidth() / 2 + 3.5)
    .attr("text-anchor", "end").attr("font-size", 10.5)
    .attr("fill", (r) => (r.country_code === "JPN" ? MOB_DISPATCH_COLOR : "#8b96ab"))
    .attr("font-weight", (r) => (r.country_code === "JPN" ? 600 : 400))
    .text((r) => r.country_name_ja);
  svg.append("g").selectAll("text.rcnvalue").data(rows).join("text")
    .attr("x", (r) => x(r.net_flow_rate_pct) + (r.net_flow_rate_pct >= 0 ? 6 : -6))
    .attr("y", (r) => y(r.country_name_ja) + y.bandwidth() / 2 + 3.5)
    .attr("text-anchor", (r) => (r.net_flow_rate_pct >= 0 ? "start" : "end"))
    .attr("font-size", 10).attr("fill", "#e9eef7").text((r) => `${r.net_flow_rate_pct > 0 ? "+" : ""}${r.net_flow_rate_pct}%`);
  if (!REDUCED && gsap) {
    gsap.from(bars.nodes(), { attr: { width: 0, x: x(0) }, duration: 0.85, ease: "power3.out", stagger: 0.03, scrollTrigger: { trigger: mount, start: "top 82%" } });
  }
}

function renderMobReico(mobility) {
  const rf = mobility?.reico_flows;
  const netMount = $("#mob-reico-net");
  const breakdownMount = $("#mob-reico-breakdown");
  const countryMount = $("#mob-reico-countries");
  if (!rf || rf.status !== "ok") {
    [netMount, breakdownMount, countryMount].forEach((m) => { if (m) m.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>'; });
    return;
  }
  if (netMount) renderMobReicoNetBars(netMount, rf);
  const lb = rf.latest_breakdown;
  if (breakdownMount) {
    if (lb) renderMobReicoBreakdown(breakdownMount, lb);
    else breakdownMount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>';
  }
  if (countryMount) renderMobReicoCountries(countryMount, rf);

  /* ledeの主役はこの図。2011年以降で最後に純流入(≧0)だった年の翌年から現在までの連続年数を
     動的に数える（ハードコードで「2012年から」等と書かない） */
  const net = (rf.annual_net || []).filter(([yr, v]) => Number.isFinite(yr) && Number.isFinite(v));
  const ledeEl = $("#global-lede");
  if (ledeEl && net.length && lb) {
    let streakStartIdx = 0;
    for (let i = net.length - 1; i >= 0; i -= 1) { if (net[i][1] >= 0) { streakStartIdx = i + 1; break; } }
    const streak = net.slice(streakStartIdx);
    if (streak.length) {
      /* 純流出はOECDの年次純流出指標(annual_net)を使う。流入・流出の内訳指標は別系列の推計で、
         単純差(outflow−inflow)はannual_netと一致しないため「純流出」とは呼ばない */
      const latestNet = net[net.length - 1];
      const inflowText = Number.isFinite(lb.inflow) ? fmtInt(Math.round(lb.inflow)) : "—";
      const outflowText = Number.isFinite(lb.outflow) ? fmtInt(Math.round(lb.outflow)) : "—";
      ledeEl.textContent =
        `日本は${streak[0][0]}年以降${streak.length}年連続で、論文著者として測った研究者の純流出国であり続けている（${latestNet[0]}年の純流出は約${fmtInt(Math.abs(Math.round(latestNet[1])))}人）。` +
        `内訳の推計では${lb.fiscal_year}年に流出${outflowText}人・流入${inflowText}人` +
        `、国際移動経験者${Number.isFinite(lb.mobility) ? fmtInt(Math.round(lb.mobility)) : "—"}人（うち帰国${Number.isFinite(lb.returnees) ? fmtInt(Math.round(lb.returnees)) : "—"}人）。`;
    }
  }

  setText("#mob-reico-source", `出典: ${rf.source?.title || ""}。単位: ${rf.unit || ""}。${rf.note || ""} 注: 年次純流出（annual_net）はOECDの独立した純フロー推計で、流入・流出の内訳指標の単純差とは一致しない。`);
}

/* ================================================================ 03-E 32年の往来（MEXT、参考=交流の統計） */

function renderMobFlowsPanel(mountSel, dispatchSeriesRaw, inflowSeriesRaw, opts = {}) {
  const mount = $(mountSel);
  if (!mount) return;
  mount.innerHTML = "";
  /* nullが混ざるとd3.extent/d3.maxがNaNを返して軸が壊れるので、両方とも有限数の点だけを使う */
  const isFinitePoint = ([yr, v]) => Number.isFinite(yr) && Number.isFinite(v);
  const dispatchSeries = (dispatchSeriesRaw || []).filter(isFinitePoint);
  const inflowSeries = (inflowSeriesRaw || []).filter(isFinitePoint);
  if (!dispatchSeries.length || !inflowSeries.length) { mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>'; return; }
  const width = mount.clientWidth || 440, height = Math.max(260, width * 0.76);
  const margin = { top: 22, right: 14, bottom: 30, left: 54 };
  const years = dispatchSeries.map(([yr]) => yr);
  const x = d3.scaleLinear().domain(d3.extent(years)).range([margin.left, width - margin.right]);
  const maxV = Math.max(d3.max(dispatchSeries, (d) => d[1]), d3.max(inflowSeries, (d) => d[1]));
  const y = d3.scaleLinear().domain([0, maxV * 1.12]).range([height - margin.bottom, margin.top]);
  const yFmt = opts.yTickFormat || ((v) => fmtInt(v));
  const svg = d3.select(mount).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img")
    .attr("aria-label", opts.ariaLabel || "延べ派遣・受入研究者数の推移");
  const gy = svg.append("g").attr("class", "axis").attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(4).tickFormat(yFmt).tickSize(-(width - margin.left - margin.right)));
  gy.select(".domain").remove();
  gy.selectAll("line").attr("stroke", "#16202f").attr("stroke-dasharray", "2 4");
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).ticks(6).tickFormat(d3.format("d"))).select(".domain").attr("stroke", "#1c2839");

  /* 定義変更年の目盛（詳細はfigure全体の脚注でまとめて説明） */
  for (const defYear of MOB_DEF_CHANGE_YEARS) {
    if (defYear < years[0] || defYear > years[years.length - 1]) continue;
    svg.append("line").attr("x1", x(defYear)).attr("x2", x(defYear))
      .attr("y1", height - margin.bottom).attr("y2", height - margin.bottom + 5)
      .attr("stroke", "#8b96ab").attr("stroke-width", 1.3);
  }

  const line = d3.line().x(([yr]) => x(yr)).y(([, v]) => y(v)).curve(d3.curveMonotoneX);
  const area = d3.area().x(([yr]) => x(yr)).y0(y(0)).y1(([, v]) => y(v)).curve(d3.curveMonotoneX);
  const series = [
    { values: dispatchSeries, color: MOB_DISPATCH_COLOR, label: "派遣" },
    { values: inflowSeries, color: MOB_INFLOW_COLOR, label: "受入" },
  ];
  for (const s of series) {
    svg.append("path").attr("d", area(s.values)).attr("fill", s.color).attr("opacity", 0.08);
    const path = svg.append("path").attr("d", line(s.values)).attr("fill", "none")
      .attr("stroke", s.color).attr("stroke-width", 2.2).attr("opacity", 0.95);
    if (!REDUCED && gsap) {
      const length = path.node().getTotalLength();
      path.attr("stroke-dasharray", length).attr("stroke-dashoffset", length);
      gsap.to(path.node(), { strokeDashoffset: 0, duration: 1.7, ease: "power2.out", scrollTrigger: { trigger: mount, start: "top 82%" } });
    }
    const last = lastPoint(s.values);
    svg.append("text").attr("x", x(last[0]) - 4).attr("y", y(last[1]) - 8).attr("text-anchor", "end")
      .attr("font-size", 11).attr("font-weight", 600).attr("fill", s.color)
      .text(`${s.label} ${fmtInt(last[1])}`);
  }

  /* コロナ急落の注釈（このデータで最も大きな出来事なので1回だけ描く。数値はJSONの実測値から算出） */
  if (opts.covidYear) {
    const beforePt = dispatchSeries.find(([yr]) => yr === opts.covidYear - 1);
    const dropPt = dispatchSeries.find(([yr]) => yr === opts.covidYear);
    if (beforePt && dropPt) {
      const textY = Math.max(margin.top + 10, y(beforePt[1]) - 30);
      svg.append("line").attr("class", "annot-line").attr("x1", x(opts.covidYear)).attr("x2", x(opts.covidYear))
        .attr("y1", y(dropPt[1])).attr("y2", textY + 6);
      /* 2020年は右端付近なので、右半分では終端アンカーで左向きに置いて切れないようにする */
      const onRightHalf = x(opts.covidYear) > width / 2;
      svg.append("text").attr("class", "annot-text")
        .attr("x", onRightHalf ? x(opts.covidYear) - 8 : x(opts.covidYear) + 8)
        .attr("text-anchor", onRightHalf ? "end" : "start")
        .attr("y", textY)
        .attr("font-size", 11.5).text(`${opts.covidYear}年度 ${fmtInt(beforePt[1])}→${fmtInt(dropPt[1])}人`);
    }
  }
}

function renderMobFlows(mobility) {
  const mf = mobility?.mext_flows;
  if (!mf || mf.status !== "ok") {
    ["#mob-flows-short", "#mob-flows-midlong"].forEach((sel) => { const m = $(sel); if (m) m.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>'; });
    return;
  }
  renderMobFlowsPanel("#mob-flows-short", mf.dispatch?.short, mf.inflow?.short, {
    ariaLabel: "延べ海外派遣・延べ受入研究者数（短期・30日以内）の推移。2020年度にコロナ禍で急落した。",
    covidYear: 2020,
    yTickFormat: (v) => fmtMan(v),
  });
  renderMobFlowsPanel("#mob-flows-midlong", mf.dispatch?.mid_long, mf.inflow?.mid_long, {
    ariaLabel: "延べ海外派遣・延べ受入研究者数（中・長期・30日超）の推移。短期の10分の1以下の規模。",
    yTickFormat: (v) => fmtInt(v),
  });

  /* この章のledeは図A（純流出）が主役になったので、ここでは触らない。
     第7期基本計画の中・長期派遣3万人目標は、この図の文脈（中・長期派遣の実数）なのでここに注記する */
  const dispatchTotal = mf.dispatch?.total || [];
  const lastYear = lastPoint(dispatchTotal);
  const lastMidLong = lastPoint(mf.dispatch?.mid_long || []);
  const pre2019Raw = dispatchTotal.find(([yr]) => yr === 2019);
  /* 分母(2019年度実績)が正の有限数のときだけ回復率を計算する（0除算・NaN%を防ぐ） */
  const pre2019 = pre2019Raw && Number.isFinite(pre2019Raw[1]) && pre2019Raw[1] > 0 ? pre2019Raw : null;
  const recovery = pre2019 && lastYear && Number.isFinite(lastYear[1]) ? Math.round((lastYear[1] / pre2019[1]) * 100) : null;

  const defNote = (mf.definition_changes || []).map((d) => `${d.year}年度（${d.note}）`).join("、");
  const sourceEl = $("#mob-flows-source");
  if (sourceEl) {
    /* 数値はすべてfmtInt経由の数値文字列なのでHTML挿入しても安全 */
    sourceEl.innerHTML =
      `出典: ${escapeHtml(mf.source?.title || "")}。単位: ${escapeHtml(mf.unit || "")}。${escapeHtml(mf.note || "")}${defNote ? ` 定義変更: ${escapeHtml(defNote)}。` : ""}` +
      `${lastYear && recovery != null ? ` ${lastYear[0]}年度の海外派遣は延べ${fmtInt(lastYear[1])}人で、コロナ前（${pre2019[0]}年度${fmtInt(pre2019[1])}人）の約${recovery}%まで回復。` : ""}` +
      `${lastMidLong ? ` 中・長期派遣は延べ${fmtInt(lastMidLong[1])}人 — 第7期科学技術・イノベーション基本計画は2030年度までの累計3万人を目標に掲げる（<a href="policy.html">政策</a>）。` : ""}`;
  }
}

/* ================================================================ 03-C 地球の上の移動（世界地図フロー）
   投影: d3.geoNaturalEarth1().rotate([-140,0]) — 太平洋中心、日本が画面中央付近に来る。
   陸のドットハーフトーンは d3.geoContains による球面上の点包含判定（投影に依存しない）なので、
   初期化時に1回だけ計算してキャッシュする。リサイズで再計算するのは投影後の画面座標だけ。
   データはOECD二国間移動推計（mobility.oecd_bilateral）— 日本⇔上位20か国。
   amber粒子=日本→海外（流出）／cyan粒子=海外→日本（流入）。base canvas=静的レイヤー（陸ドット・
   航路線・アンカー）、fx canvas=destination-outで残光を作る動的レイヤー（粒子・東京のパルス）。
   直後の図D（OECDダイバージングバー）が、この地図の国別詳細数値にあたる。 */

/* 国の代表点（演出上の目安。首都・重心の主張はしない）。投影上で重ならないよう座標を選んでいる */
const MOBMAP_COUNTRY_ANCHORS = {
  USA: [-98, 39], CHN: [104, 35], GBR: [-2, 54], DEU: [10, 51], IND: [78, 22],
  KOR: [127.5, 36.5], FRA: [2, 47], IDN: [117, -2], THA: [101, 15], CAN: [-106, 56],
  AUS: [134, -25], TWN: [121, 23.7], BGD: [90, 24], MYS: [102, 4], EGY: [30, 26],
  VNM: [106, 16], CHE: [8, 46.8], SGP: [103.8, 1.3], ITA: [12.5, 42.8], SWE: [15, 62],
};
/* ラベルの3段階（密集地帯の判読性のため）。tier1=国名+数値を常設（空間的に孤立した国のみ）、
   tier2=国名のみ常設・数値はホバー、tier3=リング点のみ常設・国名/数値ともホバー */
const MOBMAP_LABEL_TIER = {
  USA: 1, CHN: 1, CAN: 1, AUS: 1, IDN: 1, EGY: 1,
  KOR: 2, TWN: 2, IND: 2, GBR: 2, DEU: 2, THA: 2,
  FRA: 3, ITA: 3, CHE: 3, SWE: 3, VNM: 3, MYS: 3, SGP: 3, BGD: 3,
};
/* 東京・隣国が密集する東アジア／西ヨーロッパのラベル衝突を避けるための個別オフセット表
   （dx,dy=国名の位置、dyVal=数値の位置、align=テキストの基準）。表にない国はデフォルト値を使う */
const MOBMAP_LABEL_OFFSET = {
  KOR: { dx: -10, dy: 3.5, dyVal: 15, align: "right" }, /* 東京の反対（左）側に置く */
  TWN: { dx: -10, dy: 14, dyVal: 25, align: "right" }, /* 左下 */
  CHN: { dx: -10, dy: 3.5, dyVal: 15, align: "right" }, /* 左 */
  GBR: { dx: -10, dy: -6, dyVal: -17, align: "right" }, /* 左上 */
  DEU: { dx: 10, dy: 3.5, dyVal: 15, align: "left" }, /* 右 */
  IND: { dx: -10, dy: 14, dyVal: 25, align: "right" }, /* 左下 */
  THA: { dx: -10, dy: 3.5, dyVal: 15, align: "right" }, /* 左 */
};
const MOBMAP_DEFAULT_OFFSET = { dx: 9, dy: 3.5, dyVal: 15, align: "left" };
const MOBMAP_TOKYO = [139.7, 35.7];
/* 常時飛行中の粒子1つ ≈ 600人（2010-2024年累積の推計値に対する演出用の比例定数。実数の描写ではない） */
const MOBMAP_PER_PARTICLE = 600;
/* 日本列島のおおよそのバウンディングボックス（陸ドットへの淡いamber着色に使う演出上の目安） */
const MOBMAP_JP_BOUNDS = { lonMin: 122, lonMax: 146, latMin: 24, latMax: 46 };

function renderMobMap(mobility, landTopology) {
  const stage = $("#mobmap-stage");
  const base = $("#mobmap-base");
  const fx = $("#mobmap-fx");
  const hoverEl = $("#mobmap-hover");
  if (!stage || !base || !fx) return;
  const block = mobility?.oecd_bilateral;
  const landObj = landTopology?.objects?.land;
  /* land-110m.json の取得・変換に失敗した場合はこの図だけ空表示にする。地域別内訳(図B)や
     国別ダイバージングバー(図D)などmobility.jsonだけに依存する図は影響を受けない */
  if (!block || block.status !== "ok" || !(block.japan_outflows || []).length || !landObj || typeof topojson === "undefined") {
    stage.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>';
    return;
  }
  const outMap = new Map(block.japan_outflows.map((d) => [d.country_code, d]));
  const inMap = new Map(block.japan_inflows.map((d) => [d.country_code, d]));
  const codes = Object.keys(MOBMAP_COUNTRY_ANCHORS).filter((c) => outMap.has(c) || inMap.has(c));
  if (!codes.length) { stage.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>'; return; }
  /* データ更新で上位20か国の顔ぶれが変わり座標表に無い国が現れた場合、黙って落とさず注記する */
  const unmapped = [...new Set([...outMap.keys(), ...inMap.keys()])].filter((c) => !MOBMAP_COUNTRY_ANCHORS[c]);
  if (unmapped.length) console.warn("[people] mobmap: no anchor coords for", unmapped);

  const countryData = codes.map((code) => {
    const outRec = outMap.get(code), inRec = inMap.get(code);
    const outflow = Number.isFinite(outRec?.persons) ? outRec.persons : null;
    const inflow = Number.isFinite(inRec?.persons) ? inRec.persons : null;
    return {
      code,
      name: outRec?.country_name_ja || inRec?.country_name_ja || code,
      anchor: MOBMAP_COUNTRY_ANCHORS[code],
      outflow, inflow,
      tier: MOBMAP_LABEL_TIER[code] || 3,
      offset: MOBMAP_LABEL_OFFSET[code] || MOBMAP_DEFAULT_OFFSET,
    };
  });

  let landFeature;
  try {
    landFeature = topojson.feature(landTopology, landObj);
  } catch (error) {
    stage.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>';
    return;
  }

  /* 陸ドット用の点群（球面判定のみ・投影に依存しない）。1回だけ計算する */
  const landPoints = [];
  const STEP = 1.4;
  for (let lat = -85; lat <= 85; lat += STEP) {
    for (let lon = -180; lon < 180; lon += STEP) {
      if (d3.geoContains(landFeature, [lon, lat])) {
        const jp = lon >= MOBMAP_JP_BOUNDS.lonMin && lon <= MOBMAP_JP_BOUNDS.lonMax && lat >= MOBMAP_JP_BOUNDS.latMin && lat <= MOBMAP_JP_BOUNDS.latMax;
        landPoints.push({ lon, lat, jp });
      }
    }
  }

  const projection = d3.geoNaturalEarth1().rotate([-140, 0]);
  const dotCache = document.createElement("canvas");
  const dotCtx = dotCache.getContext("2d");

  let geom = null;
  let focusCode = null;
  let running = true;
  let particles = [];
  const pulseStart = performance.now();

  function buildDotCache(width, height, dpr) {
    dotCache.width = Math.max(1, Math.round(width * dpr));
    dotCache.height = Math.max(1, Math.round(height * dpr));
    dotCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    dotCtx.clearRect(0, 0, width, height);
    for (const p of landPoints) {
      const pos = projection([p.lon, p.lat]);
      if (!pos) continue;
      dotCtx.fillStyle = p.jp ? "rgba(255,181,69,0.24)" : "rgba(34,48,74,0.85)";
      dotCtx.fillRect(pos[0] - 0.7, pos[1] - 0.7, 1.4, 1.4);
    }
  }

  /* 進行方向に対して垂直にoffピクセルずらした平行線を作る（流出/流入の2本を分離するため） */
  function offsetPath(points, off) {
    const n = points.length;
    return points.map((pt, i) => {
      const prev = points[Math.max(0, i - 1)], next = points[Math.min(n - 1, i + 1)];
      let dx = next[0] - prev[0], dy = next[1] - prev[1];
      const len = Math.hypot(dx, dy) || 1;
      dx /= len; dy /= len;
      return [pt[0] - dy * off, pt[1] + dx * off];
    });
  }

  function drawPath(ctx, points, color, alpha, width) {
    if (alpha <= 0) return;
    ctx.beginPath();
    points.forEach((pt, i) => { if (i === 0) ctx.moveTo(pt[0], pt[1]); else ctx.lineTo(pt[0], pt[1]); });
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = width;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function layout() {
    const { width: bw, height: bh } = fitCanvas(base);
    fitCanvas(fx);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    projection.fitSize([bw, bh], { type: "Sphere" });
    buildDotCache(bw, bh, dpr);

    const tokyoXY = projection(MOBMAP_TOKYO);
    const N = 56;
    const off = MOBILE ? 1.6 : 2.4;
    const countries = countryData.map((d) => {
      const interp = d3.geoInterpolate(MOBMAP_TOKYO, d.anchor);
      const center = d3.range(N + 1).map((i) => projection(interp(i / N)));
      let pxLen = 0;
      for (let i = 1; i < center.length; i += 1) pxLen += Math.hypot(center[i][0] - center[i - 1][0], center[i][1] - center[i - 1][1]);
      return {
        ...d,
        anchorXY: projection(d.anchor),
        pxLen,
        outPath: d.outflow != null ? offsetPath(center, off) : null,
        inPath: d.inflow != null ? offsetPath(center, -off) : null,
      };
    });

    /* 東京近傍（KOR/CHN/TWNなど）は航路が画面上でごく短いため、他ルートと同じt速度で動かすと
       粒子が団子状に密集して見える。画面上の速さ(px/フレーム)は t速度×航路長 なので、
       短い航路ほど t速度を上げて見かけの流速を揃える（上限4倍でクランプし、
       近距離航路の粒子が瞬間移動に見えないようにする） */
    const maxPxLen = d3.max(countries, (c) => c.pxLen) || 1;
    const speedScaleFor = (pxLen) => Math.max(1, Math.min(4, maxPxLen / Math.max(pxLen, 1)));

    const mobileScale = MOBILE ? 0.5 : 1;
    particles = [];
    if (!REDUCED) {
      for (const c of countries) {
        const speedScale = speedScaleFor(c.pxLen);
        if (c.outPath) {
          const n = Math.max(1, Math.round((c.outflow / MOBMAP_PER_PARTICLE) * mobileScale));
          for (let i = 0; i < n; i += 1) particles.push({ path: c.outPath, dir: "out", code: c.code, t: Math.random(), speed: (0.0022 + Math.random() * 0.0016) * speedScale });
        }
        if (c.inPath) {
          const n = Math.max(1, Math.round((c.inflow / MOBMAP_PER_PARTICLE) * mobileScale));
          for (let i = 0; i < n; i += 1) particles.push({ path: c.inPath, dir: "in", code: c.code, t: Math.random(), speed: (0.0022 + Math.random() * 0.0016) * speedScale });
        }
      }
    }
    geom = { width: bw, height: bh, tokyoXY, countries };
    drawBase();
    if (fx.getContext) { const fctx = fx.getContext("2d"); fctx.clearRect(0, 0, bw, bh); }
  }

  function drawBase() {
    if (!geom) return;
    const ctx = base.getContext("2d");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, geom.width, geom.height);
    ctx.drawImage(dotCache, 0, 0, geom.width, geom.height);

    for (const c of geom.countries) {
      const active = !focusCode || focusCode === c.code;
      if (REDUCED) {
        if (c.outPath) drawPath(ctx, c.outPath, MOB_DISPATCH_COLOR, active ? 0.55 : 0.15, Math.max(0.6, Math.sqrt(c.outflow) * 0.045));
        if (c.inPath) drawPath(ctx, c.inPath, MOB_INFLOW_COLOR, active ? 0.55 : 0.15, Math.max(0.6, Math.sqrt(c.inflow) * 0.045));
      } else {
        if (c.outPath) drawPath(ctx, c.outPath, MOB_DISPATCH_COLOR, active ? 0.16 : 0.05, 1);
        if (c.inPath) drawPath(ctx, c.inPath, MOB_INFLOW_COLOR, active ? 0.16 : 0.05, 1);
      }
    }

    ctx.beginPath();
    ctx.arc(geom.tokyoXY[0], geom.tokyoXY[1], 3.4, 0, Math.PI * 2);
    ctx.fillStyle = MOB_DISPATCH_COLOR;
    ctx.globalAlpha = 0.9;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.font = '600 10px "IBM Plex Mono", monospace';
    ctx.fillStyle = "#e9eef7";
    ctx.textAlign = "left";
    /* 東京ラベルは常に右上に固定（近傍国のラベルは反対側や別方向へ逃がして衝突を避ける） */
    ctx.fillText("東京", geom.tokyoXY[0] + 8, geom.tokyoXY[1] - 7);

    for (const c of geom.countries) {
      /* focused=この国にポインタ/タップ、dimmed=他国がフォーカスされている。
         未フォーカス時に全国をactive扱いにするとtierの間引きが無効化されるので分離する */
      const focused = focusCode === c.code;
      const dimmed = !!focusCode && !focused;
      const tier = c.tier;
      const offset = c.offset;
      /* tier3（リング点のみ常設）は数値・国名がないと見失われやすいので、リングの視認性を上げる */
      ctx.globalAlpha = focused ? 1 : dimmed ? 0.18 : tier === 3 ? 0.6 : 0.45;
      ctx.beginPath();
      ctx.arc(c.anchorXY[0], c.anchorXY[1], 5, 0, Math.PI * 2);
      ctx.strokeStyle = focused ? "#8b96ab" : "#4c5a72";
      ctx.lineWidth = tier === 3 ? 1.7 : 1.2;
      ctx.stroke();
      ctx.globalAlpha = 1;

      /* tier1・tier2は国名を常設。tier3はホバー/タップ時のみ国名を出す */
      const showName = focused || (!dimmed && tier <= 2);
      /* 数値の常設表示はtier1のみ、かつモバイルでは常設をやめて全てホバー/タップに委ねる */
      const showValue = focused || (!dimmed && tier === 1 && !MOBILE);
      ctx.textAlign = offset.align;
      if (showName) {
        ctx.globalAlpha = focused ? 1 : 0.7;
        ctx.font = '500 10.5px "IBM Plex Mono", monospace';
        ctx.fillStyle = focused ? "#e9eef7" : "#8b96ab";
        ctx.fillText(c.name, c.anchorXY[0] + offset.dx, c.anchorXY[1] + offset.dy);
      }
      if (showValue) {
        ctx.font = '400 9px "IBM Plex Mono", monospace';
        ctx.fillStyle = focused ? "#8b96ab" : "#5c6a82";
        const total = (c.outflow ?? 0) + (c.inflow ?? 0);
        const valueLabel = MOBILE
          ? `計${fmtInt(total)}`
          : `出${c.outflow != null ? fmtInt(c.outflow) : "圏外"} / 入${c.inflow != null ? fmtInt(c.inflow) : "圏外"}`;
        ctx.fillText(valueLabel, c.anchorXY[0] + offset.dx, c.anchorXY[1] + offset.dyVal);
      }
      ctx.globalAlpha = 1;
    }
    ctx.textAlign = "left";
  }

  function frame() {
    if (!running || !geom) return;
    const ctx = fx.getContext("2d");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    /* destination-outで既存ピクセルの不透明度だけを少しずつ落とす → 透明な背景を保ったまま
       粒子が流星のような残光の尾を引く（陸ドット・航路線・ラベルはbase canvas側で常にクリアに保たれる） */
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = "rgba(0,0,0,0.12)";
    ctx.fillRect(0, 0, geom.width, geom.height);
    ctx.globalCompositeOperation = "lighter";

    const elapsed = (performance.now() - pulseStart) % 2200;
    const phase = elapsed / 2200;
    ctx.beginPath();
    ctx.arc(geom.tokyoXY[0], geom.tokyoXY[1], 3 + phase * 14, 0, Math.PI * 2);
    ctx.strokeStyle = MOB_DISPATCH_COLOR;
    ctx.globalAlpha = Math.max(0, 0.5 * (1 - phase));
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.globalAlpha = 1;

    for (const p of particles) {
      p.t += p.speed;
      if (p.t > 1) p.t -= 1;
      const n = p.path.length;
      const idx = p.t * (n - 1);
      const i0 = Math.floor(idx), frac = idx - i0;
      const a = p.path[i0], b = p.path[Math.min(n - 1, i0 + 1)];
      const px = a[0] + (b[0] - a[0]) * frac, py = a[1] + (b[1] - a[1]) * frac;
      const active = !focusCode || p.code === focusCode;
      ctx.fillStyle = p.dir === "out" ? MOB_DISPATCH_COLOR : MOB_INFLOW_COLOR;
      ctx.globalAlpha = active ? 0.85 : 0.1;
      const size = 1.7;
      ctx.fillRect(px - size / 2, py - size / 2, size, size);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    requestAnimationFrame(frame);
  }

  function hitTest(mx, my) {
    if (!geom) return null;
    let best = null, bestDist = 26;
    for (const c of geom.countries) {
      const dist = Math.hypot(mx - c.anchorXY[0], my - c.anchorXY[1]);
      if (dist < bestDist) { bestDist = dist; best = c; }
    }
    return best;
  }

  function showHover(c, event) {
    if (!hoverEl) return;
    const bounds = stage.getBoundingClientRect();
    const outText = c.outflow != null ? `${fmtInt(c.outflow)}人` : "上位20位外";
    const inText = c.inflow != null ? `${fmtInt(c.inflow)}人` : "上位20位外";
    const netText = c.outflow != null && c.inflow != null
      ? `純差 ${fmtInt(Math.abs(c.outflow - c.inflow))}人の${c.outflow >= c.inflow ? "出超" : "入超"}`
      : "純差 不明（片方が圏外）";
    hoverEl.innerHTML = `<b>${escapeHtml(c.name)}</b><br>日本 → 同国 ${outText}<br>同国 → 日本 ${inText}<br>${netText}`;
    hoverEl.style.left = `${Math.min(event.clientX - bounds.left + 14, bounds.width - 190)}px`;
    hoverEl.style.top = `${Math.max(0, event.clientY - bounds.top - 24)}px`;
    hoverEl.classList.add("is-on");
  }
  function hideHover() { hoverEl?.classList.remove("is-on"); }

  function handlePointer(event) {
    if (!geom) return;
    const rect = base.getBoundingClientRect();
    const mx = event.clientX - rect.left, my = event.clientY - rect.top;
    const hit = hitTest(mx, my);
    const nextFocus = hit?.code || null;
    if (nextFocus !== focusCode) { focusCode = nextFocus; drawBase(); }
    if (hit) showHover(hit, event); else hideHover();
  }
  base.addEventListener("pointermove", handlePointer);
  base.addEventListener("pointerdown", handlePointer);
  base.addEventListener("pointerleave", () => {
    if (focusCode) { focusCode = null; drawBase(); }
    hideHover();
  });

  layout();
  if (!REDUCED) {
    const observer = new IntersectionObserver((entries) => {
      const visible = entries[0]?.isIntersecting;
      if (visible && !running) { running = true; frame(); }
      else if (!visible) running = false;
    }, { threshold: 0.05 });
    observer.observe(base);
    frame();
  }
  /* 連続リサイズ中に投影・航路・ドットキャッシュの再構築が毎イベント走らないようrAFでまとめる。
     MOBILE はサイト全体の慣例に合わせてロード時定数のまま（ブレークポイントをまたぐリサイズは再読込で反映） */
  let resizeRaf = 0;
  window.addEventListener("resize", () => {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => layout());
  }, { passive: true });

  setText("#mobmap-source",
    `出典: ${block.source?.title || ""}。単位: ${block.unit || ""}。${block.note || ""} 粒子の数・速さは人数に比例させた演出であり実数の描写ではない。航路は実際の渡航経路ではなく、日本と各国の代表点を結んだ大圏航路（最短距離の弧）。国のアンカーは代表点であり、首都や重心を意味しない。片方の上位20位内にのみ入る国は、もう片方を「圏外」と表示する（0人という意味ではない）。地図が混み合う地域は常設ラベルを間引いている — 小さな点だけの国もポインタを合わせる／タップすると数値を表示する。後出の参考セクション（図E・F、MEXT「延べ渡航者数」＝所属を保った渡航イベントの統計）とは測っているものが異なる — こちらは著者の所属国の変化を移動とみなした推計で、単一の累積スナップショット（年次推移はない）。国別の詳細な数値は直後の図Cを参照。陸の形状: world-atlas land-110m（Natural Earth由来、パブリックドメイン）。${unmapped.length ? `座標未登録のため地図に表示していない国: ${unmapped.join("、")}（数値は図Cを参照）。` : ""}`);
}

function drawMobRegionPanel(container, title, data, order, color, ariaLabel) {
  const wrap = document.createElement("div");
  wrap.className = "mob-quad-panel";
  const titleEl = document.createElement("p");
  titleEl.className = "mob-panel-title";
  titleEl.textContent = title;
  wrap.appendChild(titleEl);
  const body = document.createElement("div");
  body.className = "fig-body";
  wrap.appendChild(body);
  container.appendChild(wrap);

  const val = (r) => (Number.isFinite(data[r]) ? data[r] : 0);
  const maxVal = d3.max(order, val) || 1;
  const width = 260, height = order.length * 27 + 12;
  const margin = { top: 4, right: 46, bottom: 4, left: 62 };
  const x = d3.scaleLinear().domain([0, maxVal * 1.15]).range([margin.left, width - margin.right]);
  const y = d3.scaleBand().domain(order).range([margin.top, height - margin.bottom]).padding(0.3);
  const svg = d3.select(body).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img").attr("aria-label", ariaLabel);
  const bars = svg.append("g").selectAll("rect").data(order).join("rect")
    .attr("x", x(0)).attr("y", (r) => y(r)).attr("height", y.bandwidth())
    .attr("width", (r) => Math.max(0, x(val(r)) - x(0)))
    .attr("fill", color).attr("opacity", 0.85);
  bars.append("title").text((r) => `${r}: ${fmtInt(val(r))}人`);
  svg.append("g").selectAll("text.rlabel").data(order).join("text")
    .attr("x", margin.left - 6).attr("y", (r) => y(r) + y.bandwidth() / 2 + 3.5)
    .attr("text-anchor", "end").attr("font-size", 9.5).attr("fill", "#8b96ab")
    .text((r) => MOB_REGION_SHORT[r] || r);
  svg.append("g").selectAll("text.rvalue").data(order).join("text")
    .attr("x", (r) => x(val(r)) + 5).attr("y", (r) => y(r) + y.bandwidth() / 2 + 3.5)
    .attr("font-size", 9.5).attr("fill", "#e9eef7").text((r) => fmtInt(val(r)));
  if (!REDUCED && gsap) {
    gsap.from(bars.nodes(), { attr: { width: 0 }, duration: 0.8, ease: "power3.out", stagger: 0.03, scrollTrigger: { trigger: body, start: "top 88%" } });
  }
}

function renderMobRegional(mobility) {
  const mount = $("#mob-regional");
  const mf = mobility?.mext_flows;
  const rl = mf?.regional_latest;
  if (!mount) return;
  if (!mf || mf.status !== "ok" || !rl) { mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>'; return; }
  const regions = Object.keys(rl.dispatch_short || {});
  if (!regions.length) { mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>'; return; }
  mount.innerHTML = "";
  const finiteOrZero = (v) => (Number.isFinite(v) ? v : 0);
  const combined = Object.fromEntries(regions.map((r) => [r,
    finiteOrZero(rl.dispatch_short[r]) + finiteOrZero(rl.dispatch_mid_long[r]) + finiteOrZero(rl.inflow_short[r]) + finiteOrZero(rl.inflow_mid_long[r]),
  ]));
  const order = [...regions].sort((a, b) => combined[b] - combined[a]);
  const panels = [
    { key: "dispatch_short", title: "派遣・短期", data: rl.dispatch_short, totalSeries: mf.dispatch?.short, color: MOB_DISPATCH_COLOR, aria: "派遣（短期）の地域別内訳" },
    { key: "dispatch_mid_long", title: "派遣・中長期", data: rl.dispatch_mid_long, totalSeries: mf.dispatch?.mid_long, color: MOB_DISPATCH_COLOR, aria: "派遣（中・長期）の地域別内訳" },
    { key: "inflow_short", title: "受入・短期", data: rl.inflow_short, totalSeries: mf.inflow?.short, color: MOB_INFLOW_COLOR, aria: "受入（短期）の地域別内訳" },
    { key: "inflow_mid_long", title: "受入・中長期", data: rl.inflow_mid_long, totalSeries: mf.inflow?.mid_long, color: MOB_INFLOW_COLOR, aria: "受入（中・長期）の地域別内訳" },
  ];
  /* 地域計は公表統計の総数と必ずしも一致しない（地域不明・その他を含むため）。
     値はJSONから毎回動的に算出し、0や完全一致に見せない */
  const diffParts = [];
  for (const panel of panels) {
    drawMobRegionPanel(mount, panel.title, panel.data || {}, order, panel.color, panel.aria);
    const regionSum = d3.sum(regions, (r) => finiteOrZero((panel.data || {})[r]));
    const totalPoint = (panel.totalSeries || []).find(([yr]) => yr === rl.fiscal_year);
    if (totalPoint && Number.isFinite(totalPoint[1])) {
      const diff = totalPoint[1] - regionSum;
      if (diff !== 0) diffParts.push(`${panel.title}${fmtInt(Math.abs(diff))}人`);
    }
  }
  setText("#mob-regional-source",
    `出典: ${mf.source?.title || ""}。${rl.fiscal_year}年度の地域別内訳（直近年度のみ、過去分は非公表）。単位: ${mf.unit || ""}。地域は7区分×派遣/受入×短期/中長期の4区分の合計降順。${diffParts.length ? `地域計は総数と一致しない（地域不明・その他が${diffParts.join("、")}）。` : ""}`);
}

function renderMobBilateral(mobility) {
  const mount = $("#mob-bilateral");
  const block = mobility?.oecd_bilateral;
  if (!mount) return;
  if (!block || block.status !== "ok" || !(block.japan_outflows || []).length) { mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>'; return; }
  mount.innerHTML = "";
  const outMap = new Map(block.japan_outflows.map((d) => [d.country_code, d]));
  const inMap = new Map(block.japan_inflows.map((d) => [d.country_code, d]));
  const codes = new Set([...outMap.keys(), ...inMap.keys()]);
  /* japan_outflows/japan_inflowsはそれぞれ独立した上位20か国リスト。片方にしか
     登場しない国は「0人」ではなく「もう片方のランキング圏外（順位不明・非公表）」なので、
     nullのまま保持して0本のバーと区別する（0埋めしない） */
  const rows = [...codes].map((code) => {
    const outRec = outMap.get(code);
    const inRec = inMap.get(code);
    const outflow = Number.isFinite(outRec?.persons) ? outRec.persons : null;
    const inflow = Number.isFinite(inRec?.persons) ? inRec.persons : null;
    return { name: outRec?.country_name_ja || inRec?.country_name_ja || code, outflow, inflow };
  }).sort((a, b) => ((b.outflow ?? 0) + (b.inflow ?? 0)) - ((a.outflow ?? 0) + (a.inflow ?? 0)));
  const top = rows.slice(0, 12);
  if (!top.length) { mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>'; return; }

  mount.insertAdjacentHTML("beforebegin", `<div class="pub-legend">
    <span><i style="background:${MOB_DISPATCH_COLOR}"></i>日本 → 海外</span>
    <span><i style="background:${MOB_INFLOW_COLOR}"></i>海外 → 日本</span>
  </div>`);

  const width = mount.clientWidth || 900, height = Math.max(320, top.length * 30 + 46);
  const margin = { top: 18, right: 60, bottom: 28, left: 60 };
  const maxSide = d3.max(top, (r) => Math.max(r.outflow ?? 0, r.inflow ?? 0)) || 1;
  const centerX = margin.left + (width - margin.left - margin.right) / 2;
  const xOut = d3.scaleLinear().domain([0, maxSide * 1.1]).range([centerX, margin.left]);
  const xIn = d3.scaleLinear().domain([0, maxSide * 1.1]).range([centerX, width - margin.right]);
  const y = d3.scaleBand().domain(top.map((r) => r.name)).range([margin.top, height - margin.bottom]).padding(0.28);
  const svg = d3.select(mount).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img")
    .attr("aria-label", "OECD推計による日本の研究者の国別移動、2010〜2024年累積。左が日本から海外への移動、右が海外から日本への移動。米国はほぼ拮抗し、中国は日本からの流出がやや上回る。片方の上位20位内にのみ入る国は、もう片方を「圏外」と表示する。");
  svg.append("line").attr("x1", centerX).attr("x2", centerX).attr("y1", margin.top - 6).attr("y2", height - margin.bottom + 6).attr("stroke", "#4c5a72");
  const barsOut = svg.append("g").selectAll("rect.mob-out").data(top.filter((r) => r.outflow != null)).join("rect")
    .attr("x", (r) => xOut(r.outflow)).attr("y", (r) => y(r.name)).attr("height", y.bandwidth())
    .attr("width", (r) => centerX - xOut(r.outflow)).attr("fill", MOB_DISPATCH_COLOR).attr("opacity", 0.85);
  barsOut.append("title").text((r) => `${r.name}: 日本→海外 ${fmtInt(r.outflow)}人`);
  const barsIn = svg.append("g").selectAll("rect.mob-in").data(top.filter((r) => r.inflow != null)).join("rect")
    .attr("x", centerX).attr("y", (r) => y(r.name)).attr("height", y.bandwidth())
    .attr("width", (r) => xIn(r.inflow) - centerX).attr("fill", MOB_INFLOW_COLOR).attr("opacity", 0.85);
  barsIn.append("title").text((r) => `${r.name}: 海外→日本 ${fmtInt(r.inflow)}人`);
  svg.append("g").selectAll("text.mob-blabel").data(top).join("text")
    .attr("class", "mg-label").attr("x", centerX).attr("y", (r) => y(r.name) + y.bandwidth() / 2 + 3)
    .attr("text-anchor", "middle").attr("font-size", 10).text((r) => r.name);
  svg.append("g").selectAll("text.mob-ovalue").data(top).join("text")
    .attr("x", (r) => (r.outflow != null ? xOut(r.outflow) - 6 : margin.left + 4))
    .attr("y", (r) => y(r.name) + y.bandwidth() / 2 + 3.5)
    .attr("text-anchor", (r) => (r.outflow != null ? "end" : "start"))
    .attr("font-size", (r) => (r.outflow != null ? 10 : 9))
    .attr("fill", (r) => (r.outflow != null ? MOB_DISPATCH_COLOR : "#4c5a72"))
    .text((r) => (r.outflow != null ? fmtInt(r.outflow) : "上位20位外"));
  svg.append("g").selectAll("text.mob-ivalue").data(top).join("text")
    .attr("x", (r) => (r.inflow != null ? xIn(r.inflow) + 6 : width - margin.right - 4))
    .attr("y", (r) => y(r.name) + y.bandwidth() / 2 + 3.5)
    .attr("text-anchor", (r) => (r.inflow != null ? "start" : "end"))
    .attr("font-size", (r) => (r.inflow != null ? 10 : 9))
    .attr("fill", (r) => (r.inflow != null ? MOB_INFLOW_COLOR : "#4c5a72"))
    .text((r) => (r.inflow != null ? fmtInt(r.inflow) : "上位20位外"));
  if (!REDUCED && gsap) {
    gsap.from([...barsOut.nodes(), ...barsIn.nodes()], { attr: { width: 0 }, duration: 0.85, ease: "power3.out", stagger: 0.03, scrollTrigger: { trigger: mount, start: "top 82%" } });
  }

  const totals = block.totals || {};
  const net = (totals.outflow_total ?? 0) - (totals.inflow_total ?? 0);
  setText("#mob-bilateral-source",
    `出典: ${block.source?.title || ""}。単位: ${block.unit || ""}。${block.note || ""} 2010〜2024年累積で、日本から海外への移動${fmtInt(totals.outflow_total ?? 0)}人に対し、海外から日本への移動${fmtInt(totals.inflow_total ?? 0)}人（差は${fmtInt(Math.abs(net))}人の${net >= 0 ? "出超" : "入超"}）。国別の値は日本→海外・海外→日本それぞれ独立の上位20か国のみ公表されており、片方の上位20位内にのみ入る国は「上位20位外」と表示している（0人という意味ではない）。後出の参考セクション（図E）の延べ渡航者数（同一人物の複数回渡航を含む渡航イベントの集計）とは測っているものが異なる — こちらは著者の所属国の変化を移動とみなした推計。`);
}

function renderMobFacultyChip(mobility) {
  const chip = $("#mob-faculty-chip");
  const block = mobility?.foreign_faculty;
  if (!chip) return;
  const point = block?.status === "ok" ? lastPoint(block.series || []) : null;
  if (!block || block.status !== "ok" || !point) { chip.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>'; return; }
  chip.innerHTML = `<b>${fmtInt(point.total)}<small>人</small></b><span>外国人本務教員数（大学）</span><small>${escapeHtml(point.survey_round || "")}・ストック値（在籍者数、フローではない）</small>`;
  setText("#mob-faculty-source",
    `出典: ${block.source?.title || ""}。単位: ${block.unit || ""}。${block.note || ""} 男${fmtInt(point.male ?? 0)}人・女${fmtInt(point.female ?? 0)}人。`);
}

/* ================================================================ 03-D 博士たちの選択（3つの断面） */

/* JSPS海外特別研究員の進路: 6区分の100%積み上げ横棒（HTML+CSSのみ、cmp-stackを再利用）。
   色は「海外」を含むラベル＝amber、「非研究職」＝濃灰、それ以外（国内）＝slate、というラベル文字列
   ベースの判定にしている（ハードコードの対応表を作ると区分が増えたときに追従できないため） */
function renderMobJsps(mount, block) {
  if (!mount) return;
  mount.innerHTML = "";
  const dest = block?.status === "ok" ? (block.destinations || []) : [];
  if (!block || block.status !== "ok" || !dest.length || !block.abroad_total) {
    mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>';
    return;
  }
  const colorFor = (label) => (label.includes("海外") ? MOB_DISPATCH_COLOR : label.includes("非研究職") ? "#2c3648" : "#4f7ca6");
  const stack = dest.map((d) => `<i style="width:${Math.max(0, d.pct)}%;background:${colorFor(d.label)}" title="${escapeHtml(d.label)}: ${fmtInt(d.count)}人（${d.pct}%）"></i>`).join("");
  const abroad = block.abroad_total;
  mount.innerHTML = `
    <div class="cmp-stack" style="height:20px">${stack}</div>
    <p class="mob-subnote" style="margin-top:6px">オレンジ=海外 / 青灰=国内 / 濃灰=非研究職</p>
    <div style="margin-top:10px"><span class="mob-headline">${fmtInt(abroad.count)}</span><span class="mob-unit">人（${abroad.pct}%）が任期終了後も海外に残った</span></div>`;
}

/* JD-Pro: 修了後経過年ごとのコホート別の小さな折れ線（実線=2012年度コホート・破線=2015年度コホート） */
function drawJdproMini(mount, seriesList, color, ariaLabel) {
  if (!mount) return;
  const allPts = seriesList.flatMap((s) => s.pts || []);
  if (!allPts.length) { mount.innerHTML = '<p class="data-empty" style="padding:6px 0">データを取得できませんでした。</p>'; return; }
  const width = 240, height = 76;
  const margin = { top: 8, right: 44, bottom: 18, left: 8 };
  const maxYears = d3.max(allPts, (p) => p.elapsed_years) || 1;
  const maxPct = d3.max(allPts, (p) => p.pct) || 1;
  const x = d3.scaleLinear().domain([0, maxYears * 1.05]).range([margin.left, width - margin.right]);
  const y = d3.scaleLinear().domain([0, maxPct * 1.25]).range([height - margin.bottom, margin.top]);
  const svg = d3.select(mount).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img").attr("aria-label", ariaLabel);
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).ticks(4).tickFormat((v) => `${v}年`)).select(".domain").attr("stroke", "#1c2839");
  const line = d3.line().x((p) => x(p.elapsed_years)).y((p) => y(p.pct)).curve(d3.curveMonotoneX);
  for (const s of seriesList) {
    if (!s.pts?.length) continue;
    const path = svg.append("path").attr("d", line(s.pts)).attr("fill", "none").attr("stroke", color)
      .attr("stroke-width", 1.8).attr("opacity", s.dash ? 0.55 : 0.95);
    if (s.dash) path.attr("stroke-dasharray", "3 3");
    svg.append("g").selectAll("circle").data(s.pts).join("circle")
      .attr("cx", (p) => x(p.elapsed_years)).attr("cy", (p) => y(p.pct)).attr("r", 2.2)
      .attr("fill", color).attr("opacity", s.dash ? 0.55 : 0.95);
    const last = s.pts[s.pts.length - 1];
    svg.append("text").attr("x", x(last.elapsed_years) + 5).attr("y", y(last.pct) + 3)
      .attr("font-size", 9).attr("fill", color).attr("opacity", s.dash ? 0.75 : 1).text(`${last.pct}%`);
  }
}

function renderMobJdpro(mount, block) {
  if (!mount) return;
  mount.innerHTML = "";
  if (!block || block.status !== "ok") { mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>'; return; }
  const jaC12 = block.japanese_abroad?.cohort2012 || [];
  const jaC15 = block.japanese_abroad?.cohort2015 || [];
  const fsC12 = block.foreign_stay_japan?.cohort2012 || [];
  const fsC15 = block.foreign_stay_japan?.cohort2015 || [];
  if (!jaC12.length && !jaC15.length && !fsC12.length && !fsC15.length) {
    mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>';
    return;
  }
  mount.innerHTML = `
    <p class="mob-subnote" style="margin-top:0">海外に出る日本人博士（国籍別・修了後経過年）</p>
    <div class="fig-body" id="mob-jdpro-ja"></div>
    <p class="mob-subnote" style="margin-top:10px">日本に残る外国籍博士（同）</p>
    <div class="fig-body" id="mob-jdpro-fs"></div>`;
  drawJdproMini($("#mob-jdpro-ja"),
    [{ pts: jaC12, dash: false }, { pts: jaC15, dash: true }],
    MOB_DISPATCH_COLOR, "日本人博士のうち海外居住・研究活動実施の割合、コホート別の推移");
  drawJdproMini($("#mob-jdpro-fs"),
    [{ pts: fsC12, dash: false }, { pts: fsC15, dash: true }],
    MOB_INFLOW_COLOR, "外国籍博士のうち日本居住継続の割合、コホート別の推移。経過年とともに低下している。");
}

/* NSF SED: 米国博士取得者数（一時ビザ）の見出し数値＋米国残留意向の国際比較横棒 */
function drawNsfStayBars(mount, rows, avgPct) {
  const width = 240, height = rows.length * 26 + 26;
  const margin = { top: 6, right: 40, bottom: 20, left: 44 };
  const maxV = Math.max(d3.max(rows, (r) => r.cumulative_2018_24_pct) || 0, avgPct ?? 0) * 1.12 || 1;
  const x = d3.scaleLinear().domain([0, maxV]).range([margin.left, width - margin.right]);
  const y = d3.scaleBand().domain(rows.map((r) => r.country_name_ja)).range([margin.top, height - margin.bottom]).padding(0.32);
  const svg = d3.select(mount).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img")
    .attr("aria-label", "米国博士取得者（一時ビザ保有者）の米国残留意向、国籍別の2018-2024年累積比較。日本は全平均を下回る。");
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).ticks(4).tickFormat((v) => `${v}%`)).select(".domain").attr("stroke", "#1c2839");
  if (Number.isFinite(avgPct)) {
    svg.append("line").attr("x1", x(avgPct)).attr("x2", x(avgPct)).attr("y1", margin.top).attr("y2", height - margin.bottom)
      .attr("stroke", "#8b96ab").attr("stroke-dasharray", "3 4");
    svg.append("text").attr("x", x(avgPct) + 3).attr("y", margin.top + 8).attr("font-size", 8.5).attr("fill", "#8b96ab").text(`全平均${avgPct}%`);
  }
  const bars = svg.append("g").selectAll("rect").data(rows).join("rect")
    .attr("x", x(0)).attr("y", (r) => y(r.country_name_ja)).attr("height", y.bandwidth())
    .attr("width", (r) => x(r.cumulative_2018_24_pct) - x(0))
    .attr("fill", (r) => (r.code === "JPN" ? MOB_DISPATCH_COLOR : "#4f7ca6"))
    .attr("opacity", (r) => (r.code === "JPN" ? 0.95 : 0.55));
  bars.append("title").text((r) => `${r.country_name_ja}: ${r.cumulative_2018_24_pct}%（2018-2024年累積、n=${fmtInt(r.cumulative_2018_24_n ?? 0)}）`);
  svg.append("g").selectAll("text.nsflabel").data(rows).join("text")
    .attr("x", margin.left - 6).attr("y", (r) => y(r.country_name_ja) + y.bandwidth() / 2 + 3.5)
    .attr("text-anchor", "end").attr("font-size", 9.5)
    .attr("fill", (r) => (r.code === "JPN" ? MOB_DISPATCH_COLOR : "#8b96ab")).text((r) => r.country_name_ja);
  svg.append("g").selectAll("text.nsfvalue").data(rows).join("text")
    .attr("x", (r) => x(r.cumulative_2018_24_pct) + 5).attr("y", (r) => y(r.country_name_ja) + y.bandwidth() / 2 + 3.5)
    .attr("font-size", 9.5).attr("fill", "#e9eef7").text((r) => `${r.cumulative_2018_24_pct}%`);
  if (!REDUCED && gsap) {
    gsap.from(bars.nodes(), { attr: { width: 0 }, duration: 0.8, ease: "power3.out", stagger: 0.04, scrollTrigger: { trigger: mount, start: "top 88%" } });
  }
}

function renderMobNsf(mount, block) {
  if (!mount) return;
  mount.innerHTML = "";
  if (!block || block.status !== "ok") { mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>'; return; }
  const jp2024 = block.rank_by_year?.["2024"]?.countries?.JPN;
  const totalCountries = block.rank_by_year?.["2024"]?.total_countries;
  const stay = block.stay_intent || {};
  const rows = ["JPN", "KOR", "CHN", "IND"]
    .map((code) => (stay[code] ? { code, ...stay[code] } : null))
    .filter((r) => r && Number.isFinite(r.cumulative_2018_24_pct));
  if (!jp2024 && !rows.length) { mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>'; return; }
  const headline = jp2024
    ? `<div><span class="mob-headline">${fmtInt(jp2024.count)}</span><span class="mob-unit">人・${jp2024.rank}位${totalCountries ? `/${totalCountries}か国` : ""}（2024年）</span></div>`
    : "";
  mount.innerHTML = `${headline}<div class="fig-body" id="mob-nsf-bars" style="margin-top:${headline ? "10px" : "0"}"></div>`;
  if (rows.length) {
    const avgPct = Number.isFinite(stay.ALL?.cumulative_2018_24_pct) ? stay.ALL.cumulative_2018_24_pct : null;
    drawNsfStayBars($("#mob-nsf-bars"), rows, avgPct);
  } else {
    $("#mob-nsf-bars").innerHTML = '<p class="data-empty">データを取得できませんでした。</p>';
  }
}

function renderMobChoices(mobility) {
  const jsps = mobility?.jsps_overseas_fellows;
  const jdpro = mobility?.jdpro;
  const nsf = mobility?.nsf_sed;
  renderMobJsps($("#mob-jsps"), jsps);
  renderMobJdpro($("#mob-jdpro"), jdpro);
  renderMobNsf($("#mob-nsf"), nsf);

  const notes = [];
  if (jsps?.status === "ok") notes.push(`JSPS海外特別研究員: 出典${jsps.source?.title || ""}。${jsps.note || ""}`);
  if (jdpro?.status === "ok") {
    const jdSources = (jdpro.source || []).map((s) => s.title).filter(Boolean).join(" / ");
    notes.push(`JD-Pro: 出典${jdSources}。${jdpro.note || ""}実線=2012年度コホート・破線=2015年度コホート。`);
  }
  if (nsf?.status === "ok") {
    const nsfSources = (nsf.source || []).map((s) => s.title).filter(Boolean).join(" / ");
    notes.push(`NSF SED: 出典${nsfSources}。${nsf.note || ""}`);
  }
  setText("#mob-choices-source", notes.join(" "));
}

/* ================================================================ boot */

async function init() {
  bootFooter();
  initRail();
  const [indicatorsResult, analyticsResult, economyResult, phdSupportResult, mobilityResult, landTopologyResult] = await Promise.allSettled([
    fetchJson("data/indicators.json"),
    fetchJson("data/analytics.json"),
    fetchJson("data/economy.json"),
    fetchJson("data/phd_support.json"),
    fetchJson("data/mobility.json"),
    fetchJson("data/land-110m.json"),
  ]);
  const indicators = indicatorsResult.status === "fulfilled" ? indicatorsResult.value.indicators : null;
  const analytics = analyticsResult.status === "fulfilled" ? analyticsResult.value : null;
  const economy = economyResult.status === "fulfilled" ? economyResult.value : null;
  const phdSupport = phdSupportResult.status === "fulfilled" ? phdSupportResult.value : null;
  /* mobility.json取得失敗は03章のみに影響させる（他の章は独立して動く） */
  const mobility = mobilityResult.status === "fulfilled" ? mobilityResult.value : null;
  /* land-110m.json取得失敗は図Bだけに影響させる（renderMobMap内で.data-emptyにする） */
  const landTopology = landTopologyResult.status === "fulfilled" ? landTopologyResult.value : null;
  if (!indicators && !analytics) {
    setText("#header-status", "人材データを取得できません");
    return;
  }
  $("#header-status-dot")?.classList.add("is-live");

  const phdRows = indicators?.phd_enrollment?.rows || [];
  if (phdRows.length) {
    const peak = phdRows.reduce((a, b) => (b.total > a.total ? b : a));
    const last = phdRows[phdRows.length - 1];
    setText("#people-lede", `博士号・博士課程入学者・研究者の移動をデータで描く。博士課程入学者はピークの${fmtInt(peak.total)}人（${peak.year}年度）から、直近は${fmtInt(last.total)}人。`);
    setText("#header-status", `観測中 — 学校基本調査${phdRows[0].year}–${last.year}年度 / 複数系統の公的統計`);
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
  renderDcRealValue(phdSupport, economy);
  renderDcAcceptance(phdSupport);
  renderPhdLivingSupport(phdSupport);
  /* 章の視覚的な並び: A純流出(reico) → B地図 → C出入りのバランス(bilateral) → D博士たちの選択
     → 参考セクション: E32年の往来(flows) → F地域別(regional) → 外国人本務教員 */
  safeCall("renderMobReico", () => renderMobReico(mobility));
  safeCall("renderMobMap", () => renderMobMap(mobility, landTopology));
  safeCall("renderMobBilateral", () => renderMobBilateral(mobility));
  safeCall("renderMobChoices", () => renderMobChoices(mobility));
  safeCall("renderMobFlows", () => renderMobFlows(mobility));
  safeCall("renderMobRegional", () => renderMobRegional(mobility));
  safeCall("renderMobFacultyChip", () => renderMobFacultyChip(mobility));

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
    blockEntry(economy?.cpi), blockEntry(phdSupport?.dc_acceptance), blockEntry(phdSupport?.living_support),
    blockEntry(mobility?.mext_flows), blockEntry(mobility?.oecd_bilateral), blockEntry(mobility?.foreign_faculty),
    blockEntry(mobility?.reico_flows), blockEntry(mobility?.jsps_overseas_fellows),
    /* dc_stipend_history.source は複数出典の配列（国会会議録・Wayback保存ページ複数点）のため個別展開 */
    ...(phdSupport?.dc_stipend_history?.source || []).map((s) => ({ title: s.title, url: s.url, status: phdSupport.dc_stipend_history.status === "ok" ? "ok" : "unavailable" })),
    ...(analytics?.reality?.sources || []).map((s) => ({ title: s.title, url: s.url, status: s.status === "ok" ? "ok" : "unavailable" })),
    /* nsf_sed / jdpro も source が複数出典の配列なので個別展開 */
    ...(mobility?.nsf_sed?.source || []).map((s) => ({ title: s.title, url: s.url, status: mobility.nsf_sed.status === "ok" ? "ok" : "unavailable" })),
    ...(mobility?.jdpro?.source || []).map((s) => ({ title: s.title, url: s.url, status: mobility.jdpro.status === "ok" ? "ok" : "unavailable" })),
    /* 地図(図B)の陸形状。リポジトリ同梱の静的ファイル(world-atlas、Natural Earth由来) */
    { title: "world-atlas land-110m（Natural Earth由来・陸形状）", url: "https://github.com/topojson/world-atlas", status: "ok" },
  ].filter(Boolean);
  renderLedgerEntries(entries);
}

init().catch((error) => {
  console.error(error);
  setText("#header-status", "人材データを取得できません");
});
