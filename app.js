const state = { items: [], sources: [], filters: { search: "", category: "all", source: "all" } };
const $ = (selector) => document.querySelector(selector);

const formatDate = (iso, withTime = false) => {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric", ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}) }).format(date);
};

const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
const safeUrl = (value = "") => /^https:\/\/(www\.)?(cao\.go\.jp|www8\.cao\.go\.jp|mext\.go\.jp|www\.mext\.go\.jp)\//.test(value) ? value : "#";

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
    return matchesQuery && (state.filters.category === "all" || item.category === state.filters.category) && (state.filters.source === "all" || item.source === state.filters.source);
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
    return `<div class="feed-item-shell"><a class="feed-item ${item.importance === "high" ? "is-high" : ""}" href="${escapeHtml(sourceHref)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(item.title)}。公式ページまたはPDFを開く"><div class="timeline-marker" aria-hidden="true"></div><div class="feed-main"><div class="feed-topline"><span class="item-source">${escapeHtml(item.source)}</span><span class="item-type">${escapeHtml(item.category || "科学技術政策")}</span>${item.importance === "high" ? '<span class="item-type item-priority">重要</span>' : ""}</div><h3 class="item-title">${escapeHtml(item.title)}</h3><div class="feed-signal-row"><span class="content-state">${contentState}</span><span class="item-hint">クリックで原典を開く ↗</span></div></div><div class="feed-side"><time class="item-date" datetime="${escapeHtml(item.published_at || "")}">${formatDate(item.published_at)}</time></div></a><button class="feed-preview" type="button" data-preview-id="${escapeHtml(item.id)}">抜粋を見る</button></div>`;
  }).join("") : "";
  list.querySelectorAll(".feed-preview").forEach((button) => {
    button.addEventListener("click", (event) => { event.stopPropagation(); openDetail(button.dataset.previewId); });
  });
}

function renderCategories() {
  const counts = state.items.reduce((result, item) => { const key = item.category || "科学技術政策"; result[key] = (result[key] || 0) + 1; return result; }, {});
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const max = rows[0]?.[1] || 1;
  $("#category-list").innerHTML = rows.length ? rows.map(([name, count]) => `<div class="category-row"><span class="category-name">${escapeHtml(name)}</span><span class="category-value">${count}</span><div class="category-bar"><span style="width:${Math.round((count / max) * 100)}%"></span></div></div>`).join("") : `<p class="side-note">分類できる更新がまだありません。</p>`;
}

function renderSources() {
  const sourceItems = state.items.reduce((result, item) => { result[item.source_id] = (result[item.source_id] || 0) + 1; return result; }, {});
  $("#source-list").innerHTML = state.sources.length ? state.sources.map((source) => `<div class="source-row"><div><div class="source-name">${escapeHtml(source.name)}</div><div class="source-kind">${escapeHtml(source.kind || "公式配信")}${source.items !== undefined ? ` / ${sourceItems[source.id] || 0}件掲載` : ""}</div></div><span class="source-status ${source.status === "error" ? "error" : ""}">${source.status === "error" ? "取得エラー" : "稼働中"}</span></div>`).join("") : `<p class="side-note">情報源の状態を取得できませんでした。</p>`;
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
  setText("#dialog-source", `${item.source} / ${item.category || "科学技術政策"}`);
  setText("#dialog-title", item.title);
  setText("#dialog-meta", `${formatDate(item.published_at, true)} 公開　·　公式更新`);
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

function bindInteractions() {
  $("#search").addEventListener("input", (event) => { state.filters.search = event.target.value; renderFeed(); });
  $("#category-filter").addEventListener("change", (event) => { state.filters.category = event.target.value; renderFeed(); });
  $("#source-filter").addEventListener("change", (event) => { state.filters.source = event.target.value; renderFeed(); });
  $("#reset-filters").addEventListener("click", () => { state.filters = { search: "", category: "all", source: "all" }; $("#search").value = ""; $("#category-filter").value = "all"; $("#source-filter").value = "all"; renderFeed(); });
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
    populateFilters(); renderFeed(); renderCategories(); renderSources();
    setText("#header-status", `${state.sources.filter((source) => source.status === "ok").length}/${state.sources.length} ソース稼働中`);
    $(".status-dot").classList.add("is-live");
    setText("#hero-count", String(state.items.length).padStart(2, "0")); setText("#stat-total", state.items.length.toLocaleString("ja-JP")); setText("#stat-sources", state.sources.length.toString().padStart(2, "0"));
    const generatedAt = payload.generated_at ? formatDate(payload.generated_at, true) : "未取得";
    setText("#hero-meta", `最終取得 ${generatedAt} / JST`); setText("#stat-updated", generatedAt.includes(" ") ? generatedAt.split(" ").at(-1) : generatedAt); setText("#footer-year", String(new Date().getFullYear()));
    const requestedItem = new URLSearchParams(window.location.search).get("item");
    if (requestedItem) openDetail(requestedItem, { updateUrl: false });
  } catch (error) {
    console.error(error); setText("#header-status", "データを取得できません"); setText("#hero-meta", "データファイルを取得できませんでした"); $("#feed-list").innerHTML = `<div class="empty-state"><span class="empty-mark" aria-hidden="true">!</span><h3>データを読み込めませんでした</h3><p>GitHub Actionsの取得処理、または data/updates.json を確認してください。</p></div>`;
  } finally { $("#feed-list").setAttribute("aria-busy", "false"); }
}

bindInteractions();
loadData();
