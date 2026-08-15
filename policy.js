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
    const linkHint = r.honbun_url ? `<br><span style="color:var(--cn)">クリックで原文へ${r.period === 2 ? "（NDL保存版）" : ""}</span>` : "";
    hover.show(`<b>第${periodText}期 ${escapeHtml(r.name)}</b><br>${escapeHtml(r.fiscal_years)}年度${decisionText ? `・${escapeHtml(decisionText)}閣議決定` : ""}<br>${targetText} / ${actualText}${joint ? `<br>${escapeHtml(joint)}` : ""}${linkHint}`, event, mount);
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

  /* 期ごとの原文リンク行（実<a>要素でキーボード・スクリーンリーダーからも到達可能にする。
     SVG側のクリック領域と重複するが、こちらが正式なアクセシブル経路）。第2期はPDFではなく
     NDL WARP保存版HTMLのため、その旨がわかるラベルにする（honbun_urlの由来はplans_history
     ブロックのnoteを参照）。 */
  const linksMount = $("#history-links");
  if (linksMount) {
    linksMount.innerHTML = rows.map((r) => {
      const label = r.period === 2 ? "第2期(NDL保存版)" : `第${r.period}期`;
      const url = r.honbun_url ? safeUrl(r.honbun_url) : null;
      if (!url || url === "#") return `<span class="policy-period-links-item is-empty">${escapeHtml(label)}（原文リンクなし）</span>`;
      return `<a class="policy-period-links-item" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)} 原文 ↗</a>`;
    }).join("");
  }
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

/* ============================================================ 03 strategy language spectrum */

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

/* ============================================================ 04 strategy document shelf */

/* 統合イノベーション戦略2018〜2026の書架。データはstrategy_languageブロックを再利用する
   （書架専用のブロックは新設しない — source_urls_by_year/decision_dates_by_year/doc_lengths
   がそのまま使える）。背表紙の高さは各年の本文文字数（doc_lengths）に比例した線形スケール、
   判読性のため最小高さ(18%)を設ける。2024年以降は別紙等を含む「全体版」PDFのため対象範囲が
   2018〜2023年（本文のみ）と異なる点をタグと出典注記の両方で明示する。 */
const STRATEGY_SHELF_ZENTAI_YEARS = new Set([2024, 2025, 2026]);

function strategyShelfNote(block) {
  return "原文はいずれも内閣府サイトのPDF。背表紙の高さは本文の文字数に比例（2024年以降は別紙等を含む全体版のため文書の範囲が異なる）。"
    + (block?.note ? ` ${block.note}` : "");
}

function renderStrategyShelf(policy) {
  const mount = $("#strategy-shelf");
  const block = policy?.strategy_language;
  if (!mount) return;
  if (!block || block.status !== "ok" || !Array.isArray(block.years_covered) || !block.years_covered.length
    || !block.source_urls_by_year || !block.decision_dates_by_year || !block.doc_lengths) {
    mount.innerHTML = '<p class="data-empty">統合イノベーション戦略の原文データを取得できませんでした。</p>';
    setText("#strategy-shelf-source", "出典を取得できませんでした。");
    return;
  }
  const years = block.years_covered;
  const lens = years.map((y) => block.doc_lengths[String(y)] || 0);
  const maxLen = d3.max(lens) || 1;

  /* スパイン面は狭いため、完全な日付（フックボックス用）とは別に「M/D決定」の短縮表記を持つ */
  const shortMonthDay = (iso) => {
    if (!iso) return null;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : `${d.getMonth() + 1}/${d.getDate()}決定`;
  };

  const items = years.map((y) => {
    const len = block.doc_lengths[String(y)] || 0;
    const url = safeUrl(block.source_urls_by_year[String(y)] || "");
    const iso = block.decision_dates_by_year[String(y)];
    const decisionText = fullDateJa(iso);
    const decisionShort = shortMonthDay(iso);
    const isZentai = STRATEGY_SHELF_ZENTAI_YEARS.has(y);
    /* 判読性のための最小高さ。全体版タグを持つ年は「全体版」バッジ分の行が1行増えるため、
       タグなしより高い床を設ける（低いと年/決定日/字数の3行とタグが重なって読めなくなる）。 */
    const heightPct = Math.max(isZentai ? 30 : 18, (len / maxLen) * 100);
    return { year: y, len, url: url === "#" ? null : url, decisionText, decisionShort, heightPct, isZentai };
  });

  setText("#strategy-shelf-lede", `統合イノベーション戦略は${years[0]}年から${years[years.length - 1]}年まで${MOBILE ? "毎年" : "毎年閣議決定される"}${years.length}冊。背表紙の高さは本文字数に比例し、クリックすると内閣府の原文PDFが開く。`);
  setText("#strategy-shelf-source", `出典: ${block.source?.title || ""}。${strategyShelfNote(block)}`);

  if (MOBILE) {
    mount.innerHTML = `<div class="policy-shelf-rows">${items.map((it) => {
      const tag = it.isZentai ? '<i class="policy-shelf-tag">全体版</i>' : "";
      const decision = it.decisionText ? `${escapeHtml(it.decisionText)}閣議決定` : "閣議決定日 記録なし";
      const lenText = `${(it.len / 10000).toFixed(1)}万字`;
      if (!it.url) {
        return `<span class="policy-shelf-row is-disabled"><span class="policy-shelf-row-year">${it.year}年${tag}</span><span class="policy-shelf-row-decision">${decision}</span><span class="policy-shelf-row-len">${lenText}</span><span class="policy-shelf-row-link">リンクなし</span></span>`;
      }
      return `<a class="policy-shelf-row" href="${escapeHtml(it.url)}" target="_blank" rel="noopener noreferrer"><span class="policy-shelf-row-year">${it.year}年${tag}</span><span class="policy-shelf-row-decision">${decision}</span><span class="policy-shelf-row-len">${lenText}</span><span class="policy-shelf-row-link">原文 →</span></a>`;
    }).join("")}</div>`;
    return;
  }

  mount.innerHTML = "";
  const hover = hoverBox("#strategy-shelf-hover");
  const rack = document.createElement("div");
  rack.className = "policy-shelf-rack";
  /* 入場アニメ（gsap.from + scaleY + ScrollTrigger）は付けない: この章の直前にch-targets
     （非同期でindicators.json/mobility.jsonを読み込みDOM高さが変わる initTargetsLazy を
     持つ）が来たことで、下の章のScrollTriggerが再生完了後にrefreshされてscaleY:0へ巻き
     戻る不具合を検証で確認した。9本の背表紙は常に見えているべき一次情報のため、CSSの
     静的表示のみにして入場演出は諦める。 */
  items.forEach((it) => {
    const tagName = it.url ? "a" : "div";
    const spine = document.createElement(tagName);
    spine.className = `policy-shelf-spine${it.url ? "" : " is-disabled"}`;
    spine.style.setProperty("--spine-h", `${it.heightPct}%`);
    if (it.url) {
      spine.href = it.url;
      spine.target = "_blank";
      spine.rel = "noopener noreferrer";
    }
    spine.innerHTML = `
      ${it.isZentai ? '<span class="policy-shelf-tag">全体版</span>' : ""}
      <span class="policy-shelf-year">${escapeHtml(String(it.year))}</span>
      <span class="policy-shelf-decision">${escapeHtml(it.decisionShort || "決定日不明")}</span>
      <span class="policy-shelf-len">${escapeHtml((it.len / 10000).toFixed(1))}万字</span>`;
    const showHover = (event) => {
      const decisionText = it.decisionText ? `${escapeHtml(it.decisionText)}閣議決定` : "閣議決定日 記録なし";
      const rangeNote = it.isZentai ? "（別紙等を含む全体版）" : "（本文のみ）";
      const clickNote = it.url ? "<br>クリックで原文PDF(内閣府)" : "<br>原文リンクなし";
      hover.show(`<b>統合イノベーション戦略${it.year}</b> — ${decisionText}<br>本文${(it.len / 10000).toFixed(1)}万字${escapeHtml(rangeNote)}${clickNote}`, event, mount);
    };
    /* ホバーの吹き出しはポインター座標に依存するためpointer系イベントのみで出す
       （キーボードフォーカスは背表紙面に常設の年/決定日/字数表示と:focus-visibleの
       アウトラインで十分に到達可能 — FocusEventはclientX/Yを持たないため流用しない）。 */
    spine.addEventListener("pointerenter", showHover);
    spine.addEventListener("pointermove", showHover);
    spine.addEventListener("pointerleave", () => hover.hide());
    if (!it.url) spine.setAttribute("tabindex", "-1");
    rack.appendChild(spine);
  });
  mount.appendChild(rack);
}

/* ============================================================ 02 indicators */

/* 19指標のうち indicator_observations（data/policy.json）でカバーされない7件だけを持つ
   フォールバック表。indicator.name の完全一致で引く。status は内部的に既存CSS
   （.is-direct/.is-approx/.is-none）と互換の direct/approx/none を使うが、表示ラベルは
   「実測／近い指標／未計測」の3段階（AUDIT_LABEL参照）。sparklineは02b（mobility.json/
   indicators.json の遅延取得）で埋まる直接系列のマウントID、site_linkは計測先への静かな
   矢印リンク。 */
const LEGACY_AUDIT_MAP = {
  "Top10％補正論文数": { status: "approx", note: "サイトの系列は整数カウント法のシェア（NISTEP表4-1-7）。指標の世界順位は分数カウント法で算出法が異なる。" },
  "日本人研究者の長期海外派遣数": { status: "direct", sparkline: "dispatch", siteLink: { href: "people.html#ch-global", label: "人材 — 国際移動へ" } },
  "博士課程入学者数・博士号取得者数": { status: "direct", sparkline: "phd", siteLink: { href: "people.html#ch-phd", label: "人材 — 博士のパイプラインへ" } },
  "第１・２グループ等の大学の若手研究者数（40歳未満の大学本務教員数）": { status: "approx", note: "サイトの系列は全大学本務教員の25〜39歳割合（2022年度20.8%）。指標は研究大学の40歳未満に限る。" },
  "高等教育機関の研究開発支出に占める国内企業拠出割合": { status: "approx", note: "サイトの算出値は2023年度3.18%。指標の現状値（2021年度3.2%）と年度の対応にずれの疑いがあり参考値。" },
  "大学等における民間企業からの共同研究受入額": { status: "approx", note: "サイトの系列は2023年度1,053億円。指標の引用値（1,028億円）と約2%の差（集計版の違い）。" },
  "政府研究開発投資額": { status: "approx", note: "サイトの予算系列は科学技術関係当初予算のみ。指標の60兆円は補正予算等を含む5年累計で範囲が異なる。" },
};
const TARGETS_AUDIT_LABEL = { direct: "実測", approx: "近い指標", none: "未計測" };

/* indicator_observations（data/policy.json、eager）とLEGACY_AUDIT_MAPをindicator名で
   マージする。優先順位はindicator_observations→LEGACY_AUDIT_MAP→未計測。observation.kind
   が"none"のもの（スマートシティ）は必ず未計測。 */
function resolveIndicatorAudit(name, obsByName) {
  const obs = obsByName.get(name);
  if (obs) {
    const status = obs.kind === "none" ? "none" : (obs.match === "proxy" ? "approx" : "direct");
    return { status, note: obs.note || "", observation: obs, siteLink: obs.site_link || null };
  }
  const legacy = LEGACY_AUDIT_MAP[name];
  if (legacy) {
    return { status: legacy.status, note: legacy.note || "", observation: null, sparkline: legacy.sparkline || null, siteLink: legacy.siteLink || null };
  }
  return { status: "none", note: "", observation: null, siteLink: null };
}

function renderTargetsAudit(mount, indicators, obsByName) {
  if (!mount) return;
  const rows = indicators.map((ind) => ({ ind, audit: resolveIndicatorAudit(ind.name, obsByName) }));
  const directCount = rows.filter((r) => r.audit.status === "direct").length;
  const approxCount = rows.filter((r) => r.audit.status === "approx").length;
  const noneCount = rows.filter((r) => r.audit.status === "none").length;
  const cells = rows.map((r) => `<span class="policy-audit-cell is-${r.audit.status}" title="${escapeHtml(r.ind.name)}"></span>`).join("");
  mount.innerHTML = `
    <div class="policy-audit">
      <div class="policy-audit-strip" role="img" aria-label="19指標の測定状況。実測${directCount}件・近い指標${approxCount}件・未計測${noneCount}件">${cells}</div>
      <div class="policy-audit-legend">
        <span class="is-direct"><i aria-hidden="true"></i>実測で追跡（${directCount}）</span>
        <span class="is-approx"><i aria-hidden="true"></i>近い指標のみ（${approxCount}）</span>
        <span class="is-none"><i aria-hidden="true"></i>未計測（${noneCount}）</span>
      </div>
    </div>`;
}

/* indicator_observations の1件分をカード内の「観測値」ブロック用に整形する。
   kind="value"のdataは観測ごとに形が異なる（rank+top10、iso_rank+iec_rank、breakdown、
   alt+components、単純value）ため、存在するフィールドで分岐する。 */
function formatObsValue(obs) {
  const d = obs.data;
  const unit = obs.unit || "";
  if (!d) return null;
  if (Number.isFinite(d.rank)) {
    const top = (d.top10 || []).slice(0, 5).map((t) => `${t.country}${fmtInt(t.count)}`).join(" / ");
    return { big: `世界${d.rank}${unit}`, sub: `${fmtInt(d.count)}件・${d.year}年`, extra: top };
  }
  if (Number.isFinite(d.iso_rank) && Number.isFinite(d.iec_rank)) {
    return { big: `ISO${d.iso_rank}位／IEC${d.iec_rank}位`, sub: `${d.year}年度` };
  }
  if (Array.isArray(d.breakdown)) {
    const parts = d.breakdown.map((b) => `${b.label}${fmtInt(b.value)}`).join("＋");
    const ref = d.reference ? `（参考: ${d.reference.label}${fmtInt(d.reference.value)}）` : "";
    return { big: `${fmtInt(d.value)}${unit}`, sub: `${parts}${ref}・${d.year}年度` };
  }
  if (d.alt && d.components) {
    return { big: `${d.value}${unit}`, sub: `${d.label || ""}（${d.alt.label} ${d.alt.value}${unit}）・${d.year}年度` };
  }
  if (Number.isFinite(d.value)) {
    return { big: `${d.value}${unit}`, sub: `${d.year}年${d.as_of ? `（${d.as_of}）` : ""}` };
  }
  return null;
}

function renderObsValueHtml(obs) {
  const f = formatObsValue(obs);
  if (!f) return "";
  return `<div class="policy-obs">
    <p class="policy-obs-value">${escapeHtml(f.big)}</p>
    <p class="policy-obs-sub">${escapeHtml(f.sub)}</p>
    ${f.extra ? `<p class="policy-obs-extra">${escapeHtml(f.extra)}</p>` : ""}
  </div>`;
}

/* kind="series"の観測（国際共著論文率・官民研究開発投資額・研究時間割合・共用化率）を、
   ヘッドライン数値＋renderMiniSparkのミニグラフとしてマウントに描く。DOMに接続済みの
   要素が必要なため、mount.innerHTML確定後に呼ぶ。 */
function renderObsSeries(container, obs) {
  if (!container) return;
  const series = obs.data?.series;
  const unit = obs.unit || "";
  if (!Array.isArray(series) || !series.length) {
    container.innerHTML = '<p class="policy-spark-empty">系列を取得できません</p>';
    return;
  }
  const last = series[series.length - 1];
  const alt = obs.data.alt;
  const altText = alt ? `・${alt.label} ${alt.value}${unit}（${alt.year}年）` : "";
  const head = document.createElement("div");
  head.className = "policy-obs";
  head.innerHTML = `<p class="policy-obs-value">${escapeHtml(String(last[1]))}${escapeHtml(unit)}</p><p class="policy-obs-sub">${escapeHtml(String(last[0]))}年${escapeHtml(altText)}</p>`;
  container.appendChild(head);
  const sparkMount = document.createElement("div");
  sparkMount.className = "policy-obs-spark-mount";
  container.appendChild(sparkMount);
  renderMiniSpark(sparkMount, series, { ariaLabel: `${obs.indicator}の推移`, height: 40 });
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

  const obsByName = new Map();
  const obsBlock = policy?.indicator_observations;
  if (obsBlock?.status === "ok" && Array.isArray(obsBlock.observations)) {
    obsBlock.observations.forEach((o) => { if (o && o.indicator) obsByName.set(o.indicator, o); });
  }
  const indexByName = new Map(block.indicators.map((ind, i) => [ind.name, i]));

  renderTargetsAudit(auditMount, block.indicators, obsByName);

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
    const audit = resolveIndicatorAudit(ind.name, obsByName);
    const chipHtml = `<span class="policy-audit-chip is-${audit.status}">${escapeHtml(TARGETS_AUDIT_LABEL[audit.status])}</span>`;
    const noteHtml = audit.note ? `<p class="policy-audit-note">${escapeHtml(audit.note)}</p>` : "";
    let obsHtml = "";
    if (audit.observation && audit.observation.kind === "value") {
      obsHtml = renderObsValueHtml(audit.observation);
    } else if (audit.observation && audit.observation.kind === "series") {
      obsHtml = `<div class="policy-obs-spark" id="policy-obs-spark-${indexByName.get(ind.name)}"></div>`;
    } else if (audit.sparkline) {
      obsHtml = `<div class="policy-spark" id="policy-spark-${escapeHtml(audit.sparkline)}"><p class="policy-spark-loading">系列を読み込み中…</p></div>`;
    }
    /* site_linkはpolicy.json由来のサイト内相対リンク。safeUrlは相対URLを"#"に落とすため使えず、
       代わりに「ページ名.html(#アンカー)」形式のみ許可するガードをかける。 */
    const siteHref = audit.siteLink && /^[a-z-]+\.html(#[\w-]+)?$/.test(audit.siteLink.href) ? audit.siteLink.href : null;
    const linkHtml = siteHref
      ? `<a class="policy-obs-link" href="${escapeHtml(siteHref)}">${escapeHtml(audit.siteLink.label)} →</a>`
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
      ${obsHtml}
      ${linkHtml}
      ${ind.source_note ? `<p class="policy-ind-source">${escapeHtml(ind.source_note)}</p>` : ""}
    </div>`;
  };

  mount.innerHTML = groups.map((g) => `
    <div class="policy-ind-group">
      <p class="policy-ind-group-title"><b>${escapeHtml(g.category)}</b>${g.items.length}件</p>
      <div class="policy-ind-grid">${g.items.map(cardHtml).join("")}</div>
    </div>`).join("");

  /* kind="series"の観測はpolicy.jsonに既に載っているため、遅延取得を待たずここで描く
     （kind="value"はcardHtml内でテキストとして直接埋め込み済み）。 */
  block.indicators.forEach((ind) => {
    const obs = obsByName.get(ind.name);
    if (obs && obs.kind === "series") {
      renderObsSeries(document.getElementById(`policy-obs-spark-${indexByName.get(ind.name)}`), obs);
    }
  });

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

/* ------------------------------------------------------ 02b targets lazy data (indicators.json / mobility.json) */

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
      /* 遅延描画でページ高さが変わると、後続章（系譜図など）のScrollTriggerが古い座標のまま
         「開始位置より上に戻った」と誤判定してアニメーションを巻き戻すことがある。
         描画後に発火位置を再計算させる。 */
      if (typeof ScrollTrigger !== "undefined" && ScrollTrigger.refresh) ScrollTrigger.refresh();
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

/* ============================================================ 05 domain lineage */

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

/* ============================================================ 06 tech domains */

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

/* ============================================================ 07 youth programs */

const YOUTH_TARGET_HEX = { "博士学生": "#4fd8ff", "若手研究者": "#ffb545", "機関支援": "#4c5a72" };
const YOUTH_TARGET_CLASS = { "博士学生": "is-phd", "若手研究者": "is-young", "機関支援": "is-inst" };
const YOUTH_CLUSTER_KEYS = ["act_x", "souhatsu", "spring"];

/* デスクトップのレーンラベルは正式名称だと長すぎて左のsticky章レール（左端の00〜07リスト）と
   衝突するため、短縮名を使う（フルネーム・機関名はホバー/モバイルカードで確認できる）。 */
const YOUTH_SHORT_NAME = {
  tokubetsu_kenkyuin: "特別研究員",
  postdoc_10k: "ポスドク一万人計画",
  presto: "さきがけ",
  tenure_track: "テニュアトラック事業",
  takuetsu: "卓越研究員",
  act_x: "ACT-X",
  souhatsu: "創発",
  spring: "SPRING",
  boost: "BOOST",
};

/* 和暦年度（4月始まり）で「現在の年度」を返す。1〜3月は前年の年度扱い（例: 2027年2月は
   2026年度）。この章の他の年度境界（isEnded時のend_fy+1等）と単位を揃えるための基準。 */
function currentFiscalYear() {
  const now = new Date();
  return now.getMonth() < 3 ? now.getFullYear() - 1 : now.getFullYear();
}

function youthPeriodText(p) {
  if (p.end_fy != null) return `${p.start_fy}〜${p.end_fy}年度`;
  if (p.status_note) return `${p.start_fy}年度〜`;
  return `${p.start_fy}年度〜継続中`;
}

function youthChipsHtml(targets) {
  return (targets || []).map((t) => `<span class="youth-chip ${YOUTH_TARGET_CLASS[t] || ""}">${escapeHtml(t)}</span>`).join("");
}

/* MOBILE: SVGの代わりに9事業を縦積みのカードで見せる（name/期間/対象chip/規模/終了・未確認status） */
function renderYouthLifelineMobile(mount, programs) {
  mount.innerHTML = `<div class="youth-cards">${programs.map((p) => {
    const isEnded = p.end_fy != null;
    const isUnclear = !isEnded && !!p.status_note;
    const statusHtml = isEnded
      ? '<span class="youth-status is-ended">終了</span>'
      : isUnclear ? '<span class="youth-status is-unclear">継続状況未確認</span>' : "";
    return `
    <div class="youth-card">
      <div class="youth-card-head">
        <p class="youth-card-name">${escapeHtml(p.name)}<span class="youth-card-agency">${escapeHtml(p.agency)}</span></p>
        ${statusHtml}
      </div>
      <div class="youth-card-meta">
        <span class="youth-card-period">${escapeHtml(youthPeriodText(p))}</span>
        ${youthChipsHtml(p.target)}
      </div>
      <p class="youth-card-scale">${escapeHtml(p.scale)}</p>
    </div>`;
  }).join("")}</div>`;
}

/* デスクトップ: 1985→現在(+制度イベントがあれば先)の横型タイムライン。9レーンをstart_fy昇順に積む。
   終了事業は×+「終了」、継続状況が一次資料で確認できない事業（テニュアトラック）はフェード
   する破線+「継続状況未確認」、それ以外は現在まで実線+継続を示す白抜き丸で終える。 */
function renderYouthLifeline(mount, block, programs) {
  mount.innerHTML = `<div class="youth-legend">
    <span class="is-phd"><i></i>博士学生</span>
    <span class="is-young"><i></i>若手研究者</span>
    <span class="is-inst"><i></i>機関支援（テニュアトラック等）</span>
  </div>`;
  const nowYear = currentFiscalYear();
  const allEventYears = programs.flatMap((p) => (p.events || []).map((e) => e.fy));
  const minYear = d3.min(programs, (p) => p.start_fy);
  const maxYear = Math.max(nowYear + 1, d3.max(allEventYears.length ? allEventYears : [nowYear]) + 1);

  const rowH = 46;
  const margin = { top: 46, right: 46, bottom: 26, left: 214 };
  const height = margin.top + margin.bottom + programs.length * rowH;
  const width = mount.clientWidth || 1100;
  const x = d3.scaleLinear().domain([minYear, maxYear]).range([margin.left, width - margin.right]);

  const svg = d3.select(mount).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img")
    .attr("aria-label", `${minYear}年から${maxYear}年までの若手研究者・博士学生支援${programs.length}事業の実施期間`);

  baseAxis(svg.append("g").attr("class", "axis").attr("transform", `translate(0,${margin.top - 14})`)
    .call(d3.axisTop(x).ticks(Math.min(9, maxYear - minYear)).tickFormat(d3.format("d"))
      .tickSize(-(height - margin.top - margin.bottom + 14))));

  const defs = svg.append("defs");
  const fadeGrad = defs.append("linearGradient").attr("id", "youth-unclear-fade").attr("gradientUnits", "userSpaceOnUse");
  fadeGrad.append("stop").attr("offset", "0%").attr("stop-color", "#4c5a72").attr("stop-opacity", 0.85);
  fadeGrad.append("stop").attr("offset", "100%").attr("stop-color", "#4c5a72").attr("stop-opacity", 0.24);

  const hover = hoverBox("#youth-lifeline-hover");
  const rows = programs.map((p, i) => ({ p, i, y: margin.top + i * rowH + rowH / 2 }));

  rows.forEach(({ p, y }) => {
    const primaryColor = YOUTH_TARGET_HEX[(p.target || [])[0]] || "#8b96ab";
    const isEnded = p.end_fy != null;
    const isUnclear = !isEnded && !!p.status_note;
    const x0 = x(p.start_fy);
    /* isEndedはend_fy+1（最終年度の期末）まで、継続中はnowYear+1（今年度の期末）まで引く —
       どちらも「年度の終わり」で線を止める同じ境界規約にそろえる（片方だけ年度開始で
       止めるとcurrentFiscalYear年度分が視覚的に欠けてしまうため）。 */
    const xEnd = isEnded ? x(p.end_fy + 1) : x(nowYear + 1);

    if (isUnclear) {
      fadeGrad.attr("x1", x0).attr("x2", xEnd);
      svg.append("line").attr("class", "youth-lane-line").attr("x1", x0).attr("x2", xEnd).attr("y1", y).attr("y2", y)
        .attr("stroke", "url(#youth-unclear-fade)").attr("stroke-width", 3.4).attr("stroke-dasharray", "5 4");
      svg.append("text").attr("class", "youth-end-label").attr("x", xEnd + 8).attr("y", y + 3).text("継続状況未確認");
    } else {
      svg.append("line").attr("class", "youth-lane-line").attr("x1", x0).attr("x2", xEnd).attr("y1", y).attr("y2", y)
        .attr("stroke", primaryColor).attr("stroke-width", 3.4).attr("opacity", 0.85);
      if (isEnded) {
        svg.append("text").attr("class", "youth-end-mark").attr("x", xEnd + 4).attr("y", y + 4).attr("fill", primaryColor).text("×");
        svg.append("text").attr("class", "youth-end-label").attr("x", xEnd + 16).attr("y", y + 3).text("終了");
      } else {
        svg.append("circle").attr("class", "youth-continue-dot").attr("cx", xEnd).attr("cy", y).attr("r", 3.4).attr("stroke", primaryColor);
      }
    }

    /* 制度イベント（特別研究員の2021兼業緩和/2024最終年次手当/2027増額予定）。増額予定は
       実線の先（現在より後）に破線で伸ばし、まだ確定していないことを示す。 */
    (p.events || []).forEach((ev) => {
      /* 予定イベントはレーンと同じ「年度期末」境界規約（fy+1）に置く。継続中レーンの終端は
         nowYear+1 なので、予定年度が翌年度なら破線がちょうど1年度分の長さで見える。 */
      const ex = ev.projected ? x(ev.fy + 1) : x(ev.fy);
      if (ev.projected) {
        svg.append("line").attr("x1", xEnd).attr("x2", ex).attr("y1", y).attr("y2", y)
          .attr("stroke", primaryColor).attr("stroke-width", 1.6).attr("stroke-dasharray", "2 3").attr("opacity", 0.55);
        svg.append("circle").attr("cx", ex).attr("cy", y).attr("r", 3).attr("fill", "none")
          .attr("stroke", primaryColor).attr("stroke-width", 1.4).attr("stroke-dasharray", "1.5 1.5");
      } else {
        svg.append("circle").attr("class", "youth-event-tick").attr("cx", ex).attr("cy", y).attr("r", 2.6).attr("fill", primaryColor).attr("stroke", "none");
      }
      svg.append("text").attr("class", "youth-event-label").attr("x", ex).attr("y", y - 9).attr("text-anchor", "middle").text(ev.label);
    });

    svg.append("text").attr("class", "youth-lane-name").attr("x", margin.left - 14).attr("y", y - 3).attr("text-anchor", "end").text(YOUTH_SHORT_NAME[p.key] || p.name);
    svg.append("text").attr("class", "youth-lane-agency").attr("x", margin.left - 14).attr("y", y + 10).attr("text-anchor", "end").text(`${p.agency} / ${p.start_fy}年度〜`);

    svg.append("rect").attr("class", "youth-lane-hit").attr("x", margin.left).attr("y", y - rowH / 2)
      .attr("width", width - margin.left - margin.right).attr("height", rowH)
      .on("pointerenter pointermove", (event) => {
        const targetText = (p.target || []).join("＋");
        hover.show(`<b>${escapeHtml(p.name)}</b>（${escapeHtml(p.agency)} / ${escapeHtml(targetText)}）<br>${escapeHtml(youthPeriodText(p))}${isEnded ? "・終了" : isUnclear ? "・継続状況未確認" : ""}<br>${escapeHtml(p.scale)}<br><span style="color:var(--faint)">出典: ${escapeHtml(p.source?.title || "")}</span>`, event, mount);
      })
      .on("pointerleave", () => hover.hide());
  });

  /* 2019〜2021クラスタ注釈（ACT-X・創発・SPRING）。start_fy昇順の並びでは自然に連続する3行になる */
  const clusterRows = rows.filter((r) => YOUTH_CLUSTER_KEYS.includes(r.p.key));
  if (clusterRows.length === 3) {
    const top = clusterRows[0].y - rowH / 2 + 6;
    const bottom = clusterRows[clusterRows.length - 1].y + rowH / 2 - 6;
    const bx = x(d3.min(clusterRows, (r) => r.p.start_fy)) - 20;
    svg.append("path").attr("class", "youth-cluster-bracket").attr("d", `M${bx + 6},${top} H${bx} V${bottom} H${bx + 6}`);
    svg.append("text").attr("class", "youth-cluster-label").attr("x", bx - 8).attr("y", (top + bottom) / 2 + 3).attr("text-anchor", "end")
      .text("3年間に新設が集中");
  }

  /* 注: レーン本体（youth-lane-line）は入場アニメーションを付けない。opacity付きの
     gsap.from()+ScrollTriggerの組み合わせで検証したところ、アニメーション自体は
     progress=1まで完了する（GSAPは正常に動く）にもかかわらず要素のopacityが0のまま
     残る既知の再現性ある不具合が確認できたため、主情報であるレーンの可視性を優先し、
     静的に描画する（他章の入場演出とは異なるが、正確な表示を最優先する）。 */
}

/* 図B(1) 年間の新規採用・採択（人/年度、フロー量） */
function renderYouthAnnual(policy) {
  const mount = $("#youth-annual");
  const block = policy?.youth_programs;
  if (!mount) return;
  const data = block?.status === "ok" ? block.annual_new : null;
  if (!data || !Array.isArray(data.items) || !data.items.length) {
    mount.innerHTML = '<p class="data-empty">新規採用・採択のデータを取得できませんでした。</p>';
    setText("#youth-annual-source", "出典を取得できませんでした。");
    return;
  }
  const maxV = d3.max(data.items, (d) => d.value) || 1;
  mount.innerHTML = `<div class="youth-annual-bars">${data.items.map((d) => `
    <div class="youth-annual-row">
      <span class="youth-annual-label">${escapeHtml(d.label)}</span>
      <span class="youth-annual-track"><span class="youth-annual-fill${d.key === "souhatsu" ? " is-souhatsu" : ""}" style="width:${((d.value / maxV) * 100).toFixed(1)}%"></span></span>
      <span class="youth-annual-value">${fmtInt(d.value)}<small>${escapeHtml(d.fy_label)}</small></span>
    </div>`).join("")}</div>`;
  setText("#youth-annual-source", `単位: ${data.unit}。${data.note || ""}`);
}

/* 図B(2) ある年度に支援を受けている人数（人、ストック量）。SPRINGの単一値と、
   生活費相当額受給の博士学生数を政府目標とのバレット比較（.policy-ind-gauge を再利用）で示す。 */
function renderYouthStock(policy) {
  const mount = $("#youth-stock");
  const block = policy?.youth_programs;
  if (!mount) return;
  const data = block?.status === "ok" ? block.current_stock : null;
  if (!data) {
    mount.innerHTML = '<p class="data-empty">受給者数のデータを取得できませんでした。</p>';
    setText("#youth-stock-source", "出典を取得できませんでした。");
    return;
  }
  const items = Array.isArray(data.items) ? data.items : [];
  const springItem = items.find((d) => d.key === "spring");
  const ls = data.living_support && Number.isFinite(data.living_support.value) ? data.living_support : null;
  const targetValue = ls?.target && Number.isFinite(ls.target.value) ? ls.target.value : null;
  const scaleMax = ls ? Math.max(ls.value, targetValue || 0) * 1.08 : 0;
  const curPct = ls && scaleMax ? (ls.value / scaleMax) * 100 : 0;
  const tgtPct = ls && targetValue != null && scaleMax ? (targetValue / scaleMax) * 100 : 0;
  mount.innerHTML = `
    ${springItem ? `<div class="fig-headline-stat"><b>${fmtInt(springItem.value)}<small>人</small></b><span>${escapeHtml(springItem.label)}（${escapeHtml(springItem.fy_label)}${springItem.note ? `・${escapeHtml(springItem.note)}` : ""}）</span></div>` : ""}
    ${ls ? `
    <div class="youth-stock-support">
      <p class="youth-stock-support-label">${escapeHtml(ls.note || "")}</p>
      <div class="fig-headline-stat"><b>${fmtInt(ls.value)}<small>人</small></b><span>${escapeHtml(String(ls.fy))}年度${targetValue != null ? `・目標 ${fmtInt(targetValue)}人（${escapeHtml(String(ls.target.fy))}年度、${escapeHtml(ls.target.note || "")}）` : ""}</span></div>
      <div class="policy-ind-gauge"><i style="width:${curPct.toFixed(1)}%"></i>${targetValue != null ? `<b style="left:${tgtPct.toFixed(1)}%"></b>` : ""}</div>
    </div>` : ""}`;
  setText("#youth-stock-source", `単位: ${data.unit}。出典: ${block.overview?.source?.title || ""}`);
}

/* (c) 採用率チップ行（R8採用分、JSPS特別研究員） */
function renderYouthRates(policy) {
  const mount = $("#youth-rates");
  const block = policy?.youth_programs;
  if (!mount) return;
  const data = block?.status === "ok" ? block.adoption_rates : null;
  if (!data || !Array.isArray(data.items) || !data.items.length) {
    mount.innerHTML = "";
    return;
  }
  mount.innerHTML = data.items.map((d) => `
    <div class="youth-rate-chip">
      <p class="youth-rate-chip-label">${escapeHtml(d.label)} 採用率（${escapeHtml(data.fy_label)}）</p>
      <p class="youth-rate-chip-value">${escapeHtml(String(d.rate))}%</p>
      ${d.note ? `<p class="youth-rate-chip-note">${escapeHtml(d.note)}</p>` : ""}
    </div>`).join("");
}

function renderYouthPrograms(policy) {
  const lifelineMount = $("#youth-lifeline");
  const block = policy?.youth_programs;
  /* lifeline以外の3パネル（annual/stock/rates）は各自block未取得時のフォールバックHTML
     を持っているため、lifeline側が失敗してもここで早期returnせず必ず呼ぶ
     （途中の失敗で「出典を確認中」のプレースホルダのまま止まった見た目にしないため）。 */
  if (!block || block.status !== "ok" || !Array.isArray(block.programs) || !block.programs.length) {
    if (lifelineMount) lifelineMount.innerHTML = '<p class="data-empty">若手研究者支援制度のデータを取得できませんでした。</p>';
    setText("#youth-lifeline-source", "出典を取得できませんでした。");
    setText("#youth-source", "出典を取得できませんでした。");
  } else {
    const programs = [...block.programs].sort((a, b) => a.start_fy - b.start_fy);

    setText("#youth-lede", "国は若手研究者をどう支えてきたか。1996年のポスドク一万人計画から、2020〜2021年の創発・SPRINGまで — 「安定したポストを用意する」型の事業は姿を消し、「経済支援と研究費を配る」型が並んだ。");
    setText("#youth-lifeline-source", `出典: ${block.source?.title || ""}。${block.note || ""}`);
    setText("#youth-source", `出典: ${block.source?.title || ""}。${block.note || ""}`);

    if (lifelineMount) {
      if (MOBILE) renderYouthLifelineMobile(lifelineMount, programs);
      else renderYouthLifeline(lifelineMount, block, programs);
    }
  }

  safeCall("renderYouthAnnual", () => renderYouthAnnual(policy));
  safeCall("renderYouthStock", () => renderYouthStock(policy));
  safeCall("renderYouthRates", () => renderYouthRates(policy));
}

/* ================================================================ STI baseline */

function renderStiBaseline(sti) {
  const block = sti?.status === "ok" ? sti : null;
  const series = block?.series;
  const colors = { Japan: "#ffb545", "United States": "#4fd8ff", Germany: "#8d7fb0", France: "#5ad8a1", "United Kingdom": "#c9a76a", China: "#ef6d78", Korea: "#a7b4cc", JapanTop10: "#f48fb1", JapanTop1: "#e05a8b" };
  const labels = { Japan: "日本", "United States": "米国", Germany: "ドイツ", France: "フランス", "United Kingdom": "英国", China: "中国", Korea: "韓国", JapanTop10: "日本Top10%", JapanTop1: "日本Top1%" };
  const mount = (id) => $(id);

  if (!block || !series) {
    setText("#sti-lede", "NISTEPの科学技術指標データを取得できませんでした。");
    ["#sti-intensity", "#sti-researchers", "#sti-papers"].forEach((id) => { if (mount(id)) mount(id).innerHTML = '<p class="data-empty">データを取得できませんでした。</p>'; });
    setText("#sti-source", "出典を取得できませんでした。");
    return;
  }

  const draw = (id, rows, keys, options = {}) => {
    const target = mount(id);
    if (!target || !rows?.length) return;
    target.innerHTML = "";
    const width = target.clientWidth || 960;
    const height = options.height || (MOBILE ? 280 : 330);
    const margin = { top: 30, right: 18, bottom: 42, left: options.left || 52 };
    const x = d3.scaleLinear().domain(d3.extent(rows, (d) => d.year)).range([margin.left, width - margin.right]);
    const values = rows.flatMap((row) => keys.map((key) => row[key])).filter((value) => Number.isFinite(value));
    const y = d3.scaleLinear().domain(options.domain || [0, (d3.max(values) || 1) * 1.12]).nice().range([height - margin.bottom, margin.top]);
    const svg = d3.select(target).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img").attr("aria-label", options.aria || "科学技術指標の時系列");
    baseAxis(svg.append("g").attr("class", "axis").attr("transform", `translate(${margin.left},0)`).call(d3.axisLeft(y).ticks(5).tickFormat(options.tickFormat || ((v) => v)).tickSize(-(width - margin.left - margin.right))));
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - margin.bottom})`).call(d3.axisBottom(x).ticks(MOBILE ? 4 : 7).tickFormat(d3.format("d"))).select(".domain").attr("stroke", "#1c2839");
    const line = d3.line().defined((d) => Number.isFinite(d.value)).x((d) => x(d.year)).y((d) => y(d.value));
    keys.forEach((key) => {
      const points = rows.map((row) => ({ year: row.year, value: row[key] }));
      svg.append("path").datum(points).attr("fill", "none").attr("stroke", colors[key] || "#a7b4cc").attr("stroke-width", key === "Japan" ? 2.6 : 1.25).attr("opacity", key === "Japan" ? 1 : .78).attr("d", line);
      const last = points.filter((d) => Number.isFinite(d.value)).at(-1);
      if (last && !MOBILE) svg.append("text").attr("class", "chart-value sti-end-label").attr("x", x(last.year) - 4).attr("y", y(last.value) - 7).attr("text-anchor", "end").attr("fill", colors[key] || "#a7b4cc").text(`${labels[key]} ${options.valueFormat ? options.valueFormat(last.value) : d3.format(".1f")(last.value)}`);
    });
    const legend = svg.append("g").attr("class", "sti-legend").attr("transform", `translate(${margin.left},8)`);
    keys.forEach((key, i) => {
      const lx = (i % (MOBILE ? 2 : 4)) * (MOBILE ? 105 : 142);
      const ly = Math.floor(i / (MOBILE ? 2 : 4)) * 15;
      legend.append("line").attr("x1", lx).attr("x2", lx + 15).attr("y1", ly).attr("y2", ly).attr("stroke", colors[key] || "#a7b4cc").attr("stroke-width", key === "Japan" ? 2.5 : 1.4);
      legend.append("text").attr("x", lx + 21).attr("y", ly + 3).text(labels[key]).attr("fill", colors[key] || "#a7b4cc");
    });
  };

  const intensity = series.rd_intensity?.years || [];
  const researchers = series.researchers?.years || [];
  const papers = series.paper_shares?.years || [];
  draw("#sti-intensity", intensity, ["Japan", "United States", "Germany", "France", "United Kingdom", "China", "Korea"], { domain: [0, 6], tickFormat: (v) => `${v}%`, aria: "主要国の研究開発費の対GDP比率の推移" });
  draw("#sti-researchers", (() => {
    const base = researchers.find((row) => row.year === 2005);
    if (!base) return [];
    return researchers.map((row) => ({ year: row.year, ...Object.fromEntries(Object.keys(labels).map((key) => [key, Number.isFinite(row[key]) && Number.isFinite(base[key]) ? row[key] / base[key] * 100 : null])) }));
  })(), ["Japan", "United States", "Germany", "France", "United Kingdom", "China", "Korea"], { domain: [0, 420], tickFormat: (v) => `${v}`, aria: "主要国の研究者数の推移、2005年を100とした指数", valueFormat: (v) => `${d3.format(".0f")(v)}` });
  draw("#sti-papers", papers, ["Japan", "China", "JapanTop10", "JapanTop1"], { domain: [0, 50], tickFormat: (v) => `${v}%`, aria: "日本と中国の論文シェアおよび日本の注目論文シェアの推移" });

  const intensityYears = intensity.filter((d) => Number.isFinite(d.Japan)).map((d) => d.year);
  const paperYears = papers.filter((d) => Number.isFinite(d.Japan)).map((d) => d.year);
  setText("#sti-intensity-years", intensityYears.length ? `${Math.min(...intensityYears)}–${Math.max(...intensityYears)}` : "");
  setText("#sti-papers-years", paperYears.length ? `${Math.min(...paperYears)}–${Math.max(...paperYears)}` : "");
  setText("#sti-intensity-source", `出典: ${block.source.title} 表${series.rd_intensity.table}。${series.rd_intensity.unit}。`);
  setText("#sti-researchers-source", `出典: ${block.source.title} 表${series.researchers.table}。${series.researchers.note}`);
  setText("#sti-papers-source", `出典: ${block.source.title} 表${series.paper_shares.table}。${series.paper_shares.note}`);
  setText("#sti-source", `出典: ${block.source.title}（${block.report_number}）。${block.method_note}`);

  const firstIntensity = intensity.find((d) => d.year === 2005)?.Japan;
  const lastIntensity = intensity.filter((d) => Number.isFinite(d.Japan)).at(-1)?.Japan;
  const firstResearcher = researchers.find((d) => d.year === 2005)?.Japan;
  const lastResearcher = researchers.filter((d) => Number.isFinite(d.Japan)).at(-1)?.Japan;
  const firstPaper = papers.find((d) => d.year === 1991)?.Japan;
  const lastPaper = papers.filter((d) => Number.isFinite(d.Japan)).at(-1)?.Japan;
  const facts = [
    { label: "研究開発費/GDP", value: `${firstIntensity?.toFixed(1) || "—"}% → ${lastIntensity?.toFixed(1) || "—"}%`, note: "日本は投資比率を維持・上昇" },
    { label: "研究者数", value: firstResearcher && lastResearcher ? `${d3.format(",")(Math.round(firstResearcher))} → ${d3.format(",")(Math.round(lastResearcher))}` : "—", note: "国際比較では伸びの差が見える" },
    { label: "日本の論文シェア", value: firstPaper && lastPaper ? `${firstPaper.toFixed(1)}% → ${lastPaper.toFixed(1)}%` : "—", note: "量と注目度は別の指標" },
  ];
  const reading = $("#sti-reading");
  if (reading) reading.innerHTML = facts.map((fact) => `<div class="sti-reading-card"><span>${escapeHtml(fact.label)}</span><strong>${escapeHtml(fact.value)}</strong><small>${escapeHtml(fact.note)}</small></div>`).join("");
}

function renderStiIntro(sti) {
  const mount = $("#sti-intro-grid");
  if (!mount || !sti?.source) return;
  const cards = [
    ["約160", "指標本体", "研究開発費・人材・高等教育・アウトプット・イノベーションの5カテゴリー"],
    ["1991", "初公表", "日本の科学技術活動を客観的・定量的に把握するための基礎資料"],
    ["2005–", "毎年公表", "2005年以降は速報性を重視し、基本指標を毎年更新"],
    ["5章", "観測範囲", "資金から研究成果、技術・産業、イノベーションまで"],
  ];
  mount.innerHTML = cards.map(([value, label, note]) => `<div class="sti-intro-card"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span><small>${escapeHtml(note)}</small></div>`).join("");
  setText("#sti-source", `出典: ${sti.source.title}（${sti.report_number}）。${sti.method_note}`);
}

function renderStiCatalog(catalog) {
  const grid = $("#sti-catalog-grid");
  const search = $("#sti-catalog-search");
  const chapter = $("#sti-catalog-chapter");
  const kind = $("#sti-catalog-kind");
  const summary = $("#sti-catalog-summary");
  if (!grid || !catalog?.items?.length) {
    if (grid) grid.innerHTML = '<p class="data-empty">指標カタログを取得できませんでした。</p>';
    return;
  }
  const pageMap = { "第1章": "money.html", "第2章": "people.html", "第3章": "people.html", "第4章": "papers.html", "第5章": "money.html", "コラム": "policy.html" };
  const chapterNames = [...new Set(catalog.items.map((item) => item.chapter))];
  chapterNames.forEach((name) => chapter?.insertAdjacentHTML("beforeend", `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`));
  const render = () => {
    const query = (search?.value || "").trim().toLowerCase();
    const selectedChapter = chapter?.value || "all";
    const selectedKind = kind?.value || "all";
    const rows = catalog.items.filter((item) => {
      const text = `${item.number} ${item.title} ${item.chapter}`.toLowerCase();
      return (!query || text.includes(query)) && (selectedChapter === "all" || item.chapter === selectedChapter) && (selectedKind === "all" || item.kind === selectedKind);
    });
    if (summary) summary.textContent = `${rows.length} / ${catalog.items.length}件を表示 — 指標本体 ${catalog.indicator_count}件、コラム ${catalog.items.filter((item) => item.kind === "column").length}件`;
    grid.innerHTML = rows.map((item) => {
      const chapterKey = Object.keys(pageMap).find((key) => item.chapter.startsWith(key)) || "政策";
      const page = pageMap[chapterKey] || "policy.html";
      return `<article class="sti-catalog-card"><div class="sti-catalog-card-head"><span class="sti-catalog-number">${escapeHtml(item.number)}</span><span class="sti-catalog-kind">${item.kind === "column" ? "COLUMN" : "INDICATOR"}</span></div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.chapter)}</p><div class="sti-catalog-links"><a href="${page}">${escapeHtml(chapterKey)}で見る</a>${item.excel_url ? `<a href="${safeUrl(item.excel_url)}" target="_blank" rel="noopener noreferrer">Excel ↗</a>` : ""}</div></article>`;
    }).join("") || '<p class="data-empty">条件に一致する指標はありません。</p>';
  };
  [search, chapter, kind].forEach((node) => node?.addEventListener(node === search ? "input" : "change", render));
  setText("#sti-catalog-source", `出典: ${catalog.source.title}。${catalog.note}`);
  render();
}

/* ==================================================================== boot */

async function init() {
  bootFooter();
  initRail();
  let policy = null;
  let sti = null;
  let stiCatalog = null;
  try {
    policy = await fetchJson("data/policy.json");
    sti = await fetchJson("data/science_technology_indicators.json");
    stiCatalog = await fetchJson("data/science_technology_indicator_catalog.json");
  } catch (error) {
    console.error(error);
  }
  const blockKeys = ["plans_history", "plan_language", "strategy_language", "plan7_indicators", "tech_domains", "domain_lineage", "indicator_observations", "youth_programs"];
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
  safeCall("renderStiIntro", () => renderStiIntro(sti));
  safeCall("renderStiCatalog", () => renderStiCatalog(stiCatalog));
  safeCall("renderLanguageSpectrum", () => renderLanguageSpectrum(policy));
  safeCall("renderIndicators", () => renderIndicators(policy));
  safeCall("renderStrategyLanguageSpectrum", () => renderStrategyLanguageSpectrum(policy));
  safeCall("renderStrategyShelf", () => renderStrategyShelf(policy));
  safeCall("renderDomainLineage", () => renderDomainLineage(policy));
  safeCall("renderDomains", () => renderDomains(policy));
  safeCall("renderYouthPrograms", () => renderYouthPrograms(policy));
  initTargetsLazy();

  const entries = blockKeys.map((k) => blockEntry(policy[k], k)).filter(Boolean);
  if (sti?.source?.title) entries.push({ title: sti.source.title, url: sti.source.url || "", status: sti.status || "ok" });
  if (stiCatalog?.source?.title) entries.push({ title: stiCatalog.source.title, url: stiCatalog.source.url || "", status: stiCatalog.status || "ok" });
  /* 戦略の書架はstrategy_languageブロックを再利用する専用章のため、台帳にも別行として
     明示する（同一ブロックの別視点利用であることをtitleの違いで示す）。 */
  if (policy.strategy_language?.status === "ok") {
    entries.push({
      title: "統合イノベーション戦略 各年版 本文/全体版PDF一覧（戦略の書架）",
      url: policy.strategy_language.source?.url || "",
      status: policy.strategy_language.status,
    });
  }
  /* indicator_observations は observations[] ごとに別々の一次資料を持つため、台帳にも
     観測ごとのsourceを個別行として展開する（renderLedgerEntriesがtitleで重複排除する）。 */
  if (policy.indicator_observations?.status === "ok" && Array.isArray(policy.indicator_observations.observations)) {
    policy.indicator_observations.observations.forEach((obs) => {
      if (obs?.source?.title) entries.push({ title: obs.source.title, url: obs.source.url || "", status: "ok" });
    });
  }
  /* 若手への投資: 事業ごとに機関(JSPS/JST/MEXT)が異なる別々の一次資料を持つため、台帳にも
     事業ごとのsourceを個別行として展開する（indicator_observationsと同じ流儀）。 */
  if (policy.youth_programs?.status === "ok" && Array.isArray(policy.youth_programs.programs)) {
    policy.youth_programs.programs.forEach((p) => {
      (p.sources || (p.source ? [p.source] : [])).forEach((s) => {
        if (s?.title) entries.push({ title: s.title, url: s.url || "", status: "ok" });
      });
    });
  }
  renderLedgerEntries(entries);
}

init().catch((error) => {
  console.error(error);
  setText("#header-status", "政策データを取得できません");
});
