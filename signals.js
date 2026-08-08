/* SCIENCE SIGNAL / SIGNALS — 政策・予算の最新情報コンソール。obs-core.js の後に読み込む。 */
"use strict";

const parseList = (value) => {
  if (Array.isArray(value)) return value;
  return [];
};

function initConsole(updates) {
  const feed = $("#live-feed");
  if (!feed) return;
  const items = [...(updates?.items || [])]
    .sort((a, b) => String(b.published_at || "").localeCompare(String(a.published_at || "")));
  if (!items.length) { feed.innerHTML = '<p class="data-empty">シグナルを取得できませんでした。</p>'; return; }

  let typeFilter = "all";
  let sourceFilter = "all";
  let query = "";

  /* filter chips built from the data itself */
  const counts = (key) => {
    const map = new Map();
    for (const item of items) {
      const v = item[key] || "その他";
      map.set(v, (map.get(v) || 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  };
  const typeMount = $("#signal-types");
  if (typeMount) {
    typeMount.innerHTML = `<button class="is-active" data-type="all">すべて ${items.length}</button>`
      + counts("document_type").map(([t, n]) => `<button data-type="${escapeHtml(t)}">${escapeHtml(t)} ${n}</button>`).join("");
  }
  const sourceMount = $("#signal-sources");
  if (sourceMount) {
    sourceMount.innerHTML = `<button class="is-active" data-source="all">すべて</button>`
      + counts("source").map(([s, n]) => `<button data-source="${escapeHtml(s)}">${escapeHtml(s)} ${n}</button>`).join("");
  }

  const matches = (item) => (typeFilter === "all" || (item.document_type || "その他") === typeFilter)
    && (sourceFilter === "all" || (item.source || "その他") === sourceFilter)
    && (!query || `${item.title || ""}${item.ai_summary || ""}${item.source || ""}`.includes(query));

  function render() {
    const list = items.filter(matches);
    const now = Date.now();
    if (!list.length) {
      feed.innerHTML = '<p class="data-empty">条件に合う更新はありません。</p>';
    } else {
      feed.innerHTML = list.map((item, index) => {
        const fresh = item.published_at && now - new Date(item.published_at).getTime() < 1000 * 60 * 60 * 24 * 4;
        const points = parseList(item.ai_points);
        const hasDetail = Boolean(points.length || item.ai_why_it_matters || item.document_role);
        return `
        <div class="signal-row${fresh ? " is-fresh" : ""}${hasDetail ? " has-detail" : ""}" data-index="${index}">
          <span class="signal-date">${shortDate(item.published_at)}</span>
          <div class="signal-main">
            <a class="signal-title" href="${escapeHtml(safeUrl(item.url))}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a>
            <p class="signal-meta">${escapeHtml(item.source || "")}${item.ai_summary ? ` — ${escapeHtml(item.ai_summary)}` : ""}</p>
            ${hasDetail ? `
            <div class="signal-detail">
              ${item.document_role ? `<p><b>文書の役割</b> ${escapeHtml(item.document_role)}</p>` : ""}
              ${points.length ? `<ul>${points.map((p) => `<li>${escapeHtml(p)}</li>`).join("")}</ul>` : ""}
              ${item.ai_why_it_matters ? `<p><b>なぜ重要か</b> ${escapeHtml(item.ai_why_it_matters)}</p>` : ""}
              <p class="signal-detail-note">要約・要点はローカルLLMによる補助情報。必ず原典を確認のこと。</p>
            </div>` : ""}
          </div>
          <span class="signal-type">${escapeHtml(item.document_type || "")}</span>
        </div>`;
      }).join("");
    }
    setText("#live-lede", `内閣府・文部科学省などの政府公式ページから3時間ごとに取得した更新。全${fmtInt(items.length)}件中${fmtInt(list.length)}件を表示。行をクリックすると要点が開く。`);
  }

  feed.addEventListener("click", (event) => {
    if (event.target.closest("a")) return;
    const row = event.target.closest(".signal-row.has-detail");
    if (row) row.classList.toggle("is-open");
  });
  $("#signal-types")?.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-type]");
    if (!button) return;
    typeFilter = button.dataset.type;
    $$("#signal-types button").forEach((b) => b.classList.toggle("is-active", b === button));
    render();
  });
  $("#signal-sources")?.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-source]");
    if (!button) return;
    sourceFilter = button.dataset.source;
    $$("#signal-sources button").forEach((b) => b.classList.toggle("is-active", b === button));
    render();
  });
  $("#signal-search")?.addEventListener("input", (event) => {
    query = event.target.value.trim();
    render();
  });

  render();
  if (!REDUCED && gsap) {
    gsap.from(feed.querySelectorAll(".signal-row:nth-child(-n+14)"), { opacity: 0, y: 14, duration: 0.5, stagger: 0.05, ease: "power2.out", scrollTrigger: { trigger: feed, start: "top 82%" } });
  }

  const board = $("#source-board");
  if (board) {
    const rows = (updates?.sources || []).map((s) => `
      <div class="board-row"><b>${escapeHtml(s.name)}</b><span class="${s.status === "ok" ? "board-ok" : "board-ng"}">${s.status === "ok" ? `${fmtInt(s.items || 0)}件` : "ERROR"}</span></div>`).join("");
    board.insertAdjacentHTML("beforeend", rows);
    const generated = updates?.generated_at ? new Date(updates.generated_at) : null;
    if (generated && !Number.isNaN(generated.getTime())) {
      board.insertAdjacentHTML("beforeend", `<div class="board-row"><b>最終巡回</b><span>${new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(generated)}</span></div>`);
    }
  }
}

/* ================================================================ boot */

async function init() {
  bootFooter();
  initRail();
  const [updatesResult] = await Promise.allSettled([fetchJson("data/updates.json")]);
  const updates = updatesResult.status === "fulfilled" ? updatesResult.value : null;
  if (!updates) {
    setText("#header-status", "シグナルを取得できません");
    return;
  }
  $("#header-status-dot")?.classList.add("is-live");
  const itemCount = (updates.items || []).length;
  setText("#header-status", `観測中 — 政策シグナル${fmtInt(itemCount)}件 / 3時間ごと巡回`);
  const title = $("#signals-title");
  if (title) title.innerHTML = `政策シグナル、<em>${fmtInt(itemCount)}件</em>。`;

  initConsole(updates);
  renderLedgerEntries((updates.sources || []).map((s) => ({
    title: `政府公式フィード — ${s.name}`, url: s.url, status: s.status === "ok" ? "ok" : "unavailable",
  })));
}

init().catch((error) => {
  console.error(error);
  setText("#header-status", "シグナルを取得できません");
});
