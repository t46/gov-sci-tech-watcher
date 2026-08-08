/* SCIENCE SIGNAL / HUB — 観測室トップ。obs-core.js の後に読み込む。 */
"use strict";

function initHeroCanvas() {
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
}

function ticker(selector, target, format) {
  const node = $(selector);
  if (!node || target == null) return;
  if (REDUCED || !gsap) { node.textContent = format(target); return; }
  const state = { v: 0 };
  gsap.to(state, {
    v: target, duration: 1.9, ease: "power3.out", delay: 0.3,
    onUpdate: () => { node.textContent = format(state.v); },
    onComplete: () => { node.textContent = format(target); },
  });
}

const sparkSvg = (values, color) => {
  if (!values || values.length < 2) return "";
  const w = 150, h = 34, pad = 3;
  const x = d3.scaleLinear().domain(d3.extent(values, ([yr]) => yr)).range([pad, w - pad]);
  const y = d3.scaleLinear().domain([0, d3.max(values, ([, v]) => v)]).range([h - pad, pad]);
  const d = values.map(([yr, v], i) => `${i ? "L" : "M"}${x(yr).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const last = values[values.length - 1];
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="${d}" fill="none" stroke="${color}" stroke-width="1.4" opacity="0.9"/><circle cx="${x(last[0]).toFixed(1)}" cy="${y(last[1]).toFixed(1)}" r="2" fill="${color}"/></svg>`;
};

function renderWindows(indicators, analytics, updates) {
  /* ① 最新情報 */
  const items = [...(updates?.items || [])].sort((a, b) => String(b.published_at || "").localeCompare(String(a.published_at || "")));
  if (items.length) {
    ticker("#win-signals", items.length, (v) => `${Math.round(v)}件`);
    const generated = updates?.generated_at ? new Date(updates.generated_at) : null;
    setText("#win-signals-note", generated && !Number.isNaN(generated.getTime())
      ? `最終巡回 ${new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(generated)}`
      : "政府公式 / 3時間ごと巡回");
    const list = $("#win-signals-list");
    if (list) {
      list.innerHTML = items.slice(0, 3).map((item) => `<p><span>${shortDate(item.published_at)}</span>${escapeHtml(item.title)}</p>`).join("");
    }
  }
  /* ② 人 */
  const phdRows = indicators?.phd_enrollment?.rows || [];
  if (phdRows.length) {
    const last = phdRows[phdRows.length - 1];
    ticker("#win-people", last.total, (v) => `${fmtInt(Math.round(v))}人`);
    setText("#win-people-note", `博士課程入学者 ${last.year}年度 / 学校基本調査`);
    const spark = $("#win-people-spark");
    if (spark) spark.innerHTML = sparkSvg(phdRows.map((r) => [r.year, r.total]), "#4fd8ff");
  }
  /* ③ お金 */
  const funding = indicators?.funding_flow;
  if (funding?.status === "ok") {
    const total = d3.sum(funding.links || [], (l) => l.value);
    const gov = d3.sum((funding.links || []).filter((l) => l.source === "政府"), (l) => l.value);
    ticker("#win-money", total, (v) => fmtCho(v));
    setText("#win-money-note", `研究開発費 ${funding.year_label || ""} / うち政府負担 ${fmtCho(gov)}`);
  }
  /* ④ 研究 */
  const share = seriesMap(indicators?.papers, "share").jp || [];
  if (share.length) {
    const peak = share.reduce((a, b) => (b[1] > a[1] ? b : a));
    const last = lastPoint(share);
    ticker("#win-papers", last[1], (v) => fmtPct(v));
    setText("#win-papers-note", `世界の論文に占める割合 ${last[0]}年 / ピーク${peak[0]}年 ${fmtPct(peak[1])}`);
    const spark = $("#win-papers-spark");
    if (spark) spark.innerHTML = sparkSvg(share, "#ffb545");
  }
}

function renderLedgerAll(indicators, analytics, updates) {
  const ind = indicators || {};
  const entries = [
    blockEntry(ind.gerd_gdp), blockEntry(ind.researchers), blockEntry(ind.phd_enrollment), blockEntry(ind.phd_degrees),
    blockEntry(ind.papers), blockEntry(ind.field_share), blockEntry(ind.funding_flow), blockEntry(ind.oecd_gerd_gdp),
    blockEntry(ind.openalex), blockEntry(ind.estat),
    ...(analytics?.reality?.sources || []).map((s) => ({ title: s.title, url: s.url, status: s.status === "ok" ? "ok" : "unavailable" })),
    ...(updates?.sources || []).map((s) => ({ title: `政府公式フィード — ${s.name}`, url: s.url, status: s.status === "ok" ? "ok" : "unavailable" })),
  ].filter(Boolean);
  renderLedgerEntries(entries);
}

/* ================================================================ boot */

async function init() {
  bootFooter();
  initHeroCanvas();
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
  setText("#header-status", `観測中 — 4分野 / シグナル${fmtInt((updates?.items || []).length)}件`);

  /* hero readouts */
  const gerd = lastPoint(seriesMap(indicators?.oecd_gerd_gdp).jp || seriesMap(indicators?.gerd_gdp).jp);
  const papersSeries = (seriesMap(indicators?.openalex, "by_year").jp || []).filter(([year]) => year < (indicators?.openalex?.partial_year || 9999));
  const papers = lastPoint(papersSeries);
  const phdRows = indicators?.phd_enrollment?.rows || [];
  const phd = phdRows[phdRows.length - 1];
  const signals = updates ? updates.item_count ?? (updates.items || []).length : null;
  if (gerd) { ticker("#ro-gerd", gerd[1], (v) => `${v.toFixed(2)}%`); setText("#ro-gerd-note", `${gerd[0]}年 / OECD`); }
  if (papers) { ticker("#ro-papers", papers[1], (v) => fmtMan(v)); setText("#ro-papers-note", `${papers[0]}年 / OpenAlex`); }
  if (phd) { ticker("#ro-phd", phd.total, (v) => fmtInt(Math.round(v))); setText("#ro-phd-note", `${phd.year}年度 / 学校基本調査`); }
  if (signals != null) { ticker("#ro-signals", signals, (v) => `${Math.round(v)}件`); setText("#ro-signals-note", "政府公式 / 3時間ごと更新"); }

  renderWindows(indicators, analytics, updates);
  renderLedgerAll(indicators, analytics, updates);
}

init().catch((error) => {
  console.error(error);
  setText("#header-status", "観測データを取得できません");
});
