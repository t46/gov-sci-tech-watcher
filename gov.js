/* SCIENCE SIGNAL / GOVERNMENT — 行政の解剖。obs-core.js の後に読み込む。 */
"use strict";

/* ============================================================== helpers */

const choFromMillion = (v) => `${(v / 1e6).toFixed(Math.abs(v) >= 1e6 ? 1 : 2)}兆円`;
const okuFromMillion = (v) => `${fmtInt(Math.round(v / 100))}億円`;
const manFromMillion = (v) => `${fmtInt(Math.round(v * 100))}万円`;
const yenFromMillion = (v) => `${fmtInt(Math.round(v * 1e6))}円`;
const amountFmt = (v) => {
  if (v == null || Number.isNaN(v)) return "—";
  const av = Math.abs(v);
  if (av >= 1e6) return choFromMillion(v);
  if (av >= 100) return okuFromMillion(v);
  if (av >= 1) return manFromMillion(v);
  return yenFromMillion(v);
};

function safeCall(name, fn) {
  try { fn(); } catch (error) { console.error(`[gov] ${name} failed`, error); }
}

const hoverBox = (id) => {
  const node = $(id);
  return {
    show(html, event, mount) {
      if (!node) return;
      const bounds = mount.getBoundingClientRect();
      node.innerHTML = html;
      node.style.left = `${Math.min(event.clientX - bounds.left + 14, bounds.width - 210)}px`;
      node.style.top = `${event.clientY - bounds.top - 24}px`;
      node.classList.add("is-on");
    },
    hide() { node?.classList.remove("is-on"); },
  };
};

function baseAxis(g) {
  g.select(".domain").remove();
  g.selectAll("line").attr("stroke", "#16202f").attr("stroke-dasharray", "2 4");
  return g;
}

/* 府省庁カラー: 観測室の色世界(amber #ffb545 / 深い中間灰青 / cyan #4fd8ff)から派生した
   抑制スケール。文科省=amber、経産省=cyanのみ固定、他は名前のハッシュ値をLab補間の
   位置として使うため、赤・緑を混ぜずに毎回同じ府省庁が同じ色になる。 */
const MUTE_ANCHOR_A = "#ffb545";
const MUTE_ANCHOR_MID = "#7b86a0";
const MUTE_ANCHOR_B = "#4fd8ff";
const muteScale = (t) => (t <= 0.5
  ? d3.interpolateLab(MUTE_ANCHOR_A, MUTE_ANCHOR_MID)(t * 2)
  : d3.interpolateLab(MUTE_ANCHOR_MID, MUTE_ANCHOR_B)((t - 0.5) * 2));
const hashUnit = (str) => {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
};
const MINISTRY_FIXED_COLORS = { "文部科学省": "#ffb545", "経済産業省": "#4fd8ff" };
const OTHER_LABEL_RE = /^その他/;
const ministryColor = (name) => {
  if (!name) return "#46536b";
  if (MINISTRY_FIXED_COLORS[name]) return MINISTRY_FIXED_COLORS[name];
  if (OTHER_LABEL_RE.test(name)) return "#46536b";
  return muteScale(0.16 + hashUnit(name) * 0.68);
};
const hexToRgba = (hex, alpha) => {
  const c = d3.color(hex);
  if (!c) return `rgba(120,150,195,${alpha})`;
  const rgb = c.rgb();
  return `rgba(${Math.round(rgb.r)},${Math.round(rgb.g)},${Math.round(rgb.b)},${alpha})`;
};

/* items から key ごとの合計を求め、上位n件のkeyを返す */
function topKeysByTotal(items, keyFn, valueFn, n) {
  const totals = new Map();
  for (const item of items) {
    const k = keyFn(item);
    totals.set(k, (totals.get(k) || 0) + (valueFn(item) || 0));
  }
  return [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
}

/* ランク付きの横棒リスト（府省庁別ドットプロット・費用内訳などで共用） */
function rankRows(mount, rows, { max = null, valueFmt = (v) => fmtInt(Math.round(v)), barColor = "#4fd8ff" } = {}) {
  if (!mount) return;
  const m = max ?? d3.max(rows, (r) => r.value) ?? 1;
  mount.innerHTML = `<div class="gov-rank">${rows.map((r) => `
    <div class="gov-rank-row">
      <span class="gov-rank-name" title="${escapeHtml(r.label)}">${escapeHtml(r.label)}</span>
      <span class="gov-rank-bar"><i style="width:${m ? Math.min(100, (r.value / m) * 100).toFixed(1) : 0}%;background:${r.color || barColor}"></i></span>
      <span class="gov-rank-value">${valueFmt(r.value)}${r.sub ? `<small>${escapeHtml(r.sub)}</small>` : ""}</span>
    </div>`).join("")}</div>`;
}

function animateStackBars(mount) {
  if (REDUCED || !gsap || !mount) return;
  mount.querySelectorAll(".cmp-stack i").forEach((bar) => {
    const target = bar.style.width;
    gsap.fromTo(bar, { width: "0%" }, { width: target, duration: 1.1, ease: "power3.out", scrollTrigger: { trigger: mount, start: "top 85%" } });
  });
}

/* ============================================================ 00 total */

function renderTotal(gov) {
  const seriesBlock = gov?.budget_series;
  const ministryBlock = gov?.budget_ministry;
  if (!seriesBlock || seriesBlock.status !== "ok") {
    setText("#total-lede", "予算データを取得できませんでした。");
    setText("#total-source", "出典を取得できませんでした。");
    return;
  }
  const years = seriesBlock.fiscal_years || [];
  const li = years.length - 1;
  if (li < 0 || !Number.isFinite(seriesBlock.initial?.[li]) || seriesBlock.initial[li] <= 0) {
    setText("#total-lede", "予算データを取得できませんでした。");
    setText("#total-source", "出典を取得できませんでした。");
    return;
  }
  const latestYear = years[li];
  const shinko = seriesBlock.shinko?.[li] ?? 0;
  const general = seriesBlock.general?.[li] ?? 0;
  const special = seriesBlock.special?.[li] ?? 0;
  const initial = seriesBlock.initial[li];
  const generalOther = Math.max(0, general - shinko);

  /* ---- anatomy strip: 科技振興費は一般会計の内数（二重計上を避ける） ---- */
  const anatomyMount = $("#total-anatomy");
  if (anatomyMount) {
    const parts = [
      { label: "科学技術振興費（一般会計の内数）", value: shinko, color: "#ffb545" },
      { label: "一般会計・その他", value: generalOther, color: "#59687f" },
      { label: "特別会計", value: special, color: "#4fd8ff" },
    ];
    anatomyMount.innerHTML = `
      <p class="gov-anatomy-title">${latestYear}年度当初予算案 ${choFromMillion(initial)} の内訳</p>
      <div class="cmp-stack" style="height:30px">${parts.map((p) => `<i style="width:${Math.max(0, (p.value / initial) * 100).toFixed(2)}%;background:${p.color}" title="${escapeHtml(p.label)} ${choFromMillion(p.value)}">${p.value / initial >= 0.08 ? `<em>${Math.round((p.value / initial) * 100)}%</em>` : ""}</i>`).join("")}</div>
      <div class="gov-anatomy-legend">${parts.map((p) => `<span><i style="background:${p.color}"></i>${escapeHtml(p.label)} ${choFromMillion(p.value)}</span>`).join("")}</div>
      <p class="gov-anatomy-note">科学技術振興費は一般会計の内数。重複計上を避けるため、一般会計はその他分のみを積み上げている（科学技術振興費＋一般会計その他＋特別会計＝当初予算総額）。</p>`;
    animateStackBars(anatomyMount);
  }

  /* ---- main chart: 府省庁別構成の4年推移 ---- */
  const mount = $("#total-stream");
  let rows = [], keys = [];
  const ministryYearKeys = ministryBlock?.status === "ok"
    ? Object.keys(ministryBlock.years || {}).filter((rk) => (ministryBlock.years[rk].ministries || []).length)
    : [];
  if (mount && ministryYearKeys.length) {
    mount.innerHTML = "";
    const yearKeys = ministryYearKeys.sort((a, b) => ministryBlock.years[a].fiscal_year - ministryBlock.years[b].fiscal_year);
    const latestKey = yearKeys[yearKeys.length - 1];
    const latestMinistries = ministryBlock.years[latestKey].ministries;
    const top8 = topKeysByTotal(latestMinistries, (m) => m.ministry, (m) => m.total, 8);
    keys = [...top8, "その他"];
    rows = yearKeys.map((rk) => {
      const yr = ministryBlock.years[rk];
      const row = { year: yr.fiscal_year };
      let others = 0;
      for (const m of yr.ministries) {
        if (top8.includes(m.ministry)) row[m.ministry] = (row[m.ministry] || 0) + (m.total || 0);
        else others += m.total || 0;
      }
      row["その他"] = others;
      return row;
    });
    const width = mount.clientWidth || 1000, height = Math.max(380, Math.min(520, width * 0.44));
    const margin = { top: 24, right: 82, bottom: 34, left: 60 };
    const x = d3.scaleBand().domain(rows.map((r) => r.year)).range([margin.left, width - margin.right]).padding(0.32);
    const stack = d3.stack().keys(keys).value((row, key) => row[key] || 0);
    const series = stack(rows);
    const y = d3.scaleLinear().domain([0, d3.max(rows, (r) => keys.reduce((s, k) => s + (r[k] || 0), 0)) * 1.06]).range([height - margin.bottom, margin.top]);
    const svg = d3.select(mount).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img")
      .attr("aria-label", "府省庁別 科学技術関係予算の推移");
    baseAxis(svg.append("g").attr("class", "axis").attr("transform", `translate(${margin.left},0)`)
      .call(d3.axisLeft(y).ticks(5).tickFormat((v) => choFromMillion(v)).tickSize(-(width - margin.left - margin.right))));
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - margin.bottom})`)
      .call(d3.axisBottom(x).tickFormat(d3.format("d"))).select(".domain").attr("stroke", "#1c2839");
    const groups = svg.append("g").selectAll("g").data(series).join("g").attr("fill", (d) => ministryColor(d.key));
    const bars = groups.selectAll("rect").data((d) => d.map((p) => ({ ...p, key: d.key }))).join("rect")
      .attr("x", (d) => x(d.data.year)).attr("width", x.bandwidth())
      .attr("y", (d) => y(d[1])).attr("height", (d) => Math.max(0, y(d[0]) - y(d[1])))
      .attr("opacity", 0.88);
    if (!REDUCED && gsap) {
      gsap.from(bars.nodes(), { attr: { height: 0 }, y: y(0), duration: 0.9, ease: "power3.out", stagger: 0.01, scrollTrigger: { trigger: mount, start: "top 80%" } });
    }
    const lastRow = rows[rows.length - 1];
    for (const s of series) {
      const d = s[s.length - 1];
      const thickness = y(d[0]) - y(d[1]);
      if (thickness > 13) {
        svg.append("text").attr("x", x(lastRow.year) + x.bandwidth() + 8).attr("y", (y(d[0]) + y(d[1])) / 2 + 4)
          .attr("font-size", 10.5).attr("fill", ministryColor(s.key)).attr("font-weight", 600).text(s.key);
      }
    }
    const hover = hoverBox("#total-hover");
    function showHover(event, d) {
      const yearRow = rows.find((r) => r.year === d.data.year);
      const trend = rows.map((r) => `${r.year}: ${choFromMillion(r[d.key] || 0)}`).join(" / ");
      hover.show(`<b>${escapeHtml(d.key)}</b><br>${d.data.year}年度 ${choFromMillion(yearRow ? yearRow[d.key] || 0 : 0)}<br><span style="color:var(--faint)">${escapeHtml(trend)}</span>`, event, mount);
    }
    bars.on("pointerenter", showHover).on("pointermove", showHover).on("pointerleave", () => hover.hide());
    setText("#total-years-label", `${rows[0].year}〜${rows[rows.length - 1].year}年度`);
  } else if (mount) {
    mount.innerHTML = '<p class="data-empty">府省庁別データを取得できませんでした。</p>';
  }

  /* ---- lede: 実データから増減の主因を計算 ---- */
  const projectsBlock = gov?.projects;
  let growthText = "";
  if (ministryYearKeys.length) {
    const yearKeys = ministryYearKeys.slice().sort((a, b) => ministryBlock.years[a].fiscal_year - ministryBlock.years[b].fiscal_year);
    const latestKey = yearKeys[yearKeys.length - 1];
    const prevKey = yearKeys[yearKeys.length - 2];
    if (prevKey) {
      const latestList = ministryBlock.years[latestKey].ministries;
      const prevList = ministryBlock.years[prevKey].ministries;
      const prevTotal = ministryBlock.years[prevKey].total;
      const latestTotal = ministryBlock.years[latestKey].total;
      const growthPct = prevTotal ? ((latestTotal - prevTotal) / prevTotal) * 100 : null;
      let driver = null;
      for (const m of latestList) {
        const prevM = prevList.find((p) => p.ministry === m.ministry);
        const delta = (m.total || 0) - (prevM ? prevM.total || 0 : 0);
        const deltaSpecial = (m.special || 0) - (prevM ? prevM.special || 0 : 0);
        const deltaGeneral = (m.general || 0) - (prevM ? prevM.general || 0 : 0);
        if (!driver || delta > driver.delta) driver = { ministry: m.ministry, delta, deltaSpecial, deltaGeneral };
      }
      if (driver && driver.delta > 0) {
        const accountLabel = Math.abs(driver.deltaSpecial) > Math.abs(driver.deltaGeneral) ? "特別会計" : "一般会計";
        const growthPctText = growthPct != null ? `前年度比${growthPct >= 0 ? "+" : ""}${growthPct.toFixed(0)}%。` : "";
        growthText = `${growthPctText}最大の押し上げ要因は${driver.ministry}の${accountLabel}（${choFromMillion(driver.delta)}増）。`;
      }
    }
  }
  const projectCount = projectsBlock?.status === "ok" ? projectsBlock.count : null;
  setText("#total-lede", `${latestYear}年度当初予算案の科学技術関係予算は${choFromMillion(initial)}${projectCount ? `、${fmtInt(projectCount)}事業` : ""}。${growthText}`);
  setText("#total-source", `出典: ${seriesBlock.source?.title || ""}。各年度は当該年度の予算資料そのものの値を採用しており、後年の資料に載る参考値とは一致しないことがある。府省庁の新設・改組により、年度によって値が存在しない府省庁がある（こども家庭庁は2024年度から等）。`);
}

/* ============================================================ 01 cycle */

function renderCycle(gov) {
  const mount = $("#cycle-ring");
  const block = gov?.budget_series;
  if (!mount || !block || block.status !== "ok") {
    if (mount) mount.innerHTML = '<p class="data-empty">データを取得できませんでした。</p>';
    return;
  }
  const years = block.fiscal_years || [];
  const li = years.length - 1;
  if (li < 0 || !Number.isFinite(block.initial?.[li]) || block.initial[li] <= 0) {
    mount.innerHTML = '<p class="data-empty">データが不足しています。</p>';
    return;
  }
  mount.innerHTML = "";
  const latestYear = years[li];
  const prevYear = li - 1 >= 0 ? years[li - 1] : null;
  const prevInitial = li - 1 >= 0 ? block.initial?.[li - 1] : null;
  const requestTotal = block.request?.total;
  const requestYoubou = block.request?.of_which_youbou;
  const initial = block.initial[li];

  const width = mount.clientWidth || 900, height = MOBILE ? 320 : 230;
  const svg = d3.select(mount).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img")
    .attr("aria-label", "予算のサイクル: 概算要求から成立まで");

  const nodes = [
    { label: `${prevYear}年度 当初予算（起点）`, sub: "3月成立", value: prevInitial, x: 0.1 },
    { label: `${latestYear}年度 概算要求（8月）`, sub: requestYoubou ? `うち要望額 ${choFromMillion(requestYoubou)}` : "", value: requestTotal, x: 0.5 },
    { label: `${latestYear}年度 当初予算案（成立）`, sub: "12月政府案・3月国会成立", value: initial, x: 0.9 },
  ].filter((n) => n.value != null);
  if (!nodes.length) { mount.innerHTML = '<p class="data-empty">データが不足しています。</p>'; return; }

  const cy = height / 2 - 6;
  const lineNode = svg.append("line").attr("x1", width * nodes[0].x).attr("x2", width * nodes[nodes.length - 1].x).attr("y1", cy).attr("y2", cy)
    .attr("stroke", "#1c2839").attr("stroke-width", 1.4);
  if (!REDUCED && gsap) {
    const len = width * (nodes[nodes.length - 1].x - nodes[0].x);
    lineNode.attr("stroke-dasharray", len).attr("stroke-dashoffset", len);
    gsap.to(lineNode.node(), { strokeDashoffset: 0, duration: 1.5, ease: "power2.out", scrollTrigger: { trigger: mount, start: "top 82%" } });
  }
  const rScale = d3.scaleSqrt().domain([0, d3.max(nodes, (n) => n.value)]).range([9, MOBILE ? 22 : 30]);
  const g = svg.append("g").selectAll("g").data(nodes).join("g").attr("transform", (n) => `translate(${(width * n.x).toFixed(1)},${cy})`);
  g.append("circle").attr("r", (n) => rScale(n.value)).attr("fill", "rgba(255,181,69,0.14)").attr("stroke", "#ffb545").attr("stroke-width", 1.4);
  g.append("circle").attr("r", 2).attr("fill", "#ffb545");
  g.append("text").attr("y", (n) => -rScale(n.value) - 15).attr("text-anchor", "middle").attr("font-size", MOBILE ? 9.5 : 10.5).attr("fill", "#8b96ab").text((n) => n.label);
  g.append("text").attr("y", (n) => rScale(n.value) + 20).attr("text-anchor", "middle").attr("font-size", 13).attr("font-weight", 600).attr("fill", "#e9eef7").text((n) => choFromMillion(n.value));
  g.append("text").attr("y", (n) => rScale(n.value) + 35).attr("text-anchor", "middle").attr("font-size", 9.5).attr("fill", "#4c5a72").text((n) => n.sub || "");

  const ledeParts = [];
  if (prevYear != null && Number.isFinite(prevInitial)) ledeParts.push(`${prevYear}年度当初予算${choFromMillion(prevInitial)}を起点に`);
  if (Number.isFinite(requestTotal)) ledeParts.push(`8月の概算要求${choFromMillion(requestTotal)}${Number.isFinite(requestYoubou) ? `（うち要望額${choFromMillion(requestYoubou)}）` : ""}を経て`);
  setText("#cycle-lede", `${latestYear}年度は${ledeParts.length ? `${ledeParts.join("、")}、` : ""}${choFromMillion(initial)}で成立。`);
  setText("#cycle-source", `出典: ${block.source?.title || ""}。概算要求額は最新年度の概算要求段階の暫定値（要求額＋要望額）で、その後の予算編成過程で増減しうる。内閣府が公開する予算資料のPDFは公開後数年で削除されるため、取得できた時点の値を年度ごとに保存している。補正予算のデータは未収載のため、この章はすべて当初予算ベース。`);
}

/* ============================================================ 02 projects */

function renderProjects(gov) {
  const canvas = $("#projects-canvas");
  const stage = $("#star-stage");
  const block = gov?.projects;
  const networkBlock = gov?.network;
  if (!canvas || !stage || !block || block.status !== "ok") {
    if (stage) stage.innerHTML = '<p class="data-empty">事業データを取得できませんでした。</p>';
    return;
  }
  const allProjects = block.projects || [];
  if (!allProjects.length) { stage.innerHTML = '<p class="data-empty">事業データがありません。</p>'; return; }

  const top8 = topKeysByTotal(allProjects, (p) => p.ministry, (p) => p.st_budget, 8);
  const groups = [...top8, "その他"];
  const groupOf = (p) => (top8.includes(p.ministry) ? p.ministry : "その他");
  const payeesByProject = new Map((networkBlock?.status === "ok" ? networkBlock.project_payees || [] : []).map((p) => [p.project_id, p]));

  const dataset = MOBILE ? allProjects.slice().sort((a, b) => (b.st_budget || 0) - (a.st_budget || 0)).slice(0, 500) : allProjects;
  const rScale = d3.scaleSqrt().domain([0, d3.max(allProjects, (p) => p.st_budget || 0) || 1]).range([1.1, MOBILE ? 14 : 24]);
  const points = dataset.map((p) => ({ ...p, group: groupOf(p), r: Math.max(1.1, rScale(p.st_budget || 0)) }));

  let ctx = null, width = 0, height = 0;
  let quad = null;
  let centerX = {};
  const margin = { left: 22, right: 22, top: 28, bottom: 8 };
  let filterMinistry = "all";
  let query = "";
  let hovered = null;
  let selected = null;

  function matches(p) {
    if (filterMinistry !== "all" && p.group !== filterMinistry) return false;
    if (query && !(p.name || "").includes(query)) return false;
    return true;
  }

  function draw() {
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    if (!MOBILE) {
      ctx.font = '500 10px "IBM Plex Mono", monospace';
      ctx.textAlign = "center";
      for (const g of groups) {
        ctx.fillStyle = filterMinistry === "all" || filterMinistry === g ? "#8b96ab" : "#333c4d";
        ctx.fillText(g, centerX[g], 16);
      }
    }
    for (const p of points) {
      const active = matches(p);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = ministryColor(p.group);
      ctx.globalAlpha = !active ? 0.05 : (p === hovered || p === selected ? 1 : 0.8);
      ctx.fill();
      if (p === selected) {
        ctx.lineWidth = 1.6;
        ctx.strokeStyle = "#ffb545";
        ctx.globalAlpha = 1;
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = "left";
  }

  function layout() {
    const fit = fitCanvas(canvas);
    ctx = fit.ctx; width = fit.width; height = fit.height;
    const colWidth = (width - margin.left - margin.right) / groups.length;
    groups.forEach((g, i) => { centerX[g] = margin.left + colWidth * (i + 0.5); });
    points.forEach((p) => {
      p.x = centerX[p.group] + (Math.random() - 0.5) * 4;
      p.y = margin.top + 20 + Math.random() * (height - margin.top - margin.bottom - 20);
    });
    const sim = d3.forceSimulation(points)
      .force("x", d3.forceX((p) => centerX[p.group]).strength(0.7))
      .force("y", d3.forceY(height / 2 + 10).strength(0.02))
      .force("collide", d3.forceCollide((p) => p.r + 0.6).strength(0.82).iterations(1))
      .stop();
    const ticks = MOBILE ? 80 : 130;
    for (let i = 0; i < ticks; i += 1) sim.tick();
    points.forEach((p) => {
      p.x = Math.max(margin.left + p.r, Math.min(width - margin.right - p.r, p.x));
      p.y = Math.max(margin.top + 20 + p.r, Math.min(height - margin.bottom - p.r, p.y));
    });
    quad = d3.quadtree().x((p) => p.x).y((p) => p.y).addAll(points);
    draw();
  }

  function hitTest(mx, my) {
    if (!quad) return null;
    const found = quad.find(mx, my, 36);
    if (!found) return null;
    return Math.hypot(found.x - mx, found.y - my) <= found.r + 4 ? found : null;
  }

  const hover = hoverBox("#projects-hover");
  canvas.addEventListener("pointermove", (event) => {
    const rect = canvas.getBoundingClientRect();
    const mx = event.clientX - rect.left, my = event.clientY - rect.top;
    const hit = hitTest(mx, my);
    if (hit !== hovered) { hovered = hit; draw(); }
    if (hit) {
      hover.show(`<b>${escapeHtml(hit.name)}</b><br>${escapeHtml(hit.ministry)}<br>${amountFmt(hit.st_budget)}`, event, stage);
      canvas.style.cursor = "pointer";
    } else {
      hover.hide();
      canvas.style.cursor = "default";
    }
  });
  canvas.addEventListener("pointerleave", () => { hovered = null; hover.hide(); draw(); });
  canvas.addEventListener("click", (event) => {
    const rect = canvas.getBoundingClientRect();
    const mx = event.clientX - rect.left, my = event.clientY - rect.top;
    const hit = hitTest(mx, my);
    if (hit) { selected = hit; draw(); showCard(hit); }
  });

  function showCard(p) {
    const card = $("#projects-card");
    if (!card) return;
    const payeeEntry = payeesByProject.get(p.id);
    let payeeHtml = "";
    if (payeeEntry && payeeEntry.payees?.length) {
      payeeHtml = `<div class="proj-card-payees">
        <h5>支出先 上位（FY2024実績・当初予算案とは年度が異なる点に注意）</h5>
        ${payeeEntry.payees.slice(0, 5).map((pay) => `<div class="proj-card-row"><span>${escapeHtml(pay.name)}</span><b>${amountFmt(pay.total)}</b></div>`).join("")}
      </div>`;
    }
    card.innerHTML = `
      <div class="proj-card-head">
        <span class="proj-card-tag" style="border-color:${ministryColor(p.group)};color:${ministryColor(p.group)}">${escapeHtml(p.ministry)}</span>
        <h4>${escapeHtml(p.name)}</h4>
      </div>
      <div class="proj-card-amount">${amountFmt(p.st_budget)}<small>うち科技予算額（R8当初予算案）</small></div>
      ${payeeHtml}`;
  }

  const filterMount = $("#projects-filter");
  if (filterMount) {
    const allBtn = filterMount.querySelector('[data-ministry="all"]');
    const btnHtml = groups.map((g) => `<button type="button" data-ministry="${escapeHtml(g)}">${escapeHtml(g)}</button>`).join("");
    if (allBtn) allBtn.insertAdjacentHTML("afterend", btnHtml);
    filterMount.addEventListener("click", (event) => {
      const btn = event.target.closest("button[data-ministry]");
      if (!btn) return;
      filterMinistry = btn.dataset.ministry;
      filterMount.querySelectorAll("button[data-ministry]").forEach((b) => b.classList.toggle("is-active", b === btn));
      draw();
    });
  }
  const searchInput = $("#projects-search");
  if (searchInput) {
    searchInput.addEventListener("input", () => { query = searchInput.value.trim(); draw(); });
  }

  layout();
  let resizeTimer = null;
  window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(layout, 200); }, { passive: true });

  const topProject = allProjects.slice().sort((a, b) => (b.st_budget || 0) - (a.st_budget || 0))[0];
  const totalInitial = gov?.budget_series?.status === "ok" ? gov.budget_series.initial[gov.budget_series.initial.length - 1] : null;
  const coveragePct = totalInitial ? ((block.total_st_budget / totalInitial) * 100).toFixed(1) : null;
  const excludedCount = block.projects_excluded?.length;
  setText("#projects-count-label", `${fmtInt(block.count)}事業 / ${choFromMillion(block.total_st_budget)}`);
  setText("#projects-lede", `${block.fiscal_year}年度当初予算案、行政事業レビューシート対象と判定された${fmtInt(block.count)}事業（対象外と判定された${excludedCount ? fmtInt(excludedCount) : "他"}事業は含まない）。点1つが1事業、大きさは科技予算額。最大は${topProject ? topProject.name : ""}（${topProject ? amountFmt(topProject.st_budget) : ""}）。${MOBILE ? "表示は上位500事業。" : ""}`);
  setText("#projects-source", `出典: ${block.source?.title || ""}。事業別の科技予算額の合計は${choFromMillion(block.total_st_budget)}${coveragePct ? `で、当初予算総額の${coveragePct}%にあたる` : ""}。科技予算額は事業費の一部（内数）であることが多く、事業費の総額そのものではない。対象外と判定された事業はここには含まれていない。`);
}

/* ============================================================ 03 network */

function renderNetwork(gov) {
  const canvas = $("#network-canvas");
  const stage = $("#network-stage");
  const block = gov?.network;
  if (!canvas || !stage || !block || block.status !== "ok") {
    if (stage) stage.innerHTML = '<p class="data-empty">資金の行き先データを取得できませんでした。</p>';
    return;
  }
  const links = block.links || [];
  const recipients = block.recipients || [];
  const recipientsOther = block.recipients_other || [];
  if (!links.length) { stage.innerHTML = '<p class="data-empty">データがありません。</p>'; return; }

  const topMinistries = topKeysByTotal(links, (l) => l.ministry, (l) => l.total, 8);
  const sourceOf = (l) => (topMinistries.includes(l.ministry) ? l.ministry : "その他府省");
  const recipientKind = new Map(recipients.map((r) => [r.name, r.kind || "不明"]));
  const nRecipients = MOBILE ? 14 : 25;
  const topRecipients = new Set(topKeysByTotal(links, (l) => l.recipient, (l) => l.total, nRecipients));
  const targetOf = (l) => (topRecipients.has(l.recipient) ? l.recipient : `その他（${recipientKind.get(l.recipient) || "不明"}）`);

  const agg = new Map();
  for (const l of links) {
    const key = `${sourceOf(l)} ${targetOf(l)}`;
    agg.set(key, (agg.get(key) || 0) + (l.total || 0));
  }
  const flatLinks = [...agg.entries()].map(([key, value]) => {
    const [source, target] = key.split(" ");
    return { source, target, value };
  }).filter((l) => l.value > 0);

  const sourceTotals = new Map();
  const targetTotals = new Map();
  for (const l of flatLinks) {
    sourceTotals.set(l.source, (sourceTotals.get(l.source) || 0) + l.value);
    targetTotals.set(l.target, (targetTotals.get(l.target) || 0) + l.value);
  }
  const sourceNames = [...sourceTotals.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
  const targetNames = [...targetTotals.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);

  const shortLabel = (name) => name.replace(/^(国立研究開発法人|独立行政法人|国立大学法人|一般社団法人|一般財団法人|公益財団法人)/, "");

  const detail = $("#network-detail");
  let ctx = null, width = 0, height = 0;
  let sourceNodes = [], targetNodes = [], linkGeo = [];
  let focus = null;

  function place(names, totals, x, gap, top, bottom) {
    const total = d3.sum(names, (n) => totals.get(n) || 0);
    const avail = Math.max(1, bottom - top - gap * Math.max(0, names.length - 1));
    const scale = total > 0 ? avail / total : 0;
    let cursor = top;
    return names.map((name) => {
      const t = totals.get(name) || 0;
      const h = Math.max(MOBILE ? 2.4 : 3.2, t * scale);
      const node = { name, x, y0: cursor, y1: cursor + h, total: t };
      cursor += h + gap;
      return node;
    });
  }

  function draw() {
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    for (const link of linkGeo) {
      const active = !focus || link.source === focus || link.target === focus;
      ctx.beginPath();
      const cx1 = link.x0 + (link.x1 - link.x0) * 0.42, cx2 = link.x0 + (link.x1 - link.x0) * 0.58;
      ctx.moveTo(link.x0, link.y0);
      ctx.bezierCurveTo(cx1, link.y0, cx2, link.y1, link.x1, link.y1);
      if (focus && active) {
        ctx.strokeStyle = "rgba(255,181,69,0.6)";
        ctx.shadowColor = "rgba(255,181,69,0.65)";
        ctx.shadowBlur = 7;
      } else {
        ctx.strokeStyle = hexToRgba(ministryColor(link.source), active ? 0.22 : 0.035);
        ctx.shadowBlur = 0;
      }
      ctx.lineWidth = link.width;
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
    ctx.font = '500 10.5px "IBM Plex Mono", monospace';
    for (const node of [...sourceNodes, ...targetNodes]) {
      const isSource = node.x < width / 2;
      const active = !focus || node.name === focus;
      ctx.globalAlpha = active ? 1 : 0.3;
      ctx.fillStyle = isSource ? ministryColor(node.name) : "#7d87a0";
      ctx.fillRect(node.x - (isSource ? 4 : 0), node.y0, 4, Math.max(1, node.y1 - node.y0));
      if (node.y1 - node.y0 > (MOBILE ? 9 : 6.5)) {
        ctx.fillStyle = active ? "#e9eef7" : "#4c5a72";
        ctx.textAlign = isSource ? "right" : "left";
        ctx.fillText(shortLabel(node.name).slice(0, MOBILE ? 9 : 22), node.x + (isSource ? -9 : 9), (node.y0 + node.y1) / 2 + 3.5);
      }
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = "left";
  }

  function layout() {
    const fit = fitCanvas(canvas);
    ctx = fit.ctx; width = fit.width; height = fit.height;
    const leftX = width * (MOBILE ? 0.18 : 0.2);
    const rightX = width * (MOBILE ? 0.82 : 0.78);
    const top = 20, bottom = height - 20;
    sourceNodes = place(sourceNames, sourceTotals, leftX, MOBILE ? 5 : 7, top, bottom);
    targetNodes = place(targetNames, targetTotals, rightX, MOBILE ? 2 : 3, top, bottom);
    const sOffset = {}, tOffset = {};
    linkGeo = flatLinks.map((l) => {
      const s = sourceNodes.find((n) => n.name === l.source);
      const t = targetNodes.find((n) => n.name === l.target);
      if (!s || !t) return null;
      const sh = s.total ? (l.value / s.total) * (s.y1 - s.y0) : 0;
      const th = t.total ? (l.value / t.total) * (t.y1 - t.y0) : 0;
      const sy = s.y0 + (sOffset[l.source] = (sOffset[l.source] || 0)) + sh / 2;
      sOffset[l.source] += sh;
      const ty = t.y0 + (tOffset[l.target] = (tOffset[l.target] || 0)) + th / 2;
      tOffset[l.target] += th;
      return { ...l, x0: leftX + 6, y0: sy, x1: rightX - 6, y1: ty, width: Math.max(0.6, sh * 0.92) };
    }).filter(Boolean);
    draw();
  }

  canvas.addEventListener("pointermove", (event) => {
    const rect = canvas.getBoundingClientRect();
    const mx = event.clientX - rect.left, my = event.clientY - rect.top;
    const hit = [...sourceNodes, ...targetNodes].find((n) => Math.abs(mx - n.x) < 60 && my >= n.y0 - 5 && my <= n.y1 + 5);
    focus = hit ? hit.name : null;
    draw();
    if (detail) detail.innerHTML = hit ? `<b>${escapeHtml(hit.name)}</b> — ${amountFmt(hit.total)}` : "支出先に触れると、内訳を表示";
  });
  canvas.addEventListener("pointerleave", () => { focus = null; draw(); if (detail) detail.innerHTML = "支出先に触れると、内訳を表示"; });

  layout();
  let resizeTimer = null;
  window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(layout, 200); }, { passive: true });

  const identifiableTotal = d3.sum(recipients, (r) => r.total || 0) + d3.sum(recipientsOther, (r) => r.total || 0);
  const topTarget = targetNames[0];
  setText("#network-lede", `${block.fiscal_year}年度実績で識別できた支出先への支出は合計${choFromMillion(identifiableTotal || d3.sum(flatLinks, (l) => l.value))}。最大の支出先は${topTarget ? shortLabel(topTarget) : ""}（${choFromMillion(targetTotals.get(topTarget) || 0)}）。`);
  const unidentifiable = block.unidentifiable_total;
  setText("#network-source", `出典: ${block.source?.title || ""}。府省庁別の当初予算事業リストと、行政事業レビューの支出実績記録を事業名で突き合わせて作成。名称の表記ゆれ等により一部の事業は突き合わせできておらず、支出全体を完全に捕捉しているわけではない。図は金額の大きい上位のリンクのみを描画しており、識別できた支出先の合計より少ない額になる。「その他」等の集計区分、匿名化ラベル、会計区分・受給者クラスなど、実在する単一の法人や個人を指さない支出先は集計から除外し${Number.isFinite(unidentifiable) ? `（合計${choFromMillion(unidentifiable)}）` : ""}、識別できた支出先のみを扱っている。支出先の残りは法人の種別ごとに「その他」へ集約。`);
}

/* ============================================================ 04 contracts */

function renderContracts(gov) {
  const block = gov?.contracts;
  const gaugeMount = $("#contracts-gauges");
  if (!gaugeMount || !block || block.status !== "ok" || !block.science_tech || !block.government_wide) {
    if (gaugeMount) gaugeMount.innerHTML = '<p class="data-empty">契約データを取得できませんでした。</p>';
    return;
  }
  const st = block.science_tech, gw = block.government_wide;

  const gaugeHtml = (label, rate, nSingle, nEligible, color) => {
    const pct = Number.isFinite(rate) ? rate * 100 : null;
    return `
    <div class="gauge">
      <div class="gauge-label">${escapeHtml(label)}</div>
      <div class="gauge-track"><i style="width:${pct != null ? pct.toFixed(1) : 0}%;background:${color}"></i></div>
      <div class="gauge-value" style="color:${color}">${pct != null ? `${pct.toFixed(1)}%` : "—"}</div>
      <div class="gauge-note">一者応札 ${Number.isFinite(nSingle) ? fmtInt(nSingle) : "—"} / ${Number.isFinite(nEligible) ? fmtInt(nEligible) : "—"}件（入札者数1以上の契約）</div>
    </div>`;
  };
  gaugeMount.innerHTML = gaugeHtml("科学技術関連契約", st.single_bidder_rate, st.single_bidder, st.bidder_eligible, "#ffb545")
    + gaugeHtml("政府契約 全体", gw.single_bidder_rate, gw.single_bidder, gw.bidder_eligible, "#a7b4cc");

  if (!REDUCED && gsap) {
    gaugeMount.querySelectorAll(".gauge-track i").forEach((bar) => {
      const target = bar.style.width;
      gsap.fromTo(bar, { width: "0%" }, { width: target, duration: 1.2, ease: "power3.out", scrollTrigger: { trigger: gaugeMount, start: "top 85%" } });
    });
    gaugeMount.querySelectorAll(".gauge-value").forEach((node) => {
      const target = parseFloat(node.textContent);
      if (!Number.isFinite(target)) return;
      const state = { v: 0 };
      gsap.to(state, { v: target, duration: 1.3, ease: "power3.out", onUpdate: () => { node.textContent = `${state.v.toFixed(1)}%`; }, scrollTrigger: { trigger: gaugeMount, start: "top 85%" } });
    });
  }

  /* ---- B: 落札率の分布（合計件数比のオーバーレイ） ---- */
  const histMount = $("#contracts-histogram");
  const stHist = st.rate_histogram || {};
  const gwHist = gw.rate_histogram || {};
  if (histMount && (Object.keys(stHist).length || Object.keys(gwHist).length)) {
    histMount.innerHTML = "";
    const parseBucket = (key) => Number(key.split("-")[0]);
    const buildSeries = (bins) => {
      const total = d3.sum(Object.values(bins));
      return Object.entries(bins).map(([k, v]) => ({ x: parseBucket(k), share: total ? (v / total) * 100 : 0 })).sort((a, b) => a.x - b.x);
    };
    const stSeries = buildSeries(stHist);
    const gwSeries = buildSeries(gwHist);
    const width = histMount.clientWidth || 1000, height = Math.max(260, Math.min(340, width * 0.3));
    const margin = { top: 20, right: 24, bottom: 30, left: 44 };
    const x = d3.scaleLinear().domain([0, 1]).range([margin.left, width - margin.right]);
    const y = d3.scaleLinear().domain([0, Math.max(d3.max(stSeries, (d) => d.share) || 0, d3.max(gwSeries, (d) => d.share) || 0) * 1.15]).range([height - margin.bottom, margin.top]);
    const svg = d3.select(histMount).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img").attr("aria-label", "落札率の分布");
    baseAxis(svg.append("g").attr("class", "axis").attr("transform", `translate(${margin.left},0)`)
      .call(d3.axisLeft(y).ticks(4).tickFormat((v) => `${v.toFixed(0)}%`).tickSize(-(width - margin.left - margin.right))));
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - margin.bottom})`)
      .call(d3.axisBottom(x).ticks(5).tickFormat((v) => `${Math.round(v * 100)}%`)).select(".domain").attr("stroke", "#1c2839");
    const areaGen = d3.area().x((d) => x(d.x)).y0(y(0)).y1((d) => y(d.share)).curve(d3.curveStepAfter);
    svg.append("path").datum(gwSeries).attr("d", areaGen).attr("fill", "#a7b4cc").attr("opacity", 0.22).attr("stroke", "#a7b4cc").attr("stroke-width", 1);
    svg.append("path").datum(stSeries).attr("d", areaGen).attr("fill", "#ffb545").attr("opacity", 0.28).attr("stroke", "#ffb545").attr("stroke-width", 1.4);
    const legend = svg.append("g").attr("transform", `translate(${margin.left + 8},${margin.top})`);
    [["科学技術関連", "#ffb545"], ["政府全体", "#a7b4cc"]].forEach(([label, color], i) => {
      legend.append("rect").attr("x", 0).attr("y", i * 15).attr("width", 9).attr("height", 9).attr("fill", color);
      legend.append("text").attr("x", 13).attr("y", i * 15 + 8).attr("font-size", 10).attr("fill", "#8b96ab").text(label);
    });
    setText("#contracts-hist-source", "縦軸はそれぞれの合計契約件数に対する割合。落札率＝落札金額÷予定価格。横軸0.025刻み。0や100を超える異常値は除外。");
  } else if (histMount) {
    histMount.innerHTML = '<p class="data-empty">落札率データを取得できませんでした。</p>';
  }

  /* ---- C: 府省庁別ドットプロット ---- */
  const minMount = $("#contracts-ministry");
  const byMinistry = st.by_ministry || {};
  if (minMount && Object.keys(byMinistry).length) {
    const rows = Object.entries(byMinistry)
      .filter(([, v]) => Number.isFinite(v?.single_bidder_rate))
      .map(([name, v]) => ({ label: name, value: v.single_bidder_rate * 100, sub: `n=${fmtInt(v.n_eligible ?? 0)}` }))
      .sort((a, b) => b.value - a.value);
    if (rows.length) rankRows(minMount, rows, { max: 100, valueFmt: (v) => `${v.toFixed(1)}%`, barColor: "#ffb545" });
    else minMount.innerHTML = '<p class="data-empty">府省庁別データを取得できませんでした。</p>';
  } else if (minMount) {
    minMount.innerHTML = '<p class="data-empty">府省庁別データを取得できませんでした。</p>';
  }

  const stRatePct = Number.isFinite(st.single_bidder_rate) ? `${(st.single_bidder_rate * 100).toFixed(1)}%` : "—";
  const gwRatePct = Number.isFinite(gw.single_bidder_rate) ? `${(gw.single_bidder_rate * 100).toFixed(1)}%` : "—";
  setText("#contracts-lede", `科学技術関連契約のうち、入札者数1以上の契約における一者応札の割合は${stRatePct}（政府契約全体は${gwRatePct}）。`);
  setText("#contracts-source", `出典: ${block.source?.title || ""}。分母は入札者数1以上の契約に限る（随意契約（少額）など、そもそも入札が発生しない契約方式は対象外）。科学技術関連契約は、科学技術関係予算の対象事業に紐づく契約を事業名の突き合わせで抽出したもの（一部含み漏れがある）。府省庁別の内訳は主要8府省庁のみを表示。`);
}

/* ============================================================ 05 books */

function renderBooks(gov) {
  const block = gov?.ministry_finance;
  const bsMount = $("#books-bs");
  const assets = block?.assets || [];
  const scale = block?.asset_total;
  if (!bsMount || !block || block.status !== "ok" || !assets.length || !Number.isFinite(scale) || scale <= 0) {
    if (bsMount) bsMount.innerHTML = '<p class="data-empty">財務データを取得できませんでした。</p>';
    return;
  }

  /* ---- A: 貸借対照表（資産配列は親子階層混在のため上位科目のみで積み上げる） ---- */
  const byLabel = new Map(assets.map((a) => [a.label, a.amount]));
  const shutsu = byLabel.get("出資金") || 0;
  const kashitsuke = byLabel.get("貸付金") || 0;
  const yukei = byLabel.get("有形固定資産") || 0;
  const nestedLabels = new Set(["国有財産（公共用財産を除く）", "土地", "建物", "工作物", "立木竹", "物品", "出資金", "貸付金", "有形固定資産"]);
  const otherAssets = assets.filter((a) => !nestedLabels.has(a.label)).reduce((s, a) => s + (a.amount || 0), 0);
  const assetParts = [
    { label: "出資金（国立大学・独立行政法人等への出資）", value: shutsu, color: "#ffb545" },
    { label: "貸付金", value: kashitsuke, color: "#4fd8ff" },
    { label: "有形固定資産（国有財産・物品等を含む）", value: yukei, color: "#7b86a0" },
    { label: "その他資産", value: otherAssets, color: "#4c5a72" },
  ];
  const liabParts = [
    { label: "負債", value: block.liability_total || 0, color: "#4c5a72" },
    { label: "純資産", value: block.net_worth || 0, color: "#ffb545" },
  ];
  const bsBar = (parts, title) => `
    <div class="bs-row">
      <span class="bs-row-label">${escapeHtml(title)}</span>
      <div class="cmp-stack" style="height:34px">${parts.map((p) => `<i style="width:${Math.max(0, (p.value / scale) * 100).toFixed(2)}%;background:${p.color}" title="${escapeHtml(p.label)} ${okuFromMillion(p.value)}">${p.value / scale >= 0.09 ? `<em>${Math.round((p.value / scale) * 100)}%</em>` : ""}</i>`).join("")}</div>
    </div>`;
  bsMount.innerHTML = bsBar(assetParts, "資産") + bsBar(liabParts, "負債・純資産")
    + `<div class="bs-legend">${[...assetParts, ...liabParts].map((p) => `<span><i style="background:${p.color}"></i>${escapeHtml(p.label)} ${choFromMillion(p.value)}</span>`).join("")}</div>`;
  animateStackBars(bsMount);

  setText("#books-bs-source", `出典: ${block.source?.title || ""}（${block.fiscal_year_label}）。令和6年度決算の単年度スナップショットで、年度ごとに科目の並びが変わるため複数年度の時系列化はしていない。資産・負債は金額の大きい科目を中心に掲載。原資料の資産科目は親子階層で掲載されている（有形固定資産＝国有財産＋物品、国有財産＝土地＋建物＋工作物＋立木竹）ため、二重計上を避けて上位科目のみを積み上げている。`);

  /* ---- B: 業務費用計算書（内訳はフラットな22科目・合算不要） ---- */
  const costsMount = $("#books-costs");
  const costs = block.costs || [];
  const totalCost = block.total_cost;
  const hasCosts = costs.length && Number.isFinite(totalCost) && totalCost > 0;
  if (costsMount && hasCosts) {
    const threshold = totalCost * 0.01;
    const big = costs.filter((c) => c.amount >= threshold).sort((a, b) => b.amount - a.amount);
    const small = costs.filter((c) => c.amount < threshold);
    const smallSum = small.reduce((s, c) => s + c.amount, 0);
    const rows = [...big, { label: `その他（${small.length}科目）`, amount: smallSum }]
      .map((r) => ({ label: r.label, value: r.amount, sub: `${((r.amount / totalCost) * 100).toFixed(1)}%` }));
    rankRows(costsMount, rows, { valueFmt: okuFromMillion, barColor: "#4fd8ff" });
    setText("#books-costs-source", `出典: ${block.source?.title || ""}（${block.fiscal_year_label}）。本年度業務費用合計 ${choFromMillion(totalCost)} の内訳。金額が全体の1%未満の科目は「その他」に合算。`);
  } else if (costsMount) {
    costsMount.innerHTML = '<p class="data-empty">業務費用データを取得できませんでした。</p>';
    setText("#books-costs-source", "出典を取得できませんでした。");
  }

  /* ---- C: フルコスト（府省庁横断・上位20件） ---- */
  const fcBlock = gov?.fullcost;
  const fcMount = $("#books-fullcost");
  if (fcMount && fcBlock?.status === "ok" && fcBlock.items?.length) {
    const rows = fcBlock.items.filter((r) => Number.isFinite(r.fullcost)).slice().sort((a, b) => b.fullcost - a.fullcost)
      .map((r) => ({ label: `${r.ministry}・${r.name}`, value: r.fullcost }));
    rankRows(fcMount, rows, { valueFmt: okuFromMillion, barColor: "#7b86a0" });
    setText("#books-fullcost-source", `出典: ${fcBlock.source?.title || ""}（${fcBlock.fiscal_year}年度）。府省庁横断のフルコスト情報データベースのうち、研究・科学・宇宙・原子力・大学・奨学など特定のキーワードを事業名に含む事業の上位20件を抽出。「フルコスト」が指す範囲は事業類型で異なる点に注意: 独立行政法人運営費交付金型の事業（JAXA・JST・理化学研究所等）は交付金総額に近い規模になる一方、補助金・給付金型の事業（科研費等）は実施省庁側の直接管理コストのみを表し、実際の交付総額（科研費は年間2,000億円超）よりはるかに小さく見える。事業類型をまたいだ単純比較はしないこと。`);
  } else if (fcMount) {
    fcMount.innerHTML = '<p class="data-empty">フルコストデータを取得できませんでした。</p>';
  }

  setText("#books-lede", `${block.fiscal_year_label}、文部科学省の資産${choFromMillion(scale)}のうち${fmtPct((shutsu / scale) * 100)}が出資金（国立大学法人・独立行政法人への出資）。${hasCosts ? `業務費用は${choFromMillion(totalCost)}。` : ""}`);
}

/* ============================================================= sources */

function renderSourcesTable(gov) {
  const mount = $("#sources-table");
  if (!mount) return;
  const rows = [
    { block: gov?.budget_series, label: "予算総額（当初予算・概算要求）", fy: "2023–2026年度" },
    { block: gov?.budget_ministry, label: "府省庁別予算", fy: "2023–2026年度" },
    { block: gov?.projects, label: "事業別 科技予算額", fy: gov?.projects?.fiscal_year ? `${gov.projects.fiscal_year}年度` : "" },
    { block: gov?.network, label: "支出先（法人別）", fy: gov?.network?.fiscal_year ? `${gov.network.fiscal_year}年度` : "" },
    { block: gov?.contracts, label: "契約の入札・落札情報", fy: gov?.contracts?.fiscal_year ? `${gov.contracts.fiscal_year}年度` : "" },
    { block: gov?.ministry_finance, label: "文部科学省 財務書類", fy: gov?.ministry_finance?.fiscal_year_label || "" },
    { block: gov?.fullcost, label: "事業別フルコスト", fy: gov?.fullcost?.fiscal_year ? `${gov.fullcost.fiscal_year}年度` : "" },
  ].filter((r) => r.block);
  mount.innerHTML = `<table class="cmp-table gov-sources-table">
    <thead><tr><td>データ</td><td>年度</td><td>出典</td><td>状態</td></tr></thead>
    <tbody>${rows.map((r) => `
      <tr>
        <th>${escapeHtml(r.label)}</th>
        <td>${escapeHtml(r.fy || "—")}</td>
        <td>${r.block.source?.url ? `<a href="${escapeHtml(safeUrl(r.block.source.url))}" target="_blank" rel="noopener noreferrer">${escapeHtml(r.block.source?.title || "")}</a>` : escapeHtml(r.block.source?.title || "—")}</td>
        <td style="color:${r.block.status === "ok" ? "var(--good)" : "var(--faint)"}">${r.block.status === "ok" ? "接続中" : "未接続"}</td>
      </tr>`).join("")}</tbody>
  </table>`;
}

/* ================================================================= boot */

async function init() {
  bootFooter();
  initRail();
  let gov = null;
  try {
    gov = await fetchJson("data/gov.json");
  } catch (error) {
    console.error(error);
  }
  if (!gov) {
    setText("#header-status", "行政データを取得できません");
    return;
  }
  $("#header-status-dot")?.classList.add("is-live");
  const blockKeys = ["budget_series", "budget_ministry", "projects", "network", "contracts", "ministry_finance", "fullcost"];
  const blocksOk = blockKeys.filter((k) => gov[k]?.status === "ok").length;
  const totalYen = gov.budget_series?.status === "ok" ? choFromMillion(gov.budget_series.initial[gov.budget_series.initial.length - 1]) : "";
  setText("#header-status", `観測中 — 科学技術関係予算${totalYen} / ${blocksOk}系統の公開データ`);

  safeCall("renderTotal", () => renderTotal(gov));
  safeCall("renderCycle", () => renderCycle(gov));
  safeCall("renderProjects", () => renderProjects(gov));
  safeCall("renderNetwork", () => renderNetwork(gov));
  safeCall("renderContracts", () => renderContracts(gov));
  safeCall("renderBooks", () => renderBooks(gov));
  safeCall("renderSourcesTable", () => renderSourcesTable(gov));

  const entries = blockKeys.map((k) => blockEntry(gov[k], k)).filter(Boolean);
  renderLedgerEntries(entries);
}

init().catch((error) => {
  console.error(error);
  setText("#header-status", "行政データを取得できません");
});
