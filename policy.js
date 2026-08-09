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

/* ============================================================ 02 strategy language spectrum */

/* 年単位で急伸/急落する語のうち、可視化に短い注釈（annot-line/annot-text）を添える2語。
   行の並び順は動的に変わるため、行番号ではなく用語名で引く。 */
const STRATEGY_ANNOTATED_TERMS = new Set(["ＡＩ", "安全保障"]);

function renderStrategyLanguageSpectrum(policy) {
  const mount = $("#strategy-language-spectrum");
  const block = policy?.strategy_language;
  if (!mount) return;
  if (!block || block.status !== "ok" || !Array.isArray(block.terms) || !block.terms.length
    || !Array.isArray(block.years_covered) || !block.years_covered.length) {
    mount.innerHTML = '<p class="data-empty">用語頻度のデータを取得できませんでした。</p>';
    setText("#strategy-language-source", "出典を取得できませんでした。");
    return;
  }
  mount.innerHTML = "";
  const years = block.years_covered;

  /* 行=用語。最終年per10k − 初年per10kの降順（=伸びた語が上）。ch-language と同じ並べ方。 */
  const rows = block.terms.map((t) => {
    const seq = years.map((y) => t.counts?.[String(y)] || { n: 0, per10k: 0 });
    const rowMax = d3.max(seq, (c) => c.per10k || 0) || 0;
    const firstIdx = seq.findIndex((c) => (c.n || 0) > 0);
    const isNew = firstIdx > 0;
    const delta = (seq[seq.length - 1].per10k || 0) - (seq[0].per10k || 0);
    return { term: t.term, rule: t.rule, seq, rowMax, firstIdx, isNew, delta, lastPer10k: seq[seq.length - 1].per10k || 0 };
  }).sort((a, b) => b.delta - a.delta);

  const width = mount.clientWidth || 1000;
  const baseRowH = MOBILE ? 27 : 32;
  const annotExtra = MOBILE ? 34 : 28; /* ＡＩ・安全保障の2行だけ、注釈テキスト分の余白を上に足す */
  const margin = { top: 40, right: MOBILE ? 50 : 104, bottom: 6, left: MOBILE ? 82 : 148 };

  const rowHeights = rows.map((r) => baseRowH + (STRATEGY_ANNOTATED_TERMS.has(r.term) ? annotExtra : 0));
  const rowY0 = [];
  let cursor = margin.top;
  rowHeights.forEach((h) => { rowY0.push(cursor); cursor += h; });
  const rowsBottom = cursor;

  const docLenByYear = years.map((y) => block.doc_lengths?.[String(y)] || 0);
  const maxDocLen = d3.max(docLenByYear) || 1;
  const doclenGap = 22;
  const doclenH = MOBILE ? 26 : 32;
  const doclenLabelH = 16;
  const doclenTop = rowsBottom + doclenGap;
  const height = doclenTop + doclenH + doclenLabelH + margin.bottom;

  const x = d3.scalePoint().domain(years).range([margin.left, width - margin.right]).padding(MOBILE ? 0.55 : 0.75);
  const maxBarH = baseRowH * 0.68;
  const barW = MOBILE ? 7 : 11;
  const cellW = x.step() * (MOBILE ? 0.62 : 0.8);

  const svg = d3.select(mount).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img")
    .attr("aria-label", "2018年から2026年までの統合イノベーション戦略本文に現れる18語の年次出現頻度");

  const defs = svg.append("defs");
  const glow = defs.append("filter").attr("id", "policy-strat-glow").attr("x", "-60%").attr("y", "-60%").attr("width", "220%").attr("height", "220%");
  glow.append("feGaussianBlur").attr("stdDeviation", 2).attr("result", "blur");
  const merge = glow.append("feMerge");
  merge.append("feMergeNode").attr("in", "blur");
  merge.append("feMergeNode").attr("in", "SourceGraphic");

  /* 列ヘッダ: 年（西暦） */
  years.forEach((y) => {
    const cx = x(y);
    svg.append("text").attr("x", cx).attr("y", margin.top - 16).attr("text-anchor", "middle")
      .attr("font-size", MOBILE ? 9 : 11).attr("font-weight", 600).attr("fill", "#ffb545")
      .text(MOBILE ? `'${String(y).slice(2)}` : String(y));
  });

  const hover = hoverBox("#strategy-language-hover");
  const barEls = [];
  const markerEls = [];

  rows.forEach((row, ri) => {
    const y0 = rowY0[ri];
    const rowH = rowHeights[ri];
    /* バー・ラベルは常にbaseRowH基準（行帯の先頭寄せ）で揃える。注釈がある行は、
       バーの下に生まれた余白（rowH - baseRowH分）に注釈テキストを置く。 */
    const baseline = y0 + baseRowH - 5;
    const labelY = baseline - maxBarH / 2 + 4;

    svg.append("text").attr("x", margin.left - 12).attr("y", labelY).attr("text-anchor", "end")
      .attr("font-size", MOBILE ? 10 : 11.5).attr("fill", "#e9eef7")
      .text(row.term);
    svg.append("text").attr("x", width - margin.right + 14).attr("y", labelY).attr("text-anchor", "start")
      .attr("font-size", MOBILE ? 9.5 : 10.5).attr("fill", "#ffb545")
      .text(row.lastPer10k.toFixed(1));

    row.seq.forEach((c, ci) => {
      const y = years[ci];
      const cx = x(y);
      const ratio = row.rowMax > 0 ? (c.per10k || 0) / row.rowMax : 0;
      const isZero = !(c.n > 0);
      const barH = isZero ? 2 : Math.max(3, ratio * maxBarH);
      const rect = svg.append("rect")
        .attr("x", cx - barW / 2).attr("width", barW)
        .attr("y", baseline - barH).attr("height", barH).attr("rx", 1)
        .attr("fill", isZero ? "#4c5a72" : "#ffb545")
        .attr("opacity", isZero ? 0.35 : Math.min(1, 0.3 + ratio * 0.7));
      if (!isZero && ratio > 0.7) rect.attr("filter", "url(#policy-strat-glow)");
      barEls.push({ rect, baseline });

      if (row.isNew && ci === row.firstIdx) {
        const marker = svg.append("circle").attr("cx", cx).attr("cy", baseline - barH - 8).attr("r", 2.4)
          .attr("fill", "#4fd8ff").attr("filter", "url(#policy-strat-glow)");
        markerEls.push(marker);
      }

      svg.append("rect").attr("x", cx - cellW / 2).attr("width", cellW)
        .attr("y", y0).attr("height", rowH).attr("fill", "transparent")
        .on("pointerenter pointermove", (event) => {
          const isFirst = row.isNew && ci === row.firstIdx;
          const decisionText = fullDateJa(block.decision_dates_by_year?.[String(y)]);
          hover.show(`<b>${escapeHtml(row.term)}</b> — ${escapeHtml(String(y))}年版${decisionText ? `（${escapeHtml(decisionText)}閣議決定）` : ""}<br>${escapeHtml(String(c.n ?? 0))}回 / ${escapeHtml((c.per10k ?? 0).toFixed(2))}回・1万字${isFirst ? `<br><b style="color:#4fd8ff">初出</b>` : ""}<br><span style="color:var(--faint)">${escapeHtml(row.rule || "")}</span>`, event, mount);
        })
        .on("pointerleave", () => hover.hide());
    });

    /* ＡＩ（U字型）・安全保障（2026急伸）の2行にだけ、バーの下に生まれた余白に短い注釈を添える。
       線は該当セルの棒の先端から、下の注釈テキストへ短くつなぐ。 */
    if (STRATEGY_ANNOTATED_TERMS.has(row.term)) {
      const annotLines = strategyAnnotationLines(row, years, block);
      if (annotLines) {
        const troughX = x(annotLines.anchorYear);
        const annotTop = y0 + baseRowH + 6;
        svg.append("line").attr("class", "annot-line")
          .attr("x1", troughX).attr("x2", troughX)
          .attr("y1", baseline - annotLines.anchorBarH - 2).attr("y2", annotTop - 4);
        svg.append("text").attr("class", "annot-text").attr("x", margin.left).attr("y", annotTop + 8)
          .attr("font-size", MOBILE ? 9 : 10).text(annotLines.line1);
        svg.append("text").attr("class", "annot-sub").attr("x", margin.left).attr("y", annotTop + 20)
          .attr("font-size", MOBILE ? 8 : 9).text(annotLines.line2);
      }
    }
  });

  /* 文書字数の帯（列位置は上のマトリクスと同じxスケールで揃える）。2018〜2023年は本文PDF、
     2024〜2026年は別紙等を含む全体版PDFで対象範囲が異なるため「本文」とは呼ばない */
  const docLenScale = d3.scaleLinear().domain([0, maxDocLen * 1.08]).range([0, doclenH]);
  svg.append("text").attr("x", margin.left - 12).attr("y", doclenTop + doclenH / 2 + 4).attr("text-anchor", "end")
    .attr("font-size", MOBILE ? 9 : 10).attr("fill", "#8b96ab").text("文書字数");
  const doclenBars = [];
  years.forEach((y, i) => {
    const cx = x(y);
    const val = docLenByYear[i];
    const h = docLenScale(val);
    const isLatest = i === years.length - 1;
    const rect = svg.append("rect")
      .attr("x", cx - barW / 2).attr("width", barW)
      .attr("y", doclenTop + doclenH - h).attr("height", h)
      .attr("fill", isLatest ? "#4fd8ff" : "#4c5a72").attr("opacity", isLatest ? 0.85 : 0.5);
    doclenBars.push({ rect, baseline: doclenTop + doclenH });
    /* モバイルは列幅が狭くラベル9個が衝突するため、最初・最新（着目年）だけ表示（ホバーで全年度を確認できる） */
    if (!MOBILE || i === 0 || isLatest) {
      svg.append("text").attr("x", cx).attr("y", doclenTop + doclenH + 12).attr("text-anchor", "middle")
        .attr("font-size", MOBILE ? 8 : 8.5).attr("fill", isLatest ? "#4fd8ff" : "#4c5a72")
        .text(`${(val / 10000).toFixed(1)}万`);
    }
    svg.append("rect").attr("x", cx - x.step() / 2).attr("width", x.step())
      .attr("y", doclenTop - 4).attr("height", doclenH + doclenLabelH).attr("fill", "transparent")
      .append("title").text(`${y}年 本文${fmtInt(val)}字`);
  });

  if (!REDUCED && gsap) {
    gsap.from(barEls.map((b) => b.rect.node()), {
      attr: { height: 0 }, y: (i) => barEls[i].baseline, duration: 0.9, ease: "power3.out", stagger: 0.006,
      scrollTrigger: { trigger: mount, start: "top 80%" },
    });
    gsap.from(doclenBars.map((b) => b.rect.node()), {
      attr: { height: 0 }, y: (i) => doclenBars[i].baseline, duration: 0.7, ease: "power3.out", stagger: 0.02, delay: 0.3,
      scrollTrigger: { trigger: mount, start: "top 80%" },
    });
    gsap.from(markerEls.map((m) => m.node()), { attr: { r: 0 }, duration: 0.5, delay: 0.5, ease: "power3.out", scrollTrigger: { trigger: mount, start: "top 80%" } });
  }

  /* lede: 基本計画との年次解像度の違い + 閣議決定の月レンジ（データから動的に算出） */
  const months = years.map((y) => {
    const iso = block.decision_dates_by_year?.[String(y)];
    const d = iso ? new Date(iso) : null;
    return d && !Number.isNaN(d.getTime()) ? d.getMonth() + 1 : null;
  }).filter((m) => m != null);
  const minMonth = months.length ? d3.min(months) : null;
  const maxMonth = months.length ? d3.max(months) : null;
  const monthRange = minMonth != null && maxMonth != null
    ? (minMonth === maxMonth ? `毎年${minMonth}月ごろ` : `毎年${minMonth}〜${maxMonth}月ごろ`)
    : "毎年";
  setText("#strategy-language-lede", `基本計画は5年に一度だが、統合イノベーション戦略は${monthRange}閣議決定される。年単位の解像度で政策の言葉の変化を見る、「計画の言葉」の姉妹編。`);

  /* 本文字数の注記: 直近4年（2026を除く末尾4年）との比率で「密度が出やすい」ことを数値で示す */
  const recentLens = docLenByYear.slice(-5, -1).filter((v) => v > 0);
  const latestLen = docLenByYear[docLenByYear.length - 1];
  const latestYear = years[years.length - 1];
  let doclenNote = "";
  if (recentLens.length && latestLen > 0) {
    const avgRecent = d3.mean(recentLens);
    const ratio = latestLen / avgRecent;
    const recentMin = d3.min(recentLens), recentMax = d3.max(recentLens);
    doclenNote = ` ${latestYear}年版は約${(latestLen / 10000).toFixed(1)}万字で、直近4年（約${(recentMin / 10000).toFixed(0)}〜${(recentMax / 10000).toFixed(0)}万字）の${Math.round(ratio * 100)}%程度。${block.unit}は文書の密度に影響されるため、実数（n）も併せて確認するとよい。`;
  }
  const scaleNote = ` 行内の明るさは各語自身の対象期間中の最大値に対する相対値で、語どうしの頻度の大小は右端の${years[years.length - 1]}年の数値を参照。2018〜2023年は本文PDF、2024〜2026年は別紙等を含む全体版PDFで、対象文書の範囲が年代により異なる。`;
  setText("#strategy-language-source", `出典: ${block.source?.title || ""}。${block.note || ""}${scaleNote}${doclenNote}`.trim());
}

/* ＡＩ（Ｕ字型の谷）・安全保障（2026年の急伸）の注釈テキストを、ハードコードせず実データから組み立てる */
function strategyAnnotationLines(row, years, block) {
  if (row.term === "ＡＩ") {
    let troughIdx = 0;
    row.seq.forEach((c, i) => { if ((c.per10k || 0) < (row.seq[troughIdx].per10k || 0)) troughIdx = i; });
    const trough = row.seq[troughIdx];
    const first = row.seq[0];
    const last = row.seq[row.seq.length - 1];
    /* モバイルはＣＪＫグリフがmonospace想定より広く、長文だとSVGの端で切れるため短縮版を使う */
    return {
      anchorYear: years[troughIdx],
      anchorBarH: row.rowMax > 0 ? Math.max(3, ((trough.per10k || 0) / row.rowMax) * (MOBILE ? 27 : 32) * 0.68) : 3,
      line1: MOBILE ? "「ＡＩ」Ｕ字型" : `「ＡＩ」Ｕ字型 — ${years[0]}年${first.per10k.toFixed(2)}→${years[troughIdx]}年${trough.per10k.toFixed(2)}で底`,
      line2: MOBILE
        ? `${years[troughIdx]}年${trough.per10k.toFixed(2)}底→${years[years.length - 1]}年${last.per10k.toFixed(2)}`
        : `→${years[years.length - 1]}年${last.per10k.toFixed(2)}。2023年以降急伸（生成ＡＩ期と重なる）`,
    };
  }
  if (row.term === "安全保障") {
    const lastIdx = row.seq.length - 1;
    const last = row.seq[lastIdx];
    const prev = row.seq[lastIdx - 1];
    const latestLen = block.doc_lengths?.[String(years[lastIdx])] || 0;
    const recentLens = years.slice(-5, -1).map((y) => block.doc_lengths?.[String(y)] || 0).filter((v) => v > 0);
    const densePct = recentLens.length && latestLen ? Math.round((latestLen / d3.mean(recentLens)) * 100) : null;
    const denseNote = densePct != null ? `本文${(latestLen / 10000).toFixed(1)}万字と例年の${densePct}%で密度が出やすい` : "";
    return {
      anchorYear: years[lastIdx],
      anchorBarH: row.rowMax > 0 ? Math.max(3, ((last.per10k || 0) / row.rowMax) * (MOBILE ? 27 : 32) * 0.68) : 3,
      line1: MOBILE
        ? `「安全保障」${years[lastIdx]}年${last.per10k.toFixed(2)}へ急上昇`
        : `「安全保障」${years[lastIdx - 1] ? `${years[lastIdx - 1]}年${prev.per10k.toFixed(2)}→` : ""}${years[lastIdx]}年${last.per10k.toFixed(2)}へ急上昇`,
      line2: MOBILE
        ? `本文${(latestLen / 10000).toFixed(1)}万字で密度大（n=${last.n ?? 0}）`
        : `${denseNote}（実数${last.n ?? 0}回）`,
    };
  }
  return null;
}

/* ============================================================ 03 indicators */

/* 19指標 × このサイトの実測系列との対応表。indicator.name の完全一致で引く。
   status: direct=サイトの実測系列で直接追える / approx=近い指標だが定義が異なる / none=未計測（外部一次資料のみ）。
   note: approxは定義差の注記（verbatim）、noneは一次資料名。sparklineは直接系列のミニグラフ用マウントID。 */
const TARGETS_AUDIT_MAP = {
  "Top10％補正論文数": { status: "approx", note: "サイトの系列は整数カウント法のシェア（NISTEP表4-1-7）。指標の世界順位は分数カウント法で算出法が異なる。" },
  "第１・２グループ等の大学の研究時間（教員の職務活動のうち、研究活動が占める割合）": { status: "none", note: "外部一次資料: 文科省フルタイム換算データ調査" },
  "若手を中心とした挑戦的な研究課題の件数": { status: "none", note: "外部一次資料: 科研費等の種目別内訳" },
  "日本人研究者の長期海外派遣数": { status: "direct", sparkline: "dispatch" },
  "国際共著論文率": { status: "approx", note: "OpenAlex集計から算出した近似値（国際共著件数÷総論文数、whole counting）。指標の典拠とは算出法が異なる。", noteId: "policy-note-collab" },
  "博士課程入学者数・博士号取得者数": { status: "direct", sparkline: "phd" },
  "大学の教授等（学長、副学長及び教授）に占める女性の割合": { status: "approx", note: "サイトの系列は産官学を含む全研究者の女性割合（2024年18.5%）。指標は大学の学長・副学長・教授に限る（20.1%）。" },
  "第１・２グループ等の大学の若手研究者数（40歳未満の大学本務教員数）": { status: "approx", note: "サイトの系列は全大学本務教員の25〜39歳割合（2022年度20.8%）。指標は研究大学の40歳未満に限る。" },
  "第１・２グループ等の大学の研究者１人当たりの高度専門人材数": { status: "none", note: "外部一次資料: NISTEP科学技術指標（テクニシャン）" },
  "総論文数に対する全分野でのＡＩ関連論文数の割合": { status: "none", note: "外部一次資料: JST-CRDS（Scopus集計）" },
  "研究設備・機器の共用化率": { status: "none", note: "外部一次資料: 内閣府調査" },
  "高等教育機関の研究開発支出に占める国内企業拠出割合": { status: "approx", note: "サイトの算出値は2023年度3.18%。指標の現状値（2021年度3.2%）と年度の対応にずれの疑いがあり参考値。" },
  "大学等における民間企業からの共同研究受入額": { status: "approx", note: "サイトの系列は2023年度1,053億円。指標の引用値（1,028億円）と約2%の差（集計版の違い）。" },
  "相互運用性が確保され、データ連携が可能なスマートシティサービスを行っている地方公共団体・地域の数": { status: "none", note: "外部一次資料: 関係府省の実装状況調査" },
  "ISO/IECにおける幹事国引受数": { status: "none", note: "外部一次資料: 経産省" },
  "ＰＰＨ締結国数（実施庁数）": { status: "none", note: "外部一次資料: 特許庁" },
  "イノベーション実現企業率": { status: "none", note: "外部一次資料: NISTEP全国イノベーション調査" },
  "政府研究開発投資額": { status: "approx", note: "サイトの予算系列は科学技術関係当初予算のみ。指標の60兆円は補正予算等を含む5年累計で範囲が異なる。" },
  "官民研究開発投資額": { status: "none", note: "外部一次資料: 総務省科学技術研究調査" },
};
const TARGETS_AUDIT_LABEL = { direct: "実測", approx: "近似指標", none: "未計測" };

function renderTargetsAudit(mount, indicators) {
  if (!mount) return;
  const rows = indicators.map((ind) => ({ ind, audit: TARGETS_AUDIT_MAP[ind.name] || { status: "none", note: "" } }));
  const directCount = rows.filter((r) => r.audit.status === "direct").length;
  const approxCount = rows.filter((r) => r.audit.status === "approx").length;
  const noneCount = rows.filter((r) => r.audit.status === "none").length;
  const cells = rows.map((r) => `<span class="policy-audit-cell is-${r.audit.status}" title="${escapeHtml(r.ind.name)}"></span>`).join("");
  mount.innerHTML = `
    <div class="policy-audit">
      <p class="policy-audit-headline">19の目標のうち、この観測室の実測系列で直接追えるのは <b>${directCount}</b>。</p>
      <div class="policy-audit-strip" role="img" aria-label="19指標の測定状況。実測${directCount}件・近似指標${approxCount}件・未計測${noneCount}件">${cells}</div>
      <div class="policy-audit-legend">
        <span class="is-direct"><i aria-hidden="true"></i>実測で追跡（${directCount}）</span>
        <span class="is-approx"><i aria-hidden="true"></i>近い指標のみ（${approxCount}）</span>
        <span class="is-none"><i aria-hidden="true"></i>未計測（${noneCount}）</span>
      </div>
    </div>`;
}

function renderIndicators(policy) {
  const auditMount = $("#targets-audit");
  const mount = $("#targets-groups");
  const block = policy?.plan7_indicators;
  if (!mount) return;
  if (!block || block.status !== "ok" || !Array.isArray(block.indicators) || !block.indicators.length) {
    mount.innerHTML = '<p class="data-empty">指標データを取得できませんでした。</p>';
    if (auditMount) auditMount.innerHTML = "";
    setText("#targets-source", "出典を取得できませんでした。");
    return;
  }
  const isRank = (ind) => /位/.test(ind.current_value || "") || /位/.test(ind.target_value || "");

  renderTargetsAudit(auditMount, block.indicators);

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
    const audit = TARGETS_AUDIT_MAP[ind.name] || { status: "none", note: "" };
    const chipHtml = `<span class="policy-audit-chip is-${audit.status}">${escapeHtml(TARGETS_AUDIT_LABEL[audit.status])}</span>`;
    const noteHtml = audit.note
      ? `<p class="policy-audit-note"${audit.noteId ? ` id="${escapeHtml(audit.noteId)}"` : ""}>${escapeHtml(audit.note)}</p>`
      : "";
    const sparkHtml = audit.sparkline
      ? `<div class="policy-spark" id="policy-spark-${escapeHtml(audit.sparkline)}"><p class="policy-spark-loading">系列を読み込み中…</p></div>`
      : "";
    return `
    <div class="policy-ind-card">
      <div class="policy-ind-head">
        <p class="policy-ind-name">${escapeHtml(ind.name)}</p>
        ${chipHtml}
      </div>
      <div class="policy-ind-values">
        <span>${escapeHtml(cur.main)}</span>
        ${cur.chip ? `<span class="policy-year-chip">${escapeHtml(cur.chip)}</span>` : ""}
        <span class="policy-arrow">→</span>
        <span class="policy-ind-target">${escapeHtml(tgt.main)}</span>
        ${tgt.chip ? `<span class="policy-year-chip">${escapeHtml(tgt.chip)}</span>` : ""}
      </div>
      ${gaugeHtml}
      ${noteHtml}
      ${sparkHtml}
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

/* ------------------------------------------------------ 03b targets lazy data (indicators.json / mobility.json) */

/* 小さな軸なしミニグラフ（1本の折れ線＋任意の目標水平線）。カードの中で使う「hairline」流儀。 */
function renderMiniSpark(container, points, opts = {}) {
  if (!container) return;
  container.innerHTML = "";
  if (!Array.isArray(points) || !points.length) {
    container.innerHTML = '<p class="policy-spark-empty">系列を取得できません</p>';
    return;
  }
  const width = container.clientWidth || 240;
  const height = opts.height || 46;
  const margin = { top: 8, right: 4, bottom: 4, left: 4 };
  const x = d3.scaleLinear().domain(d3.extent(points, (d) => d[0])).range([margin.left, width - margin.right]);
  const maxY = Math.max(d3.max(points, (d) => d[1]) || 0, opts.targetLine || 0) * 1.1;
  const y = d3.scaleLinear().domain([0, maxY || 1]).range([height - margin.bottom, margin.top]);
  const svg = d3.select(container).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img").attr("aria-label", opts.ariaLabel || "");
  if (Number.isFinite(opts.targetLine)) {
    svg.append("line").attr("x1", margin.left).attr("x2", width - margin.right).attr("y1", y(opts.targetLine)).attr("y2", y(opts.targetLine))
      .attr("stroke", "#4fd8ff").attr("stroke-width", 1).attr("stroke-dasharray", "2 3");
    svg.append("text").attr("x", width - margin.right).attr("y", y(opts.targetLine) - 4).attr("text-anchor", "end")
      .attr("font-size", 8).attr("fill", "#4fd8ff").text(opts.targetLabel || "目標");
  }
  const line = d3.line().x((d) => x(d[0])).y((d) => y(d[1])).curve(d3.curveMonotoneX);
  svg.append("path").attr("d", line(points)).attr("fill", "none").attr("stroke", "#ffb545").attr("stroke-width", 1.4);
  const last = points[points.length - 1];
  svg.append("circle").attr("cx", x(last[0])).attr("cy", y(last[1])).attr("r", 2.2).attr("fill", "#ffb545");
  if (opts.note) {
    const p = document.createElement("p");
    p.className = "policy-spark-note";
    p.textContent = opts.note;
    container.appendChild(p);
  }
}

/* OpenAlexの国際共著率を、日本の年間論文総数に対する国際共著論文数の比として算出（暫定年は除く） */
function computeIntlCollabRate(indicators) {
  const oa = indicators?.openalex;
  if (!oa || oa.status !== "ok" || !Array.isArray(oa.jp_international_collab)) return null;
  const jpTotals = new Map((oa.by_year || []).find((s) => s.key === "jp")?.values || []);
  const partial = oa.partial_year;
  const usable = oa.jp_international_collab.filter(([year]) => year !== partial && jpTotals.has(year));
  if (!usable.length) return null;
  const [year, n] = usable[usable.length - 1];
  const total = jpTotals.get(year);
  if (!total) return null;
  return { year, rate: (n / total) * 100 };
}

function fillTargetsLazy(indicators, mobility) {
  const dispatchEl = $("#policy-spark-dispatch");
  if (dispatchEl) {
    const midLong = mobility?.mext_flows?.dispatch?.mid_long;
    if (Array.isArray(midLong) && midLong.length) {
      const recent = midLong.slice(-10);
      const last = recent[recent.length - 1];
      const projTotal = last[1] * 5;
      renderMiniSpark(dispatchEl, recent, {
        ariaLabel: "日本人研究者の長期海外派遣数（中・長期）直近10年",
        note: `${last[0]}年度 ${fmtInt(last[1])}人。目標は2026〜2030年度の累計3万人 — このペースの単純継続では5年で約${Math.round(projTotal / 10000)}万人`,
      });
    } else {
      dispatchEl.innerHTML = '<p class="policy-spark-empty">系列を取得できません</p>';
    }
  }
  const phdEl = $("#policy-spark-phd");
  if (phdEl) {
    const rows = indicators?.phd_enrollment?.rows;
    if (Array.isArray(rows) && rows.length) {
      const recent = rows.slice(-12).map((r) => [r.year, r.total]);
      renderMiniSpark(phdEl, recent, {
        targetLine: 20000,
        targetLabel: "目標2万人(2030)",
        ariaLabel: "博士課程入学者数の推移と2030年度目標2万人",
      });
    } else {
      phdEl.innerHTML = '<p class="policy-spark-empty">系列を取得できません</p>';
    }
  }
  const collabNote = $("#policy-note-collab");
  if (collabNote) {
    const rate = computeIntlCollabRate(indicators);
    collabNote.insertAdjacentText("beforeend", rate ? `（サイトの近似値: ${rate.rate.toFixed(1)}%、${rate.year}年）` : "（近似値を算出できませんでした）");
  }
}

/* ch-targetsが画面に近づくまでindicators.json/mobility.jsonの取得を遅らせる（people.jsのinitMobMapLazyと同じ流儀） */
function initTargetsLazy() {
  const target = $("#ch-targets");
  let done = false;
  const trigger = () => {
    if (done) return;
    done = true;
    Promise.allSettled([fetchJson("data/indicators.json"), fetchJson("data/mobility.json")]).then(([indicatorsResult, mobilityResult]) => {
      const indicators = indicatorsResult.status === "fulfilled" ? indicatorsResult.value?.indicators : null;
      const mobility = mobilityResult.status === "fulfilled" ? mobilityResult.value : null;
      safeCall("fillTargetsLazy", () => fillTargetsLazy(indicators, mobility));
    });
  };
  if (!target || typeof IntersectionObserver === "undefined") {
    trigger();
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) {
      observer.disconnect();
      trigger();
    }
  }, { rootMargin: "600px 0px" });
  observer.observe(target);
}

/* ============================================================ 04 domain lineage */

const LINEAGE_COLUMNS = ["p2", "p3", "p4", "p5", "p6", "p7"];

/* 括弧の注記（「（コンテンツを含む。）」「（物流）」等）を軸ラベル・カード見出しから除いた短縮名。
   フルネームはホバー/aria-labelに残す（データ自体は改変しない）。 */
function lineageShortName(name) {
  return String(name).replace(/[（(][^）)]*[）)]/g, "");
}

function lineageColumnNodes(period) {
  const nodes = [];
  (period.groups || []).forEach((g, gi) => {
    (g.items || []).forEach((item) => nodes.push({ name: item, groupIndex: gi }));
  });
  return nodes;
}

/* domainのedgesから「期→期」のパンくずを組み立てる（モバイルカード用）。同じ期に複数の
   来歴項目が合流している場合は「＋」で連結する。区間ごとのflagは、その区間を跨ぐedgeの
   いずれかがsureならsure、そうでなければinterpとする。 */
function lineageBreadcrumb(domain, edges, periodByKey) {
  const own = edges.filter((e) => e.domain === domain);
  if (!own.length) return null;
  const itemsByPeriod = new Map();
  const touchOrder = [];
  const touch = (period, item) => {
    if (!itemsByPeriod.has(period)) { itemsByPeriod.set(period, new Set()); touchOrder.push(period); }
    itemsByPeriod.get(period).add(item);
  };
  own.forEach((e) => { touch(e.from_period, e.from_item); touch(e.to_period, e.to_item); });
  const ordered = LINEAGE_COLUMNS.filter((p) => itemsByPeriod.has(p));
  return ordered.map((p, i) => {
    const items = Array.from(itemsByPeriod.get(p));
    const year = periodByKey.get(p)?.decided?.slice(0, 4) || p;
    let flag = null;
    if (i > 0) {
      const prev = ordered[i - 1];
      const between = own.filter((e) => e.from_period === prev && e.to_period === p);
      flag = between.some((e) => e.flag === "sure") ? "sure" : "interp";
    }
    return { year, items, flag };
  });
}

function renderDomainLineageMobile(mount, block, periodByKey, natStratSet) {
  const domains = periodByKey.get("p7")?.groups?.[0]?.items || [];
  const defenseItem = block.first_appearance?.item;
  const cardsHtml = domains.map((name) => {
    const isNat = natStratSet.has(name);
    const isFirst = name === defenseItem;
    const segments = lineageBreadcrumb(name, block.edges, periodByKey);
    const trailHtml = segments
      ? segments.map((seg, i) => `${i > 0 ? `<span class="lineage-card-arrow${seg.flag === "interp" ? " is-interp" : ""}">${seg.flag === "interp" ? "⇢" : "→"}</span>` : ""}<span class="lineage-card-step"><b>${escapeHtml(seg.items.map(lineageShortName).join("＋"))}</b><i>${escapeHtml(seg.year)}</i></span>`).join("")
      : `<span class="lineage-card-step"><b>${escapeHtml(lineageShortName(name))}</b><i>${escapeHtml(periodByKey.get("p7")?.decided?.slice(0, 4) || "2026")}</i></span>`;
    return `
    <div class="lineage-card${isFirst ? " is-first" : ""}">
      <div class="lineage-card-head">
        <p class="lineage-card-name">${isNat ? '<span class="lineage-badge-natstrat">◎</span>' : ""}${escapeHtml(lineageShortName(name))}</p>
        ${isFirst ? '<span class="lineage-first-chip">初出</span>' : ""}
      </div>
      <div class="lineage-card-trail">${trailHtml}</div>
    </div>`;
  }).join("");
  mount.innerHTML = `<div class="lineage-cards">${cardsHtml}</div>`;
}

function renderDomainLineage(policy) {
  const mount = $("#lineage-chart");
  const block = policy?.domain_lineage;
  if (!mount) return;
  if (!block || block.status !== "ok" || !Array.isArray(block.periods) || !block.periods.length || !Array.isArray(block.edges)) {
    mount.innerHTML = '<p class="data-empty">系譜データを取得できませんでした。</p>';
    setText("#lineage-source", "出典を取得できませんでした。");
    return;
  }
  const periods = block.periods;
  const periodByKey = new Map(periods.map((p) => [p.key, p]));
  const natStratSet = new Set(block.national_strategy || []);
  const defenseItem = block.first_appearance?.item;

  setText("#lineage-lede", `2001年の8分野から2026年の17領域へ — 国の「重点」の看板が25年でどう分岐・改名・消滅してきたか。第4期は分野の看板を一度降ろし、課題達成型へ転換した。${MOBILE ? "各領域の来歴は「→」が名称の継承・改名、「⇢」が内容上の対応（編集部の解釈）。" : "図中の実線は名称（中核語）の継承・改名、点線は名称の継承を伴わない内容上の対応（編集部の解釈）。"}`);
  setText("#lineage-legend", "◎ 国家戦略技術領域（集中投資対象6領域） / 実線・→＝名称（中核語）の継承・改名、点線・⇢＝内容上の対応（編集部の解釈、区間ごとに判定） / シアン＝第7期で初出");
  const extinctMount = $("#lineage-extinct");
  if (extinctMount && Array.isArray(block.extinct)) {
    extinctMount.textContent = `看板としては消滅（中身は他領域に分散継承）: ${block.extinct.map((e) => `${e.name}（${e.fate}）`).join(" / ")}`;
  }
  const decisionText = fullDateJa(periodByKey.get("p7")?.decided);
  setText("#lineage-source", `出典: ${block.source?.title || ""}${decisionText ? `（第7期は${decisionText}閣議決定）` : ""}。${block.note || ""}`);

  if (MOBILE) { renderDomainLineageMobile(mount, block, periodByKey, natStratSet); return; }

  mount.innerHTML = "";
  const width = mount.clientWidth || 1200;
  const height = 1060;
  const margin = { top: 132, right: 258, bottom: 60, left: 176 };
  const x = d3.scalePoint().domain(LINEAGE_COLUMNS).range([margin.left, width - margin.right]);

  const svg = d3.select(mount).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img")
    .attr("aria-label", "第2期(2001年)から第7期(2026年)までの重点分野・技術領域の系譜。実線は名称の直接継承、点線は内容上の対応（編集部の解釈）");

  /* ノード位置: 列ごとに項目数で等分し、グループ境界に少し余白を入れる */
  const nodePos = new Map();
  const groupGap = 20;
  periods.forEach((p) => {
    const nodes = lineageColumnNodes(p);
    if (!nodes.length) return;
    const groupCount = (p.groups || []).length || 1;
    const usableH = height - margin.top - margin.bottom - groupGap * Math.max(0, groupCount - 1);
    const rowH = usableH / nodes.length;
    let cursor = margin.top;
    let lastGroup = -1;
    nodes.forEach((n) => {
      if (lastGroup !== -1 && n.groupIndex !== lastGroup) cursor += groupGap;
      lastGroup = n.groupIndex;
      const cy = cursor + rowH / 2;
      nodePos.set(`${p.key}::${n.name}`, { x: x(p.key), y: cy, period: p.key, item: n.name });
      cursor += rowH;
    });
  });

  const hover = hoverBox("#lineage-hover");

  /* 第4期バンド: 分野の看板を一度降ろした転換期 */
  const p4 = periodByKey.get("p4");
  const bandX0 = (x("p3") + x("p4")) / 2;
  const bandX1 = (x("p4") + x("p5")) / 2;
  const bandY0 = margin.top - 16;
  const bandY1 = height - margin.bottom + 16;
  svg.append("rect").attr("class", "lineage-band")
    .attr("x", bandX0).attr("y", bandY0).attr("width", bandX1 - bandX0).attr("height", bandY1 - bandY0)
    .on("pointerenter pointermove", (event) => hover.show(`<b>${escapeHtml(p4?.transition_label || "")}</b><br>${escapeHtml(p4?.note || "")}`, event, mount))
    .on("pointerleave", () => hover.hide());
  svg.append("text").attr("x", x("p4")).attr("y", 92).attr("text-anchor", "middle")
    .attr("class", "lineage-band-title").text(p4?.transition_label || "課題達成型へ転換");

  /* 列ヘッダ: 年・期・閣議決定日 */
  periods.forEach((p) => {
    const cx = x(p.key);
    const year = p.decided ? p.decided.slice(0, 4) : "—";
    const decision = fullDateJa(p.decided);
    svg.append("text").attr("x", cx).attr("y", 34).attr("text-anchor", "middle")
      .attr("font-size", 14).attr("font-weight", 600).attr("fill", "#ffb545").text(year);
    svg.append("text").attr("x", cx).attr("y", 50).attr("text-anchor", "middle")
      .attr("font-size", 10.5).attr("fill", "#e9eef7").text(p.label);
    svg.append("text").attr("x", cx).attr("y", 64).attr("text-anchor", "middle")
      .attr("font-size", 8.5).attr("fill", "#4c5a72").text(decision ? `${decision}閣議決定` : "閣議決定日 記録なし");
  });

  /* エッジ（系譜のリボン） */
  const linkGen = d3.linkHorizontal().x((d) => d.x).y((d) => d.y);
  const validEdges = block.edges.filter((e) => nodePos.has(`${e.from_period}::${e.from_item}`) && nodePos.has(`${e.to_period}::${e.to_item}`));
  const edgeGroup = svg.append("g").attr("class", "lineage-edges");
  const edgeSel = edgeGroup.selectAll("path")
    .data(validEdges).join("path")
    .attr("class", (d) => `lineage-edge is-${d.flag}`)
    .attr("d", (d) => linkGen({ source: nodePos.get(`${d.from_period}::${d.from_item}`), target: nodePos.get(`${d.to_period}::${d.to_item}`) }));

  /* 看板消滅のフェードスタブ: 中身の来歴は継続していても、その"名称"はここで途切れることを示す */
  const defs = svg.append("defs");
  const fadeGrad = defs.append("linearGradient").attr("id", "lineage-fade").attr("x1", "0").attr("x2", "1").attr("y1", "0").attr("y2", "0");
  fadeGrad.append("stop").attr("offset", "0%").attr("stop-color", "#8b96ab").attr("stop-opacity", 0.6);
  fadeGrad.append("stop").attr("offset", "100%").attr("stop-color", "#8b96ab").attr("stop-opacity", 0);
  (block.extinct || []).forEach((entry) => {
    entry.name.split(/[／/]/).forEach((part) => {
      const pos = nodePos.get(`${entry.last_period}::${part}`);
      if (!pos) return;
      svg.append("line").attr("class", "lineage-fade-stub")
        .attr("x1", pos.x).attr("y1", pos.y).attr("x2", pos.x + 36).attr("y2", pos.y);
    });
  });

  /* ノード: p2/p7は恒常ラベル、p4はバンド内ラベル、p3/p5/p6はティック+ホバー */
  const nodeGroups = svg.append("g").attr("class", "lineage-nodes").selectAll("g")
    .data(Array.from(nodePos.values())).join("g")
    .attr("class", (d) => {
      const cls = ["lineage-node", `is-${d.period}`];
      if (d.period === "p7" && natStratSet.has(d.item)) cls.push("is-natstrat");
      if (d.period === "p7" && d.item === defenseItem) cls.push("is-first");
      return cls.join(" ");
    })
    .attr("transform", (d) => `translate(${d.x},${d.y})`);

  nodeGroups.append("line").attr("class", "lineage-tick").attr("x1", -6).attr("x2", 6).attr("y1", 0).attr("y2", 0);
  nodeGroups.filter((d) => d.period === "p7" && natStratSet.has(d.item))
    .append("circle").attr("class", "lineage-natstrat-ring").attr("r", 8);

  nodeGroups.filter((d) => d.period === "p2").append("text")
    .attr("x", -12).attr("y", 4).attr("text-anchor", "end").attr("class", "lineage-label")
    .text((d) => lineageShortName(d.item));
  nodeGroups.filter((d) => d.period === "p4").append("text")
    .attr("x", 0).attr("y", -12).attr("text-anchor", "middle").attr("class", "lineage-label lineage-label-p4")
    .text((d) => d.item);
  const p7Nodes = nodeGroups.filter((d) => d.period === "p7");
  p7Nodes.append("text").attr("x", 12).attr("y", 4).attr("text-anchor", "start").attr("class", "lineage-label")
    .each(function (d) {
      const sel = d3.select(this).text(lineageShortName(d.item));
      if (natStratSet.has(d.item)) sel.insert("tspan", ":first-child").attr("class", "lineage-badge-natstrat").text("◎ ");
    });
  p7Nodes.filter((d) => d.item === defenseItem).append("text")
    .attr("x", 12).attr("y", -10).attr("text-anchor", "start").attr("class", "lineage-first-chip").text("初出");

  /* 中間列(p5/p6)は常設の小ラベルを添える（ティックだけでは何の技術か読めない）。
     p3はp2と同名の継続が大半なので、改名された「ものづくり技術」のみラベルを出す。 */
  nodeGroups.filter((d) => d.period === "p5" || d.period === "p6").append("text")
    .attr("x", 0).attr("y", -9).attr("text-anchor", "middle")
    .attr("class", "lineage-label lineage-mid-label")
    .text((d) => lineageShortName(d.item));
  nodeGroups.filter((d) => d.period === "p3" && d.item === "ものづくり技術").append("text")
    .attr("x", 0).attr("y", -9).attr("text-anchor", "middle")
    .attr("class", "lineage-label lineage-mid-label")
    .text((d) => `${lineageShortName(d.item)}（改名）`);

  /* 中間列(p3/p5/p6): ホバー/タップで名称・期を表示 */
  nodeGroups.filter((d) => d.period === "p3" || d.period === "p5" || d.period === "p6").append("rect")
    .attr("class", "lineage-hit").attr("x", -9).attr("y", -9).attr("width", 18).attr("height", 18)
    .on("pointerenter pointermove", (event, d) => hover.show(`<b>${escapeHtml(d.item)}</b><br>${escapeHtml(periodByKey.get(d.period)?.label || d.period)}`, event, mount))
    .on("pointerleave", () => hover.hide());

  /* ホバー: 第7期の領域ラベルで上流の系譜をハイライト、他を減光 */
  p7Nodes.append("rect").attr("class", "lineage-hit lineage-hit-domain").attr("x", -10).attr("y", -11).attr("width", 244).attr("height", 22)
    .on("pointerenter", (event, d) => {
      edgeSel.classed("is-hi", (e) => e.domain === d.item).classed("is-dim", (e) => e.domain !== d.item);
      const touched = new Set([`${d.period}::${d.item}`]);
      block.edges.forEach((e) => { if (e.domain === d.item) { touched.add(`${e.from_period}::${e.from_item}`); touched.add(`${e.to_period}::${e.to_item}`); } });
      nodeGroups.classed("is-hi", (n) => touched.has(`${n.period}::${n.item}`)).classed("is-dim", (n) => !touched.has(`${n.period}::${n.item}`));
    })
    .on("pointerleave", () => {
      edgeSel.classed("is-hi", false).classed("is-dim", false);
      nodeGroups.classed("is-hi", false).classed("is-dim", false);
    });

  if (!REDUCED && gsap) {
    /* リボン(path)自体には is-hi/is-dim 用のCSS opacity transitionがあり、要素個々に
       JSでopacityをtweenするとCSSトランジションと競合して最終値が狂う。そのため
       個々のpathではなく親<g>(lineage-edges)のopacityをまとめてtweenする。 */
    gsap.from(edgeGroup.node(), { opacity: 0, duration: 1.1, ease: "power2.out", scrollTrigger: { trigger: mount, start: "top 80%" } });
    gsap.from(nodeGroups.nodes(), { opacity: 0, duration: 0.7, ease: "power2.out", stagger: 0.004, scrollTrigger: { trigger: mount, start: "top 80%" } });
  }
}

/* ============================================================ 05 tech domains */

function renderDomains(policy) {
  const mount = $("#domains-grid");
  const block = policy?.tech_domains;
  if (!mount) return;
  if (!block || block.status !== "ok" || !Array.isArray(block.domains) || !block.domains.length) {
    mount.innerHTML = '<p class="data-empty">重点技術領域のデータを取得できませんでした。</p>';
    setText("#domains-source", "出典を取得できませんでした。");
    return;
  }
  const natStratSet = new Set(policy?.domain_lineage?.status === "ok" ? policy.domain_lineage.national_strategy || [] : []);
  mount.innerHTML = block.domains.map((d, i) => `
    <div class="policy-domain-tile${natStratSet.has(d.name) ? " is-natstrat" : ""}">
      <span class="policy-domain-no">${String(i + 1).padStart(2, "0")}</span>
      ${natStratSet.has(d.name) ? '<span class="policy-domain-badge" title="国家戦略技術領域（集中投資対象）">◎ 国家戦略</span>' : ""}
      <p class="policy-domain-name">${escapeHtml(d.name)}</p>
      <p class="policy-domain-summary">${escapeHtml(d.summary)}</p>
    </div>`).join("");

  const decisionText = fullDateJa(block.source?.cabinet_decision);
  setText("#domains-lede", `統合イノベーション戦略が定める重点技術${block.domains.length}領域。記述量や掲載順による重み付け・ランキングはしていない。`);
  const correctionNote = " 17領域の初出・一次資料は第7期基本計画本文第3章「新興・基盤技術領域」（2026-03-27閣議決定）で、統合イノベーション戦略はその名称・順序を踏襲して要約文を付加したもの。";
  setText("#domains-source", `出典: ${block.source?.title || ""}${decisionText ? `（${decisionText}閣議決定）` : ""}。${block.note || ""}${correctionNote}`);
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
  const blockKeys = ["plans_history", "plan_language", "strategy_language", "plan7_indicators", "tech_domains", "domain_lineage"];
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
  safeCall("renderStrategyLanguageSpectrum", () => renderStrategyLanguageSpectrum(policy));
  safeCall("renderIndicators", () => renderIndicators(policy));
  safeCall("renderDomainLineage", () => renderDomainLineage(policy));
  safeCall("renderDomains", () => renderDomains(policy));
  initTargetsLazy();

  const entries = blockKeys.map((k) => blockEntry(policy[k], k)).filter(Boolean);
  renderLedgerEntries(entries);
}

init().catch((error) => {
  console.error(error);
  setText("#header-status", "政策データを取得できません");
});
