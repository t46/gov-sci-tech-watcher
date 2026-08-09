/* THE OBSERVATORY — 共有コア（全ページで最初に読み込む）
   helpers / palette / axes / rail / ledger. ページ固有の描画は各ページのJSにある。 */
"use strict";

const d3 = window.d3;
const gsap = window.gsap;
if (gsap && window.ScrollTrigger) gsap.registerPlugin(window.ScrollTrigger);

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[ch]));
const safeUrl = (value = "") => (/^https?:\/\//.test(value) ? value : "#");
const setText = (selector, text) => { const node = $(selector); if (node) node.textContent = text; };
const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const MOBILE = window.matchMedia("(max-width: 760px)").matches;

const COLORS = { jp: "#ffb545", us: "#a7b4cc", de: "#64748f", fr: "#59687f", gb: "#71809b", cn: "#4fd8ff", kr: "#8d7fb0", eu27: "#445370" };
const SHORT = { jp: "日本", us: "米国", de: "独", fr: "仏", gb: "英", cn: "中国", kr: "韓", eu27: "EU" };

const fmtInt = (value) => Number(value ?? 0).toLocaleString("ja-JP");
const fmtPct = (value, digits = 1) => `${Number(value).toFixed(digits)}%`;
const fmtMan = (value) => `${(value / 10000).toFixed(1)}万`;
const fmtCho = (millionYen) => `${(millionYen / 1e6).toFixed(1)}兆円`;
const shortDate = (iso) => {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric" }).format(date);
};

function fitCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width: rect.width, height: rect.height };
}

const seriesMap = (block, name = "series") => Object.fromEntries((block?.[name] || []).map((s) => [s.key, s.values]));
const lastPoint = (values = []) => values[values.length - 1];
const fetchJson = (url) => fetch(url, { cache: "no-store" }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${url}: ${r.status}`))));

/* Compact 3D value-noise (fractal) — deterministic, dependency-free. */
const noise3 = (() => {
  const perm = new Uint8Array(512);
  let seed = 1349;
  for (let i = 0; i < 256; i += 1) perm[i] = i;
  for (let i = 255; i > 0; i -= 1) {
    seed = (seed * 16807) % 2147483647;
    const j = seed % (i + 1);
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  for (let i = 0; i < 256; i += 1) perm[i + 256] = perm[i];
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a, b, t) => a + (b - a) * t;
  const grad = (hash, x, y, z) => {
    const h = hash & 15;
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  };
  return (x, y, z) => {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
    x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
    const u = fade(x), v = fade(y), w = fade(z);
    const A = perm[X] + Y, AA = perm[A] + Z, AB = perm[A + 1] + Z;
    const B = perm[X + 1] + Y, BA = perm[B] + Z, BB = perm[B + 1] + Z;
    return lerp(
      lerp(lerp(grad(perm[AA], x, y, z), grad(perm[BA], x - 1, y, z), u), lerp(grad(perm[AB], x, y - 1, z), grad(perm[BB], x - 1, y - 1, z), u), v),
      lerp(lerp(grad(perm[AA + 1], x, y, z - 1), grad(perm[BA + 1], x - 1, y, z - 1), u), lerp(grad(perm[AB + 1], x, y - 1, z - 1), grad(perm[BB + 1], x - 1, y - 1, z - 1), u), v),
      w,
    );
  };
})();

function initRail() {
  const links = $$(".chapter-rail a");
  if (!links.length) return;
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        links.forEach((link) => link.classList.toggle("is-active", link.dataset.rail === entry.target.id));
      }
    }
  }, { rootMargin: "-38% 0px -52% 0px" });
  /* レール項目を持つ章だけ監視する（レール外の補助セクションが現在位置表示を消さないように） */
  const railIds = new Set(links.map((link) => link.dataset.rail));
  $$(".chapter").forEach((section) => { if (railIds.has(section.id)) observer.observe(section); });
}

/* entries: [{title, url, status}] — 各ページが自分の出典だけを渡す */
function renderLedgerEntries(entries) {
  const ledger = $("#ledger");
  if (!ledger) return;
  const seen = new Set();
  ledger.insertAdjacentHTML("beforeend", entries.filter((e) => e.title && !seen.has(e.title) && seen.add(e.title)).map((e) => `
    <div class="ledger-row">
      <span>${e.url ? `<a href="${escapeHtml(safeUrl(e.url))}" target="_blank" rel="noopener noreferrer">${escapeHtml(e.title)}</a>` : escapeHtml(e.title)}</span>
      <span class="ledger-status${e.status === "ok" ? "" : " is-na"}">${e.status === "ok" ? "接続中" : "未接続"}</span>
    </div>`).join(""));
}

const blockEntry = (block, fallbackTitle) => (block ? { title: block.source?.title || fallbackTitle, url: block.source?.url || "", status: block.status } : null);

function bootFooter() {
  setText("#footer-year", String(new Date().getFullYear()));
}
