const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
const formatNumber = (value) => Number(value || 0).toLocaleString("ja-JP");
const shortDate = (iso) => { if (!iso) return "—"; const date = new Date(iso); return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric" }).format(date); };
const safeUrl = (value = "") => /^https:\/\//.test(value) ? value : "#";

let docNumber = 0;
function registryRow({ name, detail, kind, status, count, updated, url }) {
  docNumber += 1;
  const catalog = status !== "ok";
  return `<div class="registry-row"><div class="registry-no">No.<strong>${String(docNumber).padStart(4, "0")}</strong></div><div class="registry-name"><strong>${escapeHtml(name)}</strong><small>${escapeHtml(detail || "")}</small></div><span class="registry-kind">${escapeHtml(kind || "公式データ")}</span><span class="registry-status${catalog ? " is-catalog" : ""}">${catalog ? "カタログ" : "確認済"}</span><span class="registry-updated">${count !== undefined ? `${formatNumber(count)}件` : escapeHtml(updated || "—")}</span>${url ? `<a class="registry-link" href="${escapeHtml(safeUrl(url))}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(name)}の原典を開く">↗</a>` : "<span></span>"}</div>`;
}

async function load() {
  try {
    const [updatesResponse, analyticsResponse] = await Promise.all([fetch("data/updates.json", { cache: "no-store" }), fetch("data/analytics.json", { cache: "no-store" })]);
    if (!updatesResponse.ok || !analyticsResponse.ok) throw new Error("data unavailable");
    const updates = await updatesResponse.json();
    const analytics = await analyticsResponse.json();
    const counts = (updates.items || []).reduce((map, item) => { map[item.source_id] = (map[item.source_id] || 0) + 1; return map; }, {});
    const feeds = (updates.sources || []).map((source) => registryRow({ name: source.name, detail: source.url || source.id, kind: source.kind || "公式フィード", status: source.status, count: counts[source.id] || 0, url: source.url }));
    const stats = (analytics.reality?.sources || []).map((source) => registryRow({ name: source.title, detail: source.id, kind: "e-Stat 統計表", status: source.status, updated: `${analytics.reality?.survey_year || "—"}年`, url: source.url }));
    $("#feed-registry").innerHTML = feeds.join("");
    $("#stats-registry").innerHTML = stats.join("");
    $("#hero-feed-count").textContent = `${(updates.sources || []).length}件`;
    $("#header-status").textContent = `${(updates.sources || []).length}フィード / ${(analytics.reality?.sources || []).length}統計表`;
    const generated = analytics.generated_at ? new Date(analytics.generated_at) : null;
    const generatedLabel = generated && !Number.isNaN(generated.getTime()) ? shortDate(generated) : "—";
    $("#hero-generated").textContent = generatedLabel;
    $("#hero-meta").textContent = generated && !Number.isNaN(generated.getTime()) ? `最終生成 ${new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", dateStyle: "medium", timeStyle: "short" }).format(generated)} / JST` : "生成日時不明";
  } catch (error) {
    console.error(error);
    $("#header-status").textContent = "情報源データを取得できません";
  }
  $("#footer-year").textContent = String(new Date().getFullYear());
}
load();
