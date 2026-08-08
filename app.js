const LINE_GROUPS = {
  "会議・審議": "l1", "基本計画": "l1",
  "予算資料": "l2", "公募・支援": "l2",
  "発表・報告": "l3", "評価・検証": "l3", "統計・白書": "l3",
};
const LINE_NAMES = { l1: "審議・制度", l2: "予算・支援", l3: "発信・検証" };
const lineOf = (item) => LINE_GROUPS[item?.document_type] || "l1";

const state = { items: [], sources: [], filters: { search: "", category: "all", source: "all", lines: new Set(["l1", "l2", "l3"]) } };
const $ = (selector) => document.querySelector(selector);

const formatDate = (iso, withTime = false) => {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric", ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}) }).format(date);
};

const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
const safeUrl = (value = "") => /^https:\/\/(www\.)?(cao\.go\.jp|www8\.cao\.go\.jp|mext\.go\.jp|www\.mext\.go\.jp|fsc\.go\.jp)\//.test(value) ? value : "#";

const asList = (preferred, fallback) => Array.isArray(preferred) && preferred.length ? preferred : (Array.isArray(fallback) ? fallback : []);
const itemUrl = (item) => safeUrl(item?.url);

function setText(selector, value) { const element = $(selector); if (element) element.textContent = value; }

function populateFilters() {
  const categories = [...new Set(state.items.map((item) => item.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ja"));
  const sources = [...new Set(state.items.map((item) => item.source).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ja"));
  $("#category-filter").insertAdjacentHTML("beforeend", categories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join(""));
  $("#source-filter").insertAdjacentHTML("beforeend", sources.map((source) => `<option value="${escapeHtml(source)}">${escapeHtml(source)}</option>`).join(""));
}

function visibleItems() {
  const query = state.filters.search.trim().toLocaleLowerCase("ja");
  return state.items.filter((item) => {
    const matchesQuery = !query || [item.title, item.summary, item.source, item.category, ...(item.tags || [])].join(" ").toLocaleLowerCase("ja").includes(query);
    return matchesQuery && state.filters.lines.has(lineOf(item)) && (state.filters.category === "all" || item.category === state.filters.category) && (state.filters.source === "all" || item.source === state.filters.source);
  });
}

function renderFeed() {
  const items = visibleItems();
  const list = $("#feed-list");
  setText("#result-count", `${items.length}件`);
  $("#empty-state").hidden = items.length !== 0;
  list.innerHTML = items.length ? items.map((item) => {
    const sourceHref = itemUrl(item);
    const contentState = item.content_status === "extracted" ? "本文取得済み" : "原典で確認";
    const line = lineOf(item);
    return `<div class="station"><a class="station-cover" href="${escapeHtml(sourceHref)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(item.title)}。公式ページまたはPDFを開く"></a><div class="dot-outer"><span class="dot-inner ${line}"></span></div><div class="station-main"><div class="smeta"><span class="linetag ${line}">${escapeHtml(LINE_NAMES[line])}</span><span class="item-source">${escapeHtml(item.source)}</span></div><h3 class="item-title">${escapeHtml(item.title)}</h3><div class="station-foot"><span class="content-state">${contentState}</span><span class="item-hint">クリックで原典を開く ↗</span><button class="station-preview" type="button" data-preview-id="${escapeHtml(item.id)}">抜粋を見る</button></div></div><div class="station-side"><time class="item-date" datetime="${escapeHtml(item.published_at || "")}">${formatDate(item.published_at)}</time></div></div>`;
  }).join("") : "";
  list.querySelectorAll(".station-preview").forEach((button) => {
    button.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); openDetail(button.dataset.previewId); });
  });
}

function renderLegendCounts() {
  const counts = state.items.reduce((result, item) => { const line = lineOf(item); result[line] = (result[line] || 0) + 1; return result; }, {});
  document.querySelectorAll(".legend-count").forEach((element) => { element.textContent = String(counts[element.dataset.count] || 0); });
}

function renderSources() {
  const sourceItems = state.items.reduce((result, item) => { result[item.source_id] = (result[item.source_id] || 0) + 1; return result; }, {});
  $("#source-list").innerHTML = state.sources.length ? state.sources.map((source) => `<div class="source-row"><div><div class="source-name">${escapeHtml(source.name)}</div><div class="source-kind">${escapeHtml(source.kind || "公式配信")}${source.items !== undefined ? ` / ${sourceItems[source.id] || 0}件掲載` : ""}</div></div><span class="source-status ${source.status === "error" ? "error" : ""}">${source.status === "error" ? "取得エラー" : "運行中"}</span></div>`).join("") : `<p class="side-note">情報源の状態を取得できませんでした。</p>`;
}

function updateItemQuery(itemId) {
  const url = new URL(window.location.href);
  if (itemId) url.searchParams.set("item", itemId);
  else url.searchParams.delete("item");
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

function openDetail(itemId, { updateUrl = true } = {}) {
  const item = state.items.find((candidate) => candidate.id === itemId);
  if (!item) return;
  setText("#dialog-source", `${item.source} / ${LINE_NAMES[lineOf(item)]}`);
  setText("#dialog-title", item.title);
  setText("#dialog-meta", `${formatDate(item.published_at, true)} 公開　·　${item.document_type || "公式更新"}　·　${item.document_role || "公式の事実や進捗を伝える"}`);
  const body = asList(item.body_blocks, []);
  $("#dialog-body").innerHTML = body.length ? body.map((block) => `<p>${escapeHtml(block)}</p>`).join("") : `<p class="dialog-muted">本文を取得できませんでした。公式ページで内容をご確認ください。</p>`;
  setText("#dialog-content-note", item.content_status === "extracted" ? "サイト内表示は取得した本文の抜粋です。正確な内容は原典をご確認ください。" : "本文を取得できませんでした。公式ページで内容をご確認ください。");
  $("#dialog-content-note").classList.toggle("is-error", item.content_status === "unavailable");
  $("#dialog-tags").innerHTML = (item.tags || []).map((tag) => `<span class="tag">#${escapeHtml(tag)}</span>`).join("");
  const link = $("#dialog-link"); link.href = itemUrl(item); link.setAttribute("aria-label", `${item.source}の公式ページを開く`);
  $("#dialog-copy").textContent = "共有リンクをコピー";
  $("#dialog-copy").dataset.itemId = item.id;
  if (updateUrl) updateItemQuery(item.id);
  const dialog = $("#detail-dialog"); if (typeof dialog.showModal === "function") dialog.showModal(); else window.open(safeUrl(item.url), "_blank", "noopener");
}

function setLineDiagramState() {
  const active = state.filters.lines;
  document.querySelectorAll(".route").forEach((path) => {
    const line = path.dataset.line;
    path.classList.toggle("is-dim", active.size < 3 && !active.has(line));
  });
  document.querySelectorAll(".legend-btn").forEach((button) => {
    button.classList.toggle("is-active", active.has(button.dataset.line));
  });
}

function bindInteractions() {
  $("#search").addEventListener("input", (event) => { state.filters.search = event.target.value; renderFeed(); });
  $("#category-filter").addEventListener("change", (event) => { state.filters.category = event.target.value; renderFeed(); });
  $("#source-filter").addEventListener("change", (event) => { state.filters.source = event.target.value; renderFeed(); });
  $("#reset-filters").addEventListener("click", () => {
    state.filters = { search: "", category: "all", source: "all", lines: new Set(["l1", "l2", "l3"]) };
    $("#search").value = ""; $("#category-filter").value = "all"; $("#source-filter").value = "all";
    setLineDiagramState(); renderFeed();
  });
  document.querySelectorAll(".legend-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const line = button.dataset.line;
      if (state.filters.lines.has(line)) state.filters.lines.delete(line); else state.filters.lines.add(line);
      if (!state.filters.lines.size) state.filters.lines = new Set(["l1", "l2", "l3"]);
      setLineDiagramState(); renderFeed();
    });
  });
  document.querySelectorAll(".route").forEach((path) => {
    path.addEventListener("click", () => { state.filters.lines = new Set([path.dataset.line]); setLineDiagramState(); renderFeed(); });
  });
  $("#dialog-close").addEventListener("click", () => $("#detail-dialog").close());
  $("#dialog-copy").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const shareUrl = new URL(window.location.href);
    shareUrl.searchParams.set("item", button.dataset.itemId || "");
    try {
      await navigator.clipboard.writeText(shareUrl.toString());
      button.textContent = "リンクをコピーしました";
    } catch {
      button.textContent = "URLを選択して共有してください";
    }
  });
  $("#detail-dialog").addEventListener("click", (event) => { if (event.target === event.currentTarget) event.currentTarget.close(); });
  $("#detail-dialog").addEventListener("close", () => updateItemQuery(null));
}

async function loadData() {
  try {
    const response = await fetch("data/updates.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    state.items = Array.isArray(payload.items) ? payload.items : [];
    state.sources = Array.isArray(payload.sources) ? payload.sources : [];
    populateFilters(); renderFeed(); renderLegendCounts(); renderSources();
    const okCount = state.sources.filter((source) => source.status === "ok").length;
    setText("#header-status", `${okCount}/${state.sources.length} ソース稼働中`);
    $(".status-dot").classList.add("is-live");
    setText("#hero-count", String(state.items.length).padStart(3, "0"));
    setText("#stat-sources", state.sources.length.toString().padStart(2, "0"));
    setText("#stat-ok", `${okCount}`);
    const generatedAt = payload.generated_at ? formatDate(payload.generated_at, true) : "未取得";
    setText("#hero-meta", `最終取得 ${generatedAt} / JST`);
    setText("#stat-updated", generatedAt.includes(" ") ? generatedAt.split(" ").at(-1) : generatedAt);
    setText("#footer-year", String(new Date().getFullYear()));
    const requestedItem = new URLSearchParams(window.location.search).get("item");
    if (requestedItem) openDetail(requestedItem, { updateUrl: false });
  } catch (error) {
    console.error(error); setText("#header-status", "データを取得できません"); setText("#hero-meta", "データファイルを取得できませんでした"); $("#feed-list").innerHTML = `<div class="empty-state"><span class="empty-mark" aria-hidden="true">!</span><h3>データを読み込めませんでした</h3><p>GitHub Actionsの取得処理、または data/updates.json を確認してください。</p></div>`;
  } finally { $("#feed-list").setAttribute("aria-busy", "false"); }
}

bindInteractions();
loadData();
