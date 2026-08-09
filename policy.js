/* SCIENCE SIGNAL / POLICY — policy.html を描画。obs-core.js の後に読み込む。 */
"use strict";

function safeCall(name, fn) {
  try { fn(); } catch (error) { console.error(`[policy] ${name} failed`, error); }
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
      node.style.left = `${Math.min(event.clientX - bounds.left + 14, bounds.width - 220)}px`;
      node.style.top = `${event.clientY - bounds.top - 24}px`;
      node.classList.add("is-on");
    },
    hide() { node?.classList.remove("is-on"); },
  };
};

/* "2026-03-27" → "2026年3月27日" */
function fullDateJa(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric" }).format(date);
}

/* target_note の文中から「官民合わせて〇〇兆円 / 対GDP比〇%」の記述を拾う（第5期以降の補助注記用） */
function extractJointTarget(note) {
  if (!note) return null;
  const m = note.match(/官民[^。]*?([\d.]+)\s*(兆円|％|%)/);
  if (!m) return null;
  const unit = m[2] === "%" || m[2] === "％" ? "%" : "兆円";
  return `官民合計目標 ${m[1]}${unit}`;
}

/* target_note の文中から「予算目標は45兆円で…総額60兆円」のような定義拡張の内訳を拾う */
function extractSplitTarget(note) {
  if (!note) return null;
  const m = note.match(/予算目標は([\d.]+)\s*兆円で.*?総額([\d.]+)\s*兆円/);
  if (!m) return null;
  const base = Number(m[1]);
  const total = Number(m[2]);
  if (!Number.isFinite(base) || !Number.isFinite(total) || total <= base) return null;
  return { base, extension: total - base };
}

/* 括弧内の注記（年度・出典など）を弱色チップとして扱えるようテキストとチップに分離 */
function splitChip(text = "") {
  const m = String(text).match(/^(.*?)[（(]([^）)]+)[）)]\s*$/);
  if (!m) return { main: text, chip: "" };
  return { main: m[1].trim(), chip: m[2].trim() };
}

/* ============================================================ 00 plan history timeline */

function initHistoryTimeline(policy) {
  const mount = $("#history-timeline");
  const block = policy?.plans_history;
  if (!mount) return;
  if (!block || block.status !== "ok" || !Array.isArray(block.periods) || !block.periods.length) {
    mount.innerHTML = '<p class="data-empty">基本計画のデータを取得できませんでした。</p>';
    setText("#history-source", "出典を取得できませんでした。");
    return;
  }
  mount.innerHTML = "";
  const rows = block.periods;

  const parseSpan = (fy) => {
    const [start, end] = String(fy).split("-").map(Number);
    return { start, end: Number.isFinite(end) ? end : start };
  };
  const spans = rows.map((r) => parseSpan(r.fiscal_years));
  const minYear = d3.min(spans, (s) => s.start);
  const maxYear = d3.max(spans, (s) => s.end) + 1;
  const maxTarget = d3.max(rows, (r) => r.target_govt_investment_trillion_yen || 0) || 1;

  const width = mount.clientWidth || 1000;
  const height = MOBILE ? 480 : 440;
  const margin = { top: 90, right: 20, bottom: 60, left: 46 };
  const x = d3.scaleLinear().domain([minYear, maxYear]).range([margin.left, width - margin.right]);
  const y = d3.scaleLinear().domain([0, maxTarget * 1.18]).range([height - margin.bottom, margin.top]);

  const svg = d3.select(mount).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img")
    .attr("aria-label", "第1期から第7期までの科学技術基本計画の政府研究開発投資目標額の推移");

  baseAxis(svg.append("g").attr("class", "axis").attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(5).tickFormat((v) => `${v}兆円`).tickSize(-(width - margin.left - margin.right))));
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).ticks(MOBILE ? 4 : 8).tickFormat(d3.format("d"))).select(".domain").attr("stroke", "#1c2839");

  const bands = rows.map((r, i) => {
    const span = spans[i];
    const x0 = x(span.start);
    const x1 = x(span.end + 1);
    const split = extractSplitTarget(r.target_note);
    const nameChanged = i > 0 && rows[i - 1].name !== r.name;
    return { row: r, span, x0, x1, split, nameChanged };
  });

  /* 縞地: 交互のバンド背景 */
  bands.forEach((b, i) => {
    if (i % 2 === 1) {
      svg.insert("rect", ":first-child")
        .attr("x", b.x0).attr("y", margin.top - 34).attr("width", b.x1 - b.x0)
        .attr("height", height - margin.top - margin.bottom + 34)
        .attr("fill", "rgba(255,255,255,0.022)");
    }
  });

  /* 拡張定義の斜線パターン（第7期の +15兆円分） */
  const defs = svg.append("defs");
  defs.append("pattern").attr("id", "policy-hatch").attr("width", 6).attr("height", 6)
    .attr("patternTransform", "rotate(45)").attr("patternUnits", "userSpaceOnUse")
    .append("rect").attr("width", 3).attr("height", 6).attr("fill", "#ffb545").attr("opacity", 0.55);

  const barPad = 0.24;
  const barX = (b) => b.x0 + (b.x1 - b.x0) * barPad;
  const barW = (b) => (b.x1 - b.x0) * (1 - barPad * 2);

  const baseBars = [];
  const extBars = [];
  bands.forEach((b) => {
    const target = b.row.target_govt_investment_trillion_yen || 0;
    const baseValue = b.split ? b.split.base : target;
    const rect = svg.append("rect")
      .attr("x", barX(b)).attr("width", barW(b))
      .attr("y", y(baseValue)).attr("height", y(0) - y(baseValue))
      .attr("fill", "#ffb545").attr("opacity", 0.82);
    baseBars.push(rect);
    if (b.split) {
      const extRect = svg.append("rect")
        .attr("x", barX(b)).attr("width", barW(b))
        .attr("y", y(target)).attr("height", y(baseValue) - y(target))
        .attr("fill", "url(#policy-hatch)").attr("stroke", "#ffb545").attr("stroke-width", 0.8)
        .attr("stroke-dasharray", "2 2").attr("opacity", 0.9);
      extBars.push(extRect);
      svg.append("text").attr("x", barX(b) + barW(b) / 2).attr("y", y(target) - 8)
        .attr("text-anchor", MOBILE ? "end" : "middle").attr("font-size", MOBILE ? 9 : 10).attr("fill", "#ffb545")
        .text(MOBILE ? `+${(target - baseValue).toFixed(0)}兆円(拡張定義)` : `+${(target - baseValue).toFixed(0)}兆円（拡張定義分）`);
    }
  });

  /* 第6期のみ: 実績43.6兆円のオーバーレイ */
  const actualBars = [];
  bands.forEach((b) => {
    const actual = b.row.actual_govt_investment_trillion_yen;
    if (!Number.isFinite(actual)) return;
    const w = barW(b) * 0.42;
    const ax = b.x1 - (b.x1 - b.x0) * barPad - w;
    const rect = svg.append("rect")
      .attr("x", ax).attr("width", w)
      .attr("y", y(actual)).attr("height", y(0) - y(actual))
      .attr("fill", "rgba(79,216,255,0.24)").attr("stroke", "#4fd8ff").attr("stroke-width", 1.4);
    actualBars.push(rect);
    svg.append("text").attr("x", ax + w / 2).attr("y", y(actual) - 8)
      .attr("text-anchor", "middle").attr("font-size", MOBILE ? 9 : 10.5).attr("font-weight", 600).attr("fill", "#4fd8ff")
      .text(`実績 ${actual}兆円`);
  });

  /* 実績の公式集計がない期の注記（x軸目盛りとぶつからないよう少し下げる）。
     狭幅では7本分が重なるため描かず、凡例下の一括注記に委ねる */
  if (!MOBILE) {
    bands.forEach((b) => {
      if (Number.isFinite(b.row.actual_govt_investment_trillion_yen)) return;
      svg.append("text").attr("x", barX(b) + barW(b) / 2).attr("y", y(0) + 32)
        .attr("text-anchor", "middle").attr("font-size", 8.5).attr("fill", "#4c5a72")
        .text("実績の公式集計なし");
    });
  }

  /* 期ラベル・年度・閣議決定日・名称変更注記・honbun_url リンク（ヘッダ帯: 名称変更→期→年度→閣議決定日の順に積む） */
  bands.forEach((b) => {
    const cx = (b.x0 + b.x1) / 2;
    const g = svg.append("g");
    if (b.nameChanged) {
      g.append("text").attr("x", cx).attr("y", 30).attr("text-anchor", "middle")
        .attr("font-size", 8).attr("fill", "#5ad8a1")
        .text("※名称変更");
    }
    g.append("text").attr("x", cx).attr("y", 44).attr("text-anchor", "middle")
      .attr("font-size", MOBILE ? 10 : 11.5).attr("font-weight", 600).attr("fill", "#ffb545")
      .text(MOBILE ? `${b.row.period}期` : `第${b.row.period}期`);
    /* 狭幅では年度・閣議決定日のラベルが隣の期と重なるため省略する（ホバー/タップで表示） */
    if (!MOBILE) {
      g.append("text").attr("x", cx).attr("y", 58).attr("text-anchor", "middle")
        .attr("font-size", 9.5).attr("fill", "#8b96ab")
        .text(`${b.row.fiscal_years}年度`);
      const decisionText = fullDateJa(b.row.cabinet_decision_date);
      g.append("text").attr("x", cx).attr("y", 72).attr("text-anchor", "middle")
        .attr("font-size", 8.5).attr("fill", "#4c5a72")
        .text(decisionText ? `${decisionText} 閣議決定` : "閣議決定日 記録なし");
    }
    const linkUrl = b.row.honbun_url ? safeUrl(b.row.honbun_url) : null;
    if (linkUrl && linkUrl !== "#") {
      g.attr("class", "policy-period-link").on("click", () => window.open(linkUrl, "_blank", "noopener"));
      g.append("rect").attr("x", b.x0).attr("y", 0).attr("width", b.x1 - b.x0).attr("height", height - margin.bottom)
        .attr("fill", "transparent");
    }
  });

  if (!REDUCED && gsap) {
    gsap.from([...baseBars, ...extBars].map((r) => r.node()), { attr: { height: 0 }, y: y(0), duration: 1, ease: "power3.out", stagger: 0.05, scrollTrigger: { trigger: mount, start: "top 80%" } });
    gsap.from(actualBars.map((r) => r.node()), { attr: { height: 0 }, y: y(0), duration: 1, ease: "power3.out", delay: 0.4, scrollTrigger: { trigger: mount, start: "top 80%" } });
  }

  /* 凡例（ヘッダ帯の最上段） */
  const legend = svg.append("g").attr("transform", `translate(${margin.left},4)`);
  const legendItems = [["政府研究開発投資 目標額", "#ffb545", false], ["うち拡張定義分（第7期のみ）", "#ffb545", true], ["実績（公式集計があるもののみ）", "#4fd8ff", false]];
  legendItems.forEach(([label, color, hatch], i) => {
    const lx = MOBILE ? 0 : i * 210;
    const ly = MOBILE ? i * 13 : 0;
    legend.append("rect").attr("x", lx).attr("y", ly).attr("width", 10).attr("height", 10)
      .attr("fill", hatch ? "url(#policy-hatch)" : color).attr("stroke", hatch ? color : "none").attr("stroke-width", 0.8).attr("opacity", 0.85);
    legend.append("text").attr("x", lx + 15).attr("y", ly + 9).attr("font-size", 10).attr("fill", "#8b96ab").text(label);
  });

  /* ホバー: バンド単位で詳細を表示 */
  const hover = hoverBox("#history-hover");
  svg.on("pointermove", (event) => {
    const [mx] = d3.pointer(event);
    const hit = bands.find((b) => mx >= b.x0 && mx <= b.x1);
    if (!hit) { hover.hide(); return; }
    const r = hit.row;
    const joint = r.period >= 5 ? extractJointTarget(r.target_note) : null;
    /* innerHTML に差し込む数値は Number.isFinite で確認したうえで escapeHtml(String(...)) を通す */
    const periodText = Number.isFinite(r.period) ? escapeHtml(String(r.period)) : "—";
    const targetText = Number.isFinite(r.target_govt_investment_trillion_yen)
      ? escapeHtml(`目標 ${String(r.target_govt_investment_trillion_yen)}兆円`)
      : "目標額 不明";
    const actualText = Number.isFinite(r.actual_govt_investment_trillion_yen)
      ? escapeHtml(`実績 ${String(r.actual_govt_investment_trillion_yen)}兆円`)
      : "実績の公式集計なし";
    const decisionText = fullDateJa(r.cabinet_decision_date);
    hover.show(`<b>第${periodText}期 ${escapeHtml(r.name)}</b><br>${escapeHtml(r.fiscal_years)}年度${decisionText ? `・${escapeHtml(decisionText)}閣議決定` : ""}<br>${targetText} / ${actualText}${joint ? `<br>${escapeHtml(joint)}` : ""}`, event, mount);
  }).on("pointerleave", () => hover.hide());

  /* lede: 最新期を動的に生成 */
  const latest = rows[rows.length - 1];
  const first = rows[0];
  const firstYear = parseSpan(first.fiscal_years).start;
  const latestStart = parseSpan(latest.fiscal_years).start;
  const yearsSince = latestStart - firstYear;
  const decisionText = fullDateJa(latest.cabinet_decision_date);
  setText("#history-lede", `現行は第${latest.period}期${latest.name}（${latest.fiscal_years}年度${decisionText ? `、${decisionText}閣議決定` : ""}）。政府研究開発投資の目標は5年間で${latest.target_govt_investment_trillion_yen}兆円、進捗を測る指標は${policy?.plan7_indicators?.count ?? "—"}。第1期（${first.fiscal_years.split("-")[0]}年度）から数えて${yearsSince}年目にあたる。`);
  setText("#history-source", `出典: ${block.source?.title || ""}。${block.note || ""}`);
}

/* ============================================================ 01 language spectrum */

function renderLanguageSpectrum(policy) {
  const mount = $("#language-spectrum");
  const block = policy?.plan_language;
  if (!mount) return;
  if (!block || block.status !== "ok" || !Array.isArray(block.terms) || !block.terms.length
    || !Array.isArray(block.periods_covered) || !block.periods_covered.length) {
    mount.innerHTML = '<p class="data-empty">用語頻度のデータを取得できませんでした。</p>';
    setText("#language-source", "出典を取得できませんでした。");
    return;
  }
  mount.innerHTML = "";
  const periods = block.periods_covered;
  const periodMeta = new Map((policy.plans_history?.periods || []).map((r) => [r.period, r]));
  const yearOf = (p) => periodMeta.get(p)?.fiscal_years?.split("-")[0] || null;

  /* 行=用語。第7期per10k − 第3期per10kの降順（=30年で伸びた語が上）に並べる。
     rowMaxは各語自身の対象期間中の最大per10k（行内の明るさはこの相対値）。
     firstIdxは出現回数>0になる最初の列。0番目より後ならその語は途中から現れた語とみなす。 */
  const rows = block.terms.map((t) => {
    const seq = periods.map((p) => t.counts?.[String(p)] || { n: 0, per10k: 0 });
    const rowMax = d3.max(seq, (c) => c.per10k || 0) || 0;
    const firstIdx = seq.findIndex((c) => (c.n || 0) > 0);
    const isNew = firstIdx > 0;
    const delta = (seq[seq.length - 1].per10k || 0) - (seq[0].per10k || 0);
    return { term: t.term, rule: t.rule, seq, rowMax, firstIdx, isNew, delta, lastPer10k: seq[seq.length - 1].per10k || 0 };
  }).sort((a, b) => b.delta - a.delta);

  const width = mount.clientWidth || 1000;
  const rowH = MOBILE ? 27 : 32;
  const margin = { top: 50, right: MOBILE ? 50 : 104, bottom: 6, left: MOBILE ? 82 : 148 };
  const height = margin.top + margin.bottom + rows.length * rowH;
  const x = d3.scalePoint().domain(periods).range([margin.left, width - margin.right]).padding(MOBILE ? 0.55 : 0.75);
  const maxBarH = rowH * 0.68;
  const cellW = x.step() * (MOBILE ? 0.62 : 0.8);

  const svg = d3.select(mount).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img")
    .attr("aria-label", "第3期から第7期までの科学技術基本計画本文に現れる18語の出現頻度");

  /* 高輝度セルだけに薄いにじみを掛ける共有フィルタ */
  const defs = svg.append("defs");
  const glow = defs.append("filter").attr("id", "policy-lang-glow").attr("x", "-60%").attr("y", "-60%").attr("width", "220%").attr("height", "220%");
  glow.append("feGaussianBlur").attr("stdDeviation", 2).attr("result", "blur");
  const merge = glow.append("feMerge");
  merge.append("feMergeNode").attr("in", "blur");
  merge.append("feMergeNode").attr("in", "SourceGraphic");

  /* 列ヘッダ: 第N期 + 開始年度 */
  periods.forEach((p) => {
    const cx = x(p);
    svg.append("text").attr("x", cx).attr("y", margin.top - 30).attr("text-anchor", "middle")
      .attr("font-size", MOBILE ? 9.5 : 11).attr("font-weight", 600).attr("fill", "#ffb545")
      .text(MOBILE ? `${p}期` : `第${p}期`);
    const yr = yearOf(p);
    if (yr) {
      svg.append("text").attr("x", cx).attr("y", margin.top - 17).attr("text-anchor", "middle")
        .attr("font-size", 9).attr("fill", "#8b96ab")
        .text(`${yr}〜`);
    }
  });

  const hover = hoverBox("#language-hover");
  const barEls = [];
  const markerEls = [];

  rows.forEach((row, ri) => {
    const y0 = margin.top + ri * rowH;
    const cy = y0 + rowH / 2;
    const baseline = y0 + rowH - 5;

    svg.append("text").attr("x", margin.left - 12).attr("y", cy + 4).attr("text-anchor", "end")
      .attr("font-size", MOBILE ? 10 : 11.5).attr("fill", "#e9eef7")
      .text(row.term);
    svg.append("text").attr("x", width - margin.right + 14).attr("y", cy + 4).attr("text-anchor", "start")
      .attr("font-size", MOBILE ? 9.5 : 10.5).attr("fill", "#ffb545")
      .text(row.lastPer10k.toFixed(1));

    row.seq.forEach((c, ci) => {
      const p = periods[ci];
      const cx = x(p);
      const ratio = row.rowMax > 0 ? (c.per10k || 0) / row.rowMax : 0;
      const isZero = !(c.n > 0);
      const barW = MOBILE ? 7 : 11;
      const barH = isZero ? 2 : Math.max(3, ratio * maxBarH);
      const rect = svg.append("rect")
        .attr("x", cx - barW / 2).attr("width", barW)
        .attr("y", baseline - barH).attr("height", barH).attr("rx", 1)
        .attr("fill", isZero ? "#4c5a72" : "#ffb545")
        .attr("opacity", isZero ? 0.35 : Math.min(1, 0.3 + ratio * 0.7));
      if (!isZero && ratio > 0.7) rect.attr("filter", "url(#policy-lang-glow)");
      barEls.push({ rect, baseline });

      /* 初出マーク: n=0の期が続いたあと最初に現れたセルにcyanの点 */
      if (row.isNew && ci === row.firstIdx) {
        const marker = svg.append("circle").attr("cx", cx).attr("cy", baseline - barH - 8).attr("r", 2.4)
          .attr("fill", "#4fd8ff").attr("filter", "url(#policy-lang-glow)");
        markerEls.push(marker);
      }

      /* ホバー/タップ用の透明な当たり判定（セル全体） */
      svg.append("rect").attr("x", cx - cellW / 2).attr("width", cellW)
        .attr("y", y0).attr("height", rowH).attr("fill", "transparent")
        .on("pointerenter pointermove", (event) => {
          const yr = yearOf(p);
          const isFirst = row.isNew && ci === row.firstIdx;
          hover.show(`<b>${escapeHtml(row.term)}</b> — 第${escapeHtml(String(p))}期${yr ? `（${escapeHtml(String(yr))}年度〜）` : ""}<br>${escapeHtml(String(c.n ?? 0))}回 / ${escapeHtml((c.per10k ?? 0).toFixed(2))}回・1万字${isFirst ? `<br><b style="color:#4fd8ff">初出</b>` : ""}<br><span style="color:var(--faint)">${escapeHtml(row.rule || "")}</span>`, event, mount);
        })
        .on("pointerleave", () => hover.hide());
    });
  });

  if (!REDUCED && gsap) {
    gsap.from(barEls.map((b) => b.rect.node()), {
      attr: { height: 0 }, y: (i) => barEls[i].baseline, duration: 0.9, ease: "power3.out", stagger: 0.006,
      scrollTrigger: { trigger: mount, start: "top 80%" },
    });
    gsap.from(markerEls.map((m) => m.node()), { attr: { r: 0 }, duration: 0.5, delay: 0.5, ease: "power3.out", scrollTrigger: { trigger: mount, start: "top 80%" } });
  }

  /* lede: 最も伸びた語（行の並び順=先頭）と、途中から現れた語のうち直近で最も高頻度な語を動的に取り上げる */
  const topRiser = rows[0];
  const newest = rows.filter((r) => r.isNew).sort((a, b) => b.lastPer10k - a.lastPer10k)[0];
  const firstP = periods[0];
  const lastP = periods[periods.length - 1];
  let ledeText = "";
  if (topRiser) {
    const riserFirst = topRiser.seq[0], riserLast = topRiser.seq[topRiser.seq.length - 1];
    ledeText = `閣議決定文書の中で使われた言葉を数えると、国の関心の移動が見える。「${topRiser.term}」は第${firstP}期の${riserFirst.per10k.toFixed(2)}回/1万字から第${lastP}期の${riserLast.per10k.toFixed(2)}回へ。`;
  }
  if (newest) ledeText += `「${newest.term}」は第${firstP}期には一度も現れなかった。`;
  setText("#language-lede", ledeText);

  const lengths = Object.values(block.doc_lengths || {});
  const minLen = lengths.length ? d3.min(lengths) : null;
  const maxLen = lengths.length ? d3.max(lengths) : null;
  const lenNote = minLen != null && maxLen != null
    ? ` 本文の長さは期により約${(minLen / 10000).toFixed(1)}万字〜${(maxLen / 10000).toFixed(1)}万字とばらつきがあるため、単純な出現回数ではなく${block.unit}（1万字あたりの出現回数）で正規化している。行内の明るさは各語自身の対象期間中の最大値に対する相対値で、語どうしの頻度の大小は右端の第${lastP}期の数値を参照。`
    : "";
  setText("#language-source", `出典: ${block.source?.title || ""}。${block.note || ""}${lenNote}`);
}

/* ============================================================ 02 indicators */

function renderIndicators(policy) {
  const mount = $("#targets-groups");
  const block = policy?.plan7_indicators;
  if (!mount) return;
  if (!block || block.status !== "ok" || !Array.isArray(block.indicators) || !block.indicators.length) {
    mount.innerHTML = '<p class="data-empty">指標データを取得できませんでした。</p>';
    setText("#targets-source", "出典を取得できませんでした。");
    return;
  }
  const isRank = (ind) => /位/.test(ind.current_value || "") || /位/.test(ind.target_value || "");

  const groups = [];
  const indexOf = new Map();
  for (const ind of block.indicators) {
    if (!indexOf.has(ind.category)) { indexOf.set(ind.category, groups.length); groups.push({ category: ind.category, items: [] }); }
    groups[indexOf.get(ind.category)].items.push(ind);
  }

  const cardHtml = (ind) => {
    const cur = splitChip(ind.current_value || "");
    const tgt = splitChip(ind.target_value || "");
    const rank = isRank(ind);
    /* 累計目標型（目標が「累計」や次期5年間の合計）は、現状値と目標値の測っている期間が
       異なるため、ゲージにすると進捗率のように誤読される。数値の並記のみにする。 */
    const cumulative = /累計/.test(ind.target_value || "") || /年度合計/.test(ind.target_value || "");
    const canGauge = !rank && !cumulative && Number.isFinite(ind.current_numeric) && Number.isFinite(ind.target_numeric)
      && ind.current_numeric >= 0 && ind.target_numeric > 0;
    /* current・target を同じ物差し（0〜どちらか大きい方×1.08）に載せ、現在地と目標地点を別々にマークする */
    let gaugeHtml = "";
    if (canGauge) {
      const scaleMax = Math.max(ind.current_numeric, ind.target_numeric) * 1.08;
      const currentPct = scaleMax > 0 ? (ind.current_numeric / scaleMax) * 100 : 0;
      const targetPct = scaleMax > 0 ? (ind.target_numeric / scaleMax) * 100 : 0;
      gaugeHtml = `<div class="policy-ind-gauge"><i style="width:${currentPct.toFixed(1)}%"></i><b style="left:${targetPct.toFixed(1)}%"></b></div>`;
    }
    return `
    <div class="policy-ind-card">
      <p class="policy-ind-name">${escapeHtml(ind.name)}</p>
      <div class="policy-ind-values">
        <span>${escapeHtml(cur.main)}</span>
        ${cur.chip ? `<span class="policy-year-chip">${escapeHtml(cur.chip)}</span>` : ""}
        <span class="policy-arrow">→</span>
        <span class="policy-ind-target">${escapeHtml(tgt.main)}</span>
        ${tgt.chip ? `<span class="policy-year-chip">${escapeHtml(tgt.chip)}</span>` : ""}
      </div>
      ${gaugeHtml}
      ${ind.source_note ? `<p class="policy-ind-source">${escapeHtml(ind.source_note)}</p>` : ""}
    </div>`;
  };

  mount.innerHTML = groups.map((g) => `
    <div class="policy-ind-group">
      <p class="policy-ind-group-title"><b>${escapeHtml(g.category)}</b>${g.items.length}件</p>
      <div class="policy-ind-grid">${g.items.map(cardHtml).join("")}</div>
    </div>`).join("");

  if (!REDUCED && gsap) {
    mount.querySelectorAll(".policy-ind-gauge i").forEach((bar) => {
      const target = bar.style.width;
      gsap.fromTo(bar, { width: "0%" }, { width: target, duration: 1, ease: "power3.out", scrollTrigger: { trigger: bar, start: "top 92%" } });
    });
  }

  const shortCat = (c) => c.replace(/我が国の|に関する指標/g, "").replace("イノベーション創出の観点も含めた産業の成長", "産業の成長（イノベーション創出を含む）").replace("科学技術・イノベーションへの投資", "投資");
  setText("#targets-lede", `第7期科学技術・イノベーション基本計画が掲げる${block.count}の指標。${groups.map((g) => `${shortCat(g.category)} ${g.items.length}件`).join("、")}。`);
  setText("#targets-source", `出典: ${block.source?.title || ""}。${block.note || ""}`);
}

/* ============================================================ 03 tech domains */

function renderDomains(policy) {
  const mount = $("#domains-grid");
  const block = policy?.tech_domains;
  if (!mount) return;
  if (!block || block.status !== "ok" || !Array.isArray(block.domains) || !block.domains.length) {
    mount.innerHTML = '<p class="data-empty">重点技術領域のデータを取得できませんでした。</p>';
    setText("#domains-source", "出典を取得できませんでした。");
    return;
  }
  mount.innerHTML = block.domains.map((d, i) => `
    <div class="policy-domain-tile">
      <span class="policy-domain-no">${String(i + 1).padStart(2, "0")}</span>
      <p class="policy-domain-name">${escapeHtml(d.name)}</p>
      <p class="policy-domain-summary">${escapeHtml(d.summary)}</p>
    </div>`).join("");

  const decisionText = fullDateJa(block.source?.cabinet_decision);
  setText("#domains-lede", `統合イノベーション戦略が定める重点技術${block.domains.length}領域。記述量や掲載順による重み付け・ランキングはしていない。`);
  setText("#domains-source", `出典: ${block.source?.title || ""}${decisionText ? `（${decisionText}閣議決定）` : ""}。${block.note || ""}`);
}

/* ==================================================================== boot */

async function init() {
  bootFooter();
  initRail();
  let policy = null;
  try {
    policy = await fetchJson("data/policy.json");
  } catch (error) {
    console.error(error);
  }
  const blockKeys = ["plans_history", "plan_language", "plan7_indicators", "tech_domains"];
  const okCount = policy ? blockKeys.filter((k) => policy[k]?.status === "ok").length : 0;
  if (!policy || okCount === 0) {
    setText("#header-status", "政策データを取得できません");
    return;
  }
  $("#header-status-dot")?.classList.add("is-live");
  const latestPeriod = policy.plans_history?.status === "ok" && Array.isArray(policy.plans_history.periods)
    ? policy.plans_history.periods[policy.plans_history.periods.length - 1]
    : null;
  setText("#header-status", latestPeriod
    ? `観測中 — 第${latestPeriod.period}期基本計画（${latestPeriod.fiscal_years}年度） / ${okCount}/${blockKeys.length}系統の公開データ`
    : `観測中 — ${okCount}/${blockKeys.length}系統の公開データ`);

  safeCall("initHistoryTimeline", () => initHistoryTimeline(policy));
  safeCall("renderLanguageSpectrum", () => renderLanguageSpectrum(policy));
  safeCall("renderIndicators", () => renderIndicators(policy));
  safeCall("renderDomains", () => renderDomains(policy));

  const entries = blockKeys.map((k) => blockEntry(policy[k], k)).filter(Boolean);
  renderLedgerEntries(entries);
}

init().catch((error) => {
  console.error(error);
  setText("#header-status", "政策データを取得できません");
});
