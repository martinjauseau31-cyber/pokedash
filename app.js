import { SUPABASE_URL, SUPABASE_ANON_KEY, DEFAULTS } from "./config.js";

/* ════════════════════════════════════════════════════════════
   Constantes
   ════════════════════════════════════════════════════════════ */
const STATUSES = {
  stock: "En stock",
  listed: "En vente",
  grading: "Au grading",
  graded: "Gradée",
  sold: "Vendue",
  perso: "Collection perso",
};
const GRADERS = ["PCA", "PSA", "CGC", "CollectAura", "SFG", "CCC", "Autre"];
const CHANNELS = ["Cardmarket", "Vinted", "eBay", "Leboncoin", "Discord", "Main propre", "Autre"];
const SOURCES = ["Leboncoin", "Vinted", "Facebook", "Vide-grenier", "Cardmarket", "eBay", "Boutique", "Autre"];
const CONDITIONS = ["Mint", "Near Mint", "Excellent", "Good", "Light Played", "Played", "Poor"];
const LANGS = ["FR", "EN", "JP", "Autre"];
const PAGES = {
  dashboard: "Tableau de bord",
  stock: "Stock",
  lots: "Lots",
  grading: "Grading",
  simulateur: "Simulateur",
  reglages: "Réglages",
};

const state = { lots: [], cards: [], snapshots: [], settings: { ...DEFAULTS }, filters: { q: "", status: "", lot: "", sort: "updated", dir: -1 } };
let db;

/* ════════════════════════════════════════════════════════════
   Utilitaires
   ════════════════════════════════════════════════════════════ */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const n = (v) => (v === null || v === undefined || v === "" || isNaN(Number(v)) ? 0 : Number(v));
const eur = (v, d = 0) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: d, minimumFractionDigits: d }).format(n(v));
const eur2 = (v) => eur(v, 2);
const pct = (v) => (isFinite(v) ? `${v >= 0 ? "+" : ""}${Math.round(v * 100)} %` : "—");
const signed = (v) => `${v >= 0 ? "+" : ""}${eur(v)}`;
const today = () => new Date().toISOString().slice(0, 10);
const dayDiff = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const fmtDate = (d) => (d ? new Date(d + "T12:00:00").toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "2-digit" }) : "—");
const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), 2400);
}

/* ════════════════════════════════════════════════════════════
   Stockage : local (navigateur) ou Supabase (synchro)
   ════════════════════════════════════════════════════════════ */
class LocalDB {
  mode = "local";
  key = "pokedash-v1";
  _read() {
    try { return JSON.parse(localStorage.getItem(this.key)) || {}; } catch { return {}; }
  }
  _write(d) {
    try { localStorage.setItem(this.key, JSON.stringify(d)); } catch (e) { toast("Stockage local plein ou bloqué"); }
  }
  async all(t) { return this._read()[t] || []; }
  async insert(t, row) {
    const d = this._read();
    const r = { id: uid(), created_at: new Date().toISOString(), ...row };
    d[t] = [...(d[t] || []), r];
    this._write(d);
    return r;
  }
  async update(t, id, patch) {
    const d = this._read();
    d[t] = (d[t] || []).map((r) => (r.id === id ? { ...r, ...patch } : r));
    this._write(d);
    return d[t].find((r) => r.id === id);
  }
  async remove(t, id) {
    const d = this._read();
    d[t] = (d[t] || []).filter((r) => r.id !== id);
    if (t === "lots") d.cards = (d.cards || []).map((c) => (c.lot_id === id ? { ...c, lot_id: null } : c));
    this._write(d);
  }
  async upsertSnapshot(s) {
    const d = this._read();
    d.snapshots = (d.snapshots || []).filter((x) => x.date !== s.date).concat({ id: uid(), ...s });
    this._write(d);
  }
  async getSettings() { return this._read().settings || {}; }
  async saveSettings(s) { const d = this._read(); d.settings = s; this._write(d); }
  async replaceAll(data) { this._write(data); }
}

class SupaDB {
  mode = "supabase";
  constructor(client) { this.c = client; }
  async all(t) {
    const { data, error } = await this.c.from(t).select("*").order("created_at", { ascending: true, nullsFirst: true });
    if (error && t === "snapshots") {
      const r = await this.c.from(t).select("*").order("date");
      if (r.error) throw r.error;
      return r.data;
    }
    if (error) throw error;
    return data;
  }
  async insert(t, row) {
    const { data, error } = await this.c.from(t).insert(row).select().single();
    if (error) throw error;
    return data;
  }
  async update(t, id, patch) {
    const { data, error } = await this.c.from(t).update(patch).eq("id", id).select().single();
    if (error) throw error;
    return data;
  }
  async remove(t, id) {
    const { error } = await this.c.from(t).delete().eq("id", id);
    if (error) throw error;
  }
  async upsertSnapshot(s) {
    const { error } = await this.c.from("snapshots").upsert(s, { onConflict: "user_id,date" });
    if (error) console.warn(error);
  }
  async getSettings() {
    const { data } = await this.c.from("settings").select("data").maybeSingle();
    return data?.data || {};
  }
  async saveSettings(s) {
    const { data: u } = await this.c.auth.getUser();
    const { error } = await this.c.from("settings").upsert({ user_id: u.user.id, data: s });
    if (error) throw error;
  }
}

/* ════════════════════════════════════════════════════════════
   Calculs
   ════════════════════════════════════════════════════════════ */
const lotById = (id) => state.lots.find((l) => l.id === id);
const cardCost = (c) => (c.lot_id ? 0 : n(c.purchase_price));
const acquired = (c) => c.purchase_date || lotById(c.lot_id)?.purchase_date || (c.created_at || "").slice(0, 10) || null;
const netSale = (c) => (c.status === "sold" ? n(c.sale_price) - n(c.sale_fees) : 0);
const inStock = (c) => c.status !== "sold";

function metrics() {
  const { lots, cards } = state;
  const spentLots = lots.reduce((s, l) => s + n(l.price), 0);
  const spentSingles = cards.reduce((s, c) => s + cardCost(c), 0);
  const spentGrading = cards.reduce((s, c) => s + n(c.grading_cost), 0);
  const spent = spentLots + spentSingles + spentGrading;
  const sales = cards.reduce((s, c) => s + netSale(c), 0);
  const stock = cards.filter(inStock);
  const stockValue = stock.reduce((s, c) => s + n(c.market_value), 0);
  const cash = sales - spent;
  const latent = cash + stockValue;
  const roi = spent > 0 ? latent / spent : NaN;
  const sold = cards.filter((c) => c.status === "sold" && c.sale_date && acquired(c));
  const rotation = sold.length ? sold.reduce((s, c) => s + Math.max(0, dayDiff(acquired(c), c.sale_date)), 0) / sold.length : NaN;
  const atGrading = cards.filter((c) => c.status === "grading");
  const gradingValue = atGrading.reduce((s, c) => s + n(c.market_value), 0);
  const graded = cards.filter((c) => c.grade !== null && c.grade !== undefined && c.grade !== "");
  const highGrades = graded.filter((c) => n(c.grade) >= 9).length;
  return {
    spent, spentLots, spentSingles, spentGrading, sales, stockValue, cash, latent, roi, rotation,
    stockCount: stock.length, soldCount: cards.filter((c) => c.status === "sold").length,
    atGrading: atGrading.length, gradingShare: stockValue > 0 ? gradingValue / stockValue : 0,
    gradedCount: graded.length, highGradeRate: graded.length ? highGrades / graded.length : NaN,
  };
}

function lotStats(l) {
  const cs = state.cards.filter((c) => c.lot_id === l.id);
  const sales = cs.reduce((s, c) => s + netSale(c), 0);
  const grading = cs.reduce((s, c) => s + n(c.grading_cost), 0);
  const remaining = cs.filter(inStock).reduce((s, c) => s + n(c.market_value), 0);
  const cost = n(l.price) + grading;
  const realized = sales - cost;
  const latent = realized + remaining;
  return { count: cs.length, soldCount: cs.filter((c) => c.status === "sold").length, sales, grading, remaining, cost, realized, latent, roi: cost > 0 ? latent / cost : NaN, roiRealized: cost > 0 ? realized / cost : NaN };
}

/** Recommandation de la grille de tri pour une carte */
function recommend(c) {
  const s = state.settings;
  const v = n(c.market_value);
  if (c.status === "sold") return null;
  if (c.status === "grading") return { tone: "maybe", text: `Au grading chez ${c.grader || "?"} depuis ${c.grading_sent ? dayDiff(c.grading_sent, today()) + " j" : "?"}.` };
  if (c.status === "graded") return { tone: "go", text: `Gradée ${c.grader || ""} ${c.grade ?? ""} : vendre au prix des dernières ventes de cette note.` };
  if (!v) return { tone: "maybe", text: "Renseigne la cote pour obtenir une recommandation." };
  if (v < s.seuilGradingBrut) return { tone: "no", text: `Cote < ${eur(s.seuilGradingBrut)} : vente brute (Cardmarket) ou en lot Vinted.` };
  const target = v * s.multiplicateur10;
  const who = v >= s.seuilPSA ? "PSA Francfort" : "PCA";
  return { tone: "maybe", text: `Inspecte-la sous lampe. Si elle est parfaite ET que le 10 se vend ≥ ${eur(target)}, grading ${who}. Sinon, vente brute.` };
}

function needsPriceDrop(c) {
  return c.status === "listed" && c.listed_date && dayDiff(c.listed_date, today()) >= state.settings.joursAvantBaisse;
}

/* ════════════════════════════════════════════════════════════
   Graphiques SVG (sans dépendance)
   ════════════════════════════════════════════════════════════ */
const tip = $("#tooltip");
function showTip(e, html) {
  tip.innerHTML = html;
  tip.hidden = false;
  const pad = 14, w = tip.offsetWidth, h = tip.offsetHeight;
  let x = e.clientX + pad, y = e.clientY + pad;
  if (x + w > innerWidth - 8) x = e.clientX - w - pad;
  if (y + h > innerHeight - 8) y = e.clientY - h - pad;
  tip.style.left = x + "px";
  tip.style.top = y + "px";
}
const hideTip = () => (tip.hidden = true);

function niceTicks(min, max, count = 4) {
  if (min === max) { max = min + 1; }
  const span = max - min;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) || 10 * mag;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const out = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}
const shortEur = (v) => (Math.abs(v) >= 1000 ? `${(v / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} k€` : `${Math.round(v)} €`);

/** Courbes temporelles : series = [{name, color, points:[{x:'YYYY-MM-DD', y}]}] */
function lineChart(el, series) {
  const all = series.flatMap((s) => s.points);
  if (all.length < 2) { el.innerHTML = `<div class="empty-chart">Pas encore assez d'historique.<br>Ajoute des lots et des ventes pour voir l'évolution.</div>`; return; }
  const W = 760, H = 280, L = 56, R = 120, T = 12, B = 30;
  const xs = [...new Set(all.map((p) => p.x))].sort();
  const t0 = Date.parse(xs[0]), t1 = Date.parse(xs.at(-1)) || t0 + 864e5;
  const ys = all.map((p) => p.y);
  const ticks = niceTicks(Math.min(0, ...ys), Math.max(...ys));
  const yMin = ticks[0], yMax = ticks.at(-1);
  const X = (d) => L + ((Date.parse(d) - t0) / Math.max(1, t1 - t0)) * (W - L - R);
  const Y = (v) => T + (1 - (v - yMin) / (yMax - yMin || 1)) * (H - T - B);
  const xTicks = [];
  const nT = Math.min(6, xs.length);
  for (let i = 0; i < nT; i++) {
    const t = t0 + ((t1 - t0) * i) / Math.max(1, nT - 1);
    const d = new Date(t);
    xTicks.push({ x: L + ((t - t0) / Math.max(1, t1 - t0)) * (W - L - R), label: `${d.getDate()} ${MONTHS.at(d.getMonth())}` });
  }
  const paths = series.map((s) => {
    if (!s.points.length) return "";
    const d = s.points.map((p, i) => `${i ? "L" : "M"}${X(p.x).toFixed(1)} ${Y(p.y).toFixed(1)}`).join("");
    const last = s.points.at(-1);
    return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${X(last.x)}" cy="${Y(last.y)}" r="4" fill="${s.color}" stroke="var(--bg-2)" stroke-width="2"/>`;
  }).join("");
  // labels directs en fin de courbe, espacés pour éviter les collisions
  const ends = series.filter((s) => s.points.length).map((s) => ({ s, y: Y(s.points.at(-1).y), v: s.points.at(-1).y })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 30) ends[i].y = ends[i - 1].y + 30;
  const labels = ends.map((e) => `<text x="${W - R + 10}" y="${e.y - 2}" font-size="11.5" fill="var(--text-2)">${esc(e.s.name)}</text><text x="${W - R + 10}" y="${e.y + 12}" font-size="12" font-weight="600" fill="var(--text)">${shortEur(e.v)}</text>`).join("");
  el.innerHTML = `
    <div class="legend">${series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join("")}</div>
    <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Évolution dans le temps">
      ${ticks.map((t) => `<line x1="${L}" x2="${W - R}" y1="${Y(t)}" y2="${Y(t)}" stroke="${t === 0 ? "var(--axis)" : "var(--grid)"}"/><text x="${L - 8}" y="${Y(t) + 4}" text-anchor="end" font-size="11" fill="var(--text-3)">${shortEur(t)}</text>`).join("")}
      ${xTicks.map((t) => `<text x="${t.x}" y="${H - 8}" text-anchor="middle" font-size="11" fill="var(--text-3)">${t.label}</text>`).join("")}
      ${paths}${labels}
      <line class="xhair" x1="0" x2="0" y1="${T}" y2="${H - B}" stroke="var(--axis)" stroke-dasharray="3 3" visibility="hidden"/>
      <rect class="hit" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent"/>
    </svg>`;
  const svg = $("svg", el), hit = $(".hit", el), xh = $(".xhair", el);
  const valueAt = (s, d) => { let v = null; for (const p of s.points) { if (p.x <= d) v = p.y; else break; } return v; };
  hit.addEventListener("mousemove", (e) => {
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const d = xs.reduce((best, x) => (Math.abs(X(x) - px) < Math.abs(X(best) - px) ? x : best), xs[0]);
    xh.setAttribute("x1", X(d)); xh.setAttribute("x2", X(d)); xh.setAttribute("visibility", "visible");
    showTip(e, `<div class="t-head">${fmtDate(d)}</div>` + series.map((s) => { const v = valueAt(s, d); return v === null ? "" : `<div class="t-row"><span><i class="sw" style="background:${s.color}"></i>${esc(s.name)}</span><b>${eur(v)}</b></div>`; }).join(""));
  });
  hit.addEventListener("mouseleave", () => { hideTip(); xh.setAttribute("visibility", "hidden"); });
}

/** Barres verticales signées : rows = [{label, value, detail}] */
function signedBars(el, rows, { posColor = "var(--s1)", negColor = "var(--s2)", posName = "Positif", negName = "Négatif" } = {}) {
  if (!rows.length) { el.innerHTML = `<div class="empty-chart">Aucune donnée pour l'instant.</div>`; return; }
  const W = 520, H = 240, L = 56, R = 16, T = 12, B = 30;
  const ticks = niceTicks(Math.min(0, ...rows.map((r) => r.value)), Math.max(0, ...rows.map((r) => r.value)));
  const yMin = ticks[0], yMax = ticks.at(-1);
  const Y = (v) => T + (1 - (v - yMin) / (yMax - yMin || 1)) * (H - T - B);
  const slot = (W - L - R) / rows.length, bw = Math.min(44, slot * 0.6);
  const bars = rows.map((r, i) => {
    const x = L + i * slot + (slot - bw) / 2, y0 = Y(0), y1 = Y(r.value);
    const h = Math.max(1, Math.abs(y1 - y0)), top = Math.min(y0, y1);
    const rr = Math.min(4, h / 2), up = r.value >= 0;
    const d = up
      ? `M${x} ${y0}V${top + rr}Q${x} ${top} ${x + rr} ${top}H${x + bw - rr}Q${x + bw} ${top} ${x + bw} ${top + rr}V${y0}Z`
      : `M${x} ${y0}V${top + h - rr}Q${x} ${top + h} ${x + rr} ${top + h}H${x + bw - rr}Q${x + bw} ${top + h} ${x + bw} ${top + h - rr}V${y0}Z`;
    return `<g class="bar" data-i="${i}"><rect x="${L + i * slot}" y="${T}" width="${slot}" height="${H - T - B}" fill="transparent"/><path d="${d}" fill="${up ? posColor : negColor}"/></g>
      <text x="${x + bw / 2}" y="${H - 8}" text-anchor="middle" font-size="11" fill="var(--text-3)">${esc(r.label)}</text>`;
  }).join("");
  el.innerHTML = `
    <div class="legend"><span><i style="background:${posColor}"></i>${esc(posName)}</span><span><i style="background:${negColor}"></i>${esc(negName)}</span></div>
    <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Barres par période">
      ${ticks.map((t) => `<line x1="${L}" x2="${W - R}" y1="${Y(t)}" y2="${Y(t)}" stroke="${t === 0 ? "var(--axis)" : "var(--grid)"}"/><text x="${L - 8}" y="${Y(t) + 4}" text-anchor="end" font-size="11" fill="var(--text-3)">${shortEur(t)}</text>`).join("")}
      ${bars}
    </svg>`;
  $$(".bar", el).forEach((g) => {
    const r = rows[+g.dataset.i];
    g.addEventListener("mousemove", (e) => showTip(e, `<div class="t-head">${esc(r.label)}</div><div class="t-row"><span>Résultat</span><b>${signed(r.value)}</b></div>${r.detail || ""}`));
    g.addEventListener("mouseleave", hideTip);
  });
}

/** Barres horizontales signées : rows = [{label, value, detail}] */
function hBars(el, rows, { posColor = "var(--s3)", negColor = "var(--s2)" } = {}) {
  if (!rows.length) { el.innerHTML = `<div class="empty-chart">Aucun lot enregistré.</div>`; return; }
  const W = 340, rowH = 30, L = 112, R = 60, T = 6;
  const H = T * 2 + rows.length * rowH;
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  const hasNeg = rows.some((r) => r.value < 0);
  const x0 = hasNeg ? L + (W - L - R) / 2 : L;
  const span = hasNeg ? (W - L - R) / 2 : W - L - R;
  const bars = rows.map((r, i) => {
    const y = T + i * rowH, w = Math.max(2, (Math.abs(r.value) / max) * span), up = r.value >= 0;
    const x = up ? x0 : x0 - w;
    return `<g class="hbar" data-i="${i}"><rect x="0" y="${y}" width="${W}" height="${rowH}" fill="transparent"/>
      <text x="${L - 10}" y="${y + rowH / 2 + 4}" text-anchor="end" font-size="11.5" fill="var(--text-2)">${esc(r.label.length > 16 ? r.label.slice(0, 15) + "…" : r.label)}</text>
      <rect x="${x}" y="${y + 7}" width="${w}" height="${rowH - 14}" rx="4" fill="${up ? posColor : negColor}"/>
      <text x="${up ? x + w + 6 : x0 + 6}" y="${y + rowH / 2 + 4}" font-size="11.5" font-weight="600" fill="var(--text)">${signed(r.value)}</text></g>`;
  }).join("");
  el.innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Résultat par lot"><line x1="${x0}" x2="${x0}" y1="0" y2="${H}" stroke="var(--axis)"/>${bars}</svg>`;
  $$(".hbar", el).forEach((g) => {
    const r = rows[+g.dataset.i];
    g.addEventListener("mousemove", (e) => showTip(e, `<div class="t-head">${esc(r.label)}</div>${r.detail || ""}`));
    g.addEventListener("mouseleave", hideTip);
  });
}

/* ════════════════════════════════════════════════════════════
   Séries temporelles
   ════════════════════════════════════════════════════════════ */
function timeSeries() {
  const ev = [];
  state.lots.forEach((l) => ev.push({ d: l.purchase_date || (l.created_at || "").slice(0, 10), spent: n(l.price), sale: 0 }));
  state.cards.forEach((c) => {
    if (cardCost(c)) ev.push({ d: acquired(c), spent: cardCost(c), sale: 0 });
    if (n(c.grading_cost)) ev.push({ d: c.grading_sent || acquired(c), spent: n(c.grading_cost), sale: 0 });
    if (c.status === "sold") ev.push({ d: c.sale_date || today(), spent: 0, sale: netSale(c) });
  });
  const evs = ev.filter((e) => e.d).sort((a, b) => a.d.localeCompare(b.d));
  const spent = [], sales = [];
  let s = 0, v = 0;
  for (const e of evs) {
    s += e.spent; v += e.sale;
    if (spent.at(-1)?.x === e.d) { spent.at(-1).y = s; sales.at(-1).y = v; }
    else { spent.push({ x: e.d, y: s }); sales.push({ x: e.d, y: v }); }
  }
  if (spent.length && spent.at(-1).x < today()) { spent.push({ x: today(), y: s }); sales.push({ x: today(), y: v }); }
  const stock = [...state.snapshots].sort((a, b) => a.date.localeCompare(b.date)).map((x) => ({ x: x.date, y: n(x.stock_value) }));
  // mois : résultat cash
  const byMonth = new Map();
  for (const e of evs) {
    const k = e.d.slice(0, 7);
    const m = byMonth.get(k) || { spent: 0, sale: 0 };
    m.spent += e.spent; m.sale += e.sale;
    byMonth.set(k, m);
  }
  const months = [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-12).map(([k, m]) => ({
    label: `${MONTHS.at(Number(k.slice(5)) - 1)} ${k.slice(2, 4)}`,
    value: m.sale - m.spent,
    detail: `<div class="t-row"><span>Ventes nettes</span><b>${eur(m.sale)}</b></div><div class="t-row"><span>Dépenses</span><b>${eur(m.spent)}</b></div>`,
  }));
  return { spent, sales, stock, months };
}

/* ════════════════════════════════════════════════════════════
   Pages
   ════════════════════════════════════════════════════════════ */
function kpi(label, value, sub = "", cls = "") {
  return `<div class="kpi glass ${cls}"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`;
}

function renderDashboard(v) {
  const m = metrics();
  const s = state.settings;
  const todo = [];
  state.cards.forEach((c) => {
    if (needsPriceDrop(c)) todo.push({ c, t: `En vente depuis ${dayDiff(c.listed_date, today())} j : baisser de 10 %` });
    else if (c.status === "stock" && n(c.market_value) >= s.seuilGradingBrut) todo.push({ c, t: "À inspecter pour le grading" });
    else if (c.status === "grading" && c.grading_sent && dayDiff(c.grading_sent, today()) > 120) todo.push({ c, t: `Au grading depuis ${dayDiff(c.grading_sent, today())} j : relancer` });
  });
  v.innerHTML = `
    <div class="kpis">
      ${kpi("Résultat latent", `<span class="${m.latent >= 0 ? "pos" : "neg"}">${signed(m.latent)}</span>`, `ROI ${pct(m.roi)} · ventes + stock − dépenses`, "hero")}
      ${kpi("Valeur du stock", eur(m.stockValue), `${m.stockCount} cartes non vendues`)}
      ${kpi("Ventes nettes", eur(m.sales), `${m.soldCount} cartes vendues`)}
      ${kpi("Total dépensé", eur(m.spent), `lots ${eur(m.spentLots)} · grading ${eur(m.spentGrading)}`)}
      ${kpi("Résultat cash", `<span class="${m.cash >= 0 ? "pos" : "neg"}">${signed(m.cash)}</span>`, `capital de départ ${eur(s.capitalDepart)}`)}
      ${kpi("Rotation moyenne", isFinite(m.rotation) ? `${Math.round(m.rotation)} j` : "—", "achat → vente · cible ≤ 30 j")}
      ${kpi("Au grading", `${m.atGrading}`, `${Math.round(m.gradingShare * 100)} % du stock · cible ≤ 25 %`)}
      ${kpi("Taux de 9-10", isFinite(m.highGradeRate) ? `${Math.round(m.highGradeRate * 100)} %` : "—", `${m.gradedCount} carte${m.gradedCount > 1 ? "s" : ""} notée${m.gradedCount > 1 ? "s" : ""} · cible ≥ 60 %`)}
    </div>
    <div class="cards-grid">
      <section class="panel glass span-8"><h3>Évolution</h3><p class="panel-sub">Dépenses et ventes cumulées depuis le début, valeur du stock depuis que tu utilises le dashboard</p><div id="ch-evo"></div></section>
      <section class="panel glass span-4"><h3>Résultat par lot</h3><p class="panel-sub">Ventes + stock restant − coût du lot et grading</p><div id="ch-lots"></div></section>
      <section class="panel glass span-6"><h3>Résultat cash par mois</h3><p class="panel-sub">Ventes nettes − dépenses du mois, 12 derniers mois</p><div id="ch-months"></div></section>
      <section class="panel glass span-6"><h3>À faire</h3><p class="panel-sub">Généré à partir des règles de ta stratégie</p>
        ${todo.length ? `<div class="table-wrap"><table><tbody>${todo.slice(0, 8).map(({ c, t }) => `<tr data-card="${c.id}"><td><div class="card-name">${esc(c.name)}</div><div class="card-meta">${esc(c.set_name || "")} ${c.number ? "· " + esc(c.number) : ""}</div></td><td class="alert-dot">${esc(t)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty-chart">Rien à faire, tout est à jour.</div>`}
      </section>
    </div>`;
  const ts = timeSeries();
  lineChart($("#ch-evo", v), [
    { name: "Valeur du stock", color: "var(--s1)", points: ts.stock },
    { name: "Dépenses cumulées", color: "var(--s2)", points: ts.spent },
    { name: "Ventes cumulées", color: "var(--s3)", points: ts.sales },
  ]);
  const lr = state.lots.map((l) => ({ l, st: lotStats(l) })).sort((a, b) => b.st.latent - a.st.latent).slice(0, 10).map(({ l, st }) => ({
    label: l.name, value: st.latent,
    detail: `<div class="t-row"><span>Coût (lot + grading)</span><b>${eur(st.cost)}</b></div><div class="t-row"><span>Ventes nettes</span><b>${eur(st.sales)}</b></div><div class="t-row"><span>Stock restant</span><b>${eur(st.remaining)}</b></div><div class="t-row"><span>ROI</span><b>${pct(st.roi)}</b></div>`,
  }));
  hBars($("#ch-lots", v), lr);
  signedBars($("#ch-months", v), ts.months, { posName: "Mois positif", negName: "Mois négatif (achats)" });
  $$("[data-card]", v).forEach((tr) => tr.addEventListener("click", () => cardModal(state.cards.find((c) => c.id === tr.dataset.card))));
}

function renderStock(v) {
  const f = state.filters;
  v.innerHTML = `
    <div class="toolbar">
      <input class="grow" id="f-q" placeholder="Rechercher une carte, un set, un numéro…" value="${esc(f.q)}" />
      <select id="f-status"><option value="">Tous les statuts</option>${Object.entries(STATUSES).map(([k, l]) => `<option value="${k}" ${f.status === k ? "selected" : ""}>${l}</option>`).join("")}</select>
      <select id="f-lot"><option value="">Tous les lots</option><option value="none" ${f.lot === "none" ? "selected" : ""}>Hors lot</option>${state.lots.map((l) => `<option value="${l.id}" ${f.lot === l.id ? "selected" : ""}>${esc(l.name)}</option>`).join("")}</select>
    </div>
    <section class="panel glass"><div class="table-wrap" id="stock-table"></div></section>`;
  const draw = () => {
    const q = f.q.toLowerCase();
    let rows = state.cards.filter((c) =>
      (!q || [c.name, c.set_name, c.number, c.notes].some((x) => (x || "").toLowerCase().includes(q))) &&
      (!f.status || c.status === f.status) &&
      (!f.lot || (f.lot === "none" ? !c.lot_id : c.lot_id === f.lot)));
    const key = { name: (c) => (c.name || "").toLowerCase(), value: (c) => n(c.market_value), status: (c) => c.status, date: (c) => acquired(c) || "", updated: (c) => c.updated_at || c.created_at || "" }[f.sort];
    rows.sort((a, b) => (key(a) > key(b) ? 1 : key(a) < key(b) ? -1 : 0) * f.dir);
    const totalVal = rows.filter(inStock).reduce((s, c) => s + n(c.market_value), 0);
    $("#stock-table", v).innerHTML = rows.length ? `
      <table>
        <thead><tr>
          <th data-sort="name">Carte</th><th data-sort="status">Statut</th><th class="hide-m">Lot</th>
          <th class="r" data-sort="value">Cote</th><th class="r hide-m">Vente</th><th class="hide-m" data-sort="date">Acquise</th><th class="hide-m">Note</th>
        </tr></thead>
        <tbody>${rows.map((c) => `
          <tr data-id="${c.id}">
            <td><div class="card-name">${esc(c.name)} ${needsPriceDrop(c) ? `<span class="alert-dot" title="Baisser le prix">· −10 %</span>` : ""}</div><div class="card-meta">${esc(c.set_name || "")} ${c.number ? "· " + esc(c.number) : ""} · ${esc(c.language || "")} ${c.condition ? "· " + esc(c.condition) : ""}</div></td>
            <td><span class="badge st-${c.status}">${STATUSES[c.status] || c.status}</span></td>
            <td class="hide-m muted">${esc(lotById(c.lot_id)?.name || "—")}</td>
            <td class="r num">${c.market_value ? eur2(c.market_value) : "—"}</td>
            <td class="r num hide-m">${c.status === "sold" ? eur2(netSale(c)) : "—"}</td>
            <td class="hide-m muted">${fmtDate(acquired(c))}</td>
            <td class="hide-m">${c.grade ? `${esc(c.grader || "")} ${esc(c.grade)}` : "—"}</td>
          </tr>`).join("")}
        </tbody>
      </table>
      <p class="muted small" style="padding:10px 12px 0">${rows.length} cartes · valeur non vendue ${eur(totalVal)}</p>` : `<div class="empty">Aucune carte. Clique sur « + Carte » pour commencer.</div>`;
    $$("th[data-sort]", v).forEach((th) => th.addEventListener("click", () => { f.dir = f.sort === th.dataset.sort ? -f.dir : 1; f.sort = th.dataset.sort; draw(); }));
    $$("tbody tr", v).forEach((tr) => tr.addEventListener("click", () => cardModal(state.cards.find((c) => c.id === tr.dataset.id))));
  };
  $("#f-q", v).addEventListener("input", (e) => { f.q = e.target.value; draw(); });
  $("#f-status", v).addEventListener("change", (e) => { f.status = e.target.value; draw(); });
  $("#f-lot", v).addEventListener("change", (e) => { f.lot = e.target.value; draw(); });
  draw();
}

function renderLots(v) {
  const rows = state.lots.map((l) => ({ l, st: lotStats(l) })).sort((a, b) => (b.l.purchase_date || "").localeCompare(a.l.purchase_date || ""));
  v.innerHTML = `<section class="panel glass"><div class="table-wrap">${rows.length ? `
    <table><thead><tr><th>Lot</th><th class="hide-m">Source</th><th>Acheté</th><th class="r">Prix</th><th class="r hide-m">Cartes</th><th class="r hide-m">Ventes</th><th class="r hide-m">Stock restant</th><th class="r">Résultat</th><th class="r">ROI</th></tr></thead>
    <tbody>${rows.map(({ l, st }) => `
      <tr data-id="${l.id}">
        <td><div class="card-name">${esc(l.name)}</div><div class="card-meta">${esc(l.notes || "")}</div></td>
        <td class="hide-m muted">${esc(l.source || "—")}</td>
        <td class="muted">${fmtDate(l.purchase_date)}</td>
        <td class="r num">${eur2(l.price)}</td>
        <td class="r num hide-m">${st.soldCount}/${st.count}</td>
        <td class="r num hide-m">${eur(st.sales)}</td>
        <td class="r num hide-m">${eur(st.remaining)}</td>
        <td class="r num ${st.latent >= 0 ? "pos" : "neg"}">${signed(st.latent)}</td>
        <td class="r num ${st.roi >= 0 ? "pos" : "neg"}">${pct(st.roi)}</td>
      </tr>`).join("")}</tbody></table>
    <p class="muted small" style="padding:10px 12px 0">Cible de la stratégie : payer au maximum 40 % de la valeur de revente, viser une marge par lot ≥ 80 %.</p>` : `<div class="empty">Aucun lot. Clique sur « + Lot » pour enregistrer ton premier achat.</div>`}</div></section>`;
  $$("tbody tr", v).forEach((tr) => tr.addEventListener("click", () => lotModal(lotById(tr.dataset.id))));
}

function renderGrading(v) {
  const at = state.cards.filter((c) => c.status === "grading");
  const done = state.cards.filter((c) => c.grade !== null && c.grade !== undefined && c.grade !== "");
  const cands = state.cards.filter((c) => c.status === "stock" && n(c.market_value) >= state.settings.seuilGradingBrut).sort((a, b) => n(b.market_value) - n(a.market_value));
  const dist = {};
  done.forEach((c) => { const g = Math.floor(n(c.grade)); dist[g] = (dist[g] || 0) + 1; });
  const table = (rows, cols) => rows.length ? `<div class="table-wrap"><table><thead><tr>${cols.map((c) => `<th class="${c.r ? "r" : ""}">${c.h}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr data-id="${r.id}">${cols.map((c) => `<td class="${c.r ? "r num" : ""}">${c.v(r)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : `<div class="empty">Rien ici pour l'instant.</div>`;
  v.innerHTML = `
    <div class="cards-grid">
      <section class="panel glass span-6"><h3>Chez le gradeur (${at.length})</h3><p class="panel-sub">Cartes envoyées, en attente de retour</p>
        ${table(at, [{ h: "Carte", v: (c) => `<div class="card-name">${esc(c.name)}</div><div class="card-meta">${esc(c.set_name || "")}</div>` }, { h: "Société", v: (c) => esc(c.grader || "—") }, { h: "Envoyée", v: (c) => fmtDate(c.grading_sent) }, { h: "Jours", r: true, v: (c) => (c.grading_sent ? dayDiff(c.grading_sent, today()) : "—") }])}
      </section>
      <section class="panel glass span-6"><h3>Candidates au grading (${cands.length})</h3><p class="panel-sub">En stock, cote ≥ ${eur(state.settings.seuilGradingBrut)} : à passer à la lampe</p>
        ${table(cands.slice(0, 12), [{ h: "Carte", v: (c) => `<div class="card-name">${esc(c.name)}</div><div class="card-meta">${esc(c.set_name || "")}</div>` }, { h: "Cote", r: true, v: (c) => eur2(c.market_value) }, { h: "10 mini", r: true, v: (c) => eur(n(c.market_value) * state.settings.multiplicateur10) }, { h: "Vers", v: (c) => (n(c.market_value) >= state.settings.seuilPSA ? "PSA" : "PCA") }])}
      </section>
      <section class="panel glass span-12"><h3>Résultats reçus (${done.length})</h3><p class="panel-sub">Notes obtenues · ${Object.entries(dist).sort(([a], [b]) => b - a).map(([g, k]) => `${g} : ${k}`).join(" · ") || "aucune"}</p>
        ${table(done, [{ h: "Carte", v: (c) => `<div class="card-name">${esc(c.name)}</div><div class="card-meta">${esc(c.set_name || "")}</div>` }, { h: "Note", v: (c) => `${esc(c.grader || "")} <b>${esc(c.grade)}</b>` }, { h: "Frais", r: true, v: (c) => eur2(c.grading_cost) }, { h: "Cote", r: true, v: (c) => eur2(c.market_value) }, { h: "Statut", v: (c) => `<span class="badge st-${c.status}">${STATUSES[c.status]}</span>` }])}
      </section>
    </div>`;
  $$("tbody tr", v).forEach((tr) => tr.addEventListener("click", () => cardModal(state.cards.find((c) => c.id === tr.dataset.id))));
}

function renderSim(v) {
  const s = state.settings;
  v.innerHTML = `
    <div class="sim">
      <section class="panel glass"><h3>Grader ou vendre brut ?</h3><p class="panel-sub">Entre les prix des dernières ventes réussies (Cardmarket, eBay « vendus »)</p>
        <div class="grid-form" id="sim-form">
          <label>Prix brut (€)<input type="number" step="0.01" name="raw" value="40"/></label>
          <label>Société<select name="grader"><option value="pca">PCA Classic (11,90 €)</option><option value="pcafast">PCA Fast (19,90 €)</option><option value="psa">PSA Standard (49,99 €)</option><option value="custom">Autre</option></select></label>
          <label>Prix d'un 10 (€)<input type="number" step="0.01" name="p10" value="120"/></label>
          <label>Proba d'un 10 (%)<input type="number" name="q10" value="40"/></label>
          <label>Prix d'un 9 (€)<input type="number" step="0.01" name="p9" value="60"/></label>
          <label>Proba d'un 9 (%)<input type="number" name="q9" value="40"/></label>
          <label>Prix d'un 8 ou moins (€)<input type="number" step="0.01" name="p8" value="35"/></label>
          <label>Frais de grading (€)<input type="number" step="0.01" name="fee" value="11.90"/></label>
          <label>Port aller-retour réparti (€)<input type="number" step="0.01" name="ship" value="6"/></label>
          <label>Commission de vente (%)<input type="number" step="0.1" name="com" value="5"/></label>
        </div>
      </section>
      <section class="panel glass"><h3>Résultat</h3><p class="panel-sub">Espérance de gain, comparée à une vente brute immédiate</p><div id="sim-out"></div></section>
    </div>`;
  const form = $("#sim-form", v);
  const fees = { pca: 11.9, pcafast: 19.9, psa: 49.99 };
  const calc = () => {
    const g = (k) => n($(`[name=${k}]`, form).value);
    const com = g("com") / 100;
    const q10 = Math.min(1, g("q10") / 100), q9 = Math.min(1 - q10, g("q9") / 100), q8 = Math.max(0, 1 - q10 - q9);
    const brut = g("raw") * (1 - com);
    const expected = (q10 * g("p10") + q9 * g("p9") + q8 * g("p8")) * (1 - com) - g("fee") - g("ship");
    const worst = g("p8") * (1 - com) - g("fee") - g("ship");
    const gain = expected - brut;
    const ratio = g("raw") > 0 ? g("p10") / g("raw") : 0;
    const ok = gain > 0 && ratio >= s.multiplicateur10 && g("raw") >= s.seuilGradingBrut;
    const verdict = ok ? ["go", "Grader"] : gain > 0 ? ["maybe", "Rentable mais risqué"] : ["no", "Vendre brut"];
    $("#sim-out", v).innerHTML = `
      <div class="verdict ${verdict[0]}">${verdict[1]}</div>
      <div class="sim-line"><span>Vente brute nette</span><b>${eur2(brut)}</b></div>
      <div class="sim-line"><span>Espérance gradée nette</span><b>${eur2(expected)}</b></div>
      <div class="sim-line"><span>Gain espéré du grading</span><b class="${gain >= 0 ? "pos" : "neg"}">${gain >= 0 ? "+" : ""}${eur2(gain)}</b></div>
      <div class="sim-line"><span>Pire cas (8 ou moins)</span><b class="${worst - brut >= 0 ? "pos" : "neg"}">${eur2(worst)} (${worst - brut >= 0 ? "+" : ""}${eur2(worst - brut)})</b></div>
      <div class="sim-line"><span>Prix du 10 / brut</span><b>${ratio.toFixed(1)}x (règle ≥ ${s.multiplicateur10}x)</b></div>
      <p class="muted small" style="margin-top:12px">Règle de ta stratégie : grader seulement si la carte vaut ≥ ${eur(s.seuilGradingBrut)} brute, si le 10 vaut ≥ ${s.multiplicateur10}× le brut et si elle est parfaite sous la lampe. Probabilité de 8 ou moins : ${Math.round(q8 * 100)} %.</p>`;
  };
  $("[name=grader]", form).addEventListener("change", (e) => { if (fees[e.target.value]) $("[name=fee]", form).value = fees[e.target.value]; calc(); });
  form.addEventListener("input", calc);
  calc();
}

function renderSettings(v) {
  const s = state.settings;
  v.innerHTML = `
    <div class="cards-grid">
      <section class="panel glass span-6"><h3>Règles de la stratégie</h3><p class="panel-sub">Utilisées pour les recommandations, le simulateur et la liste « À faire »</p>
        <form id="set-form" class="grid-form">
          <label>Seuil de grading (cote brute, €)<input type="number" name="seuilGradingBrut" value="${s.seuilGradingBrut}"/></label>
          <label>Prix du 10 minimum (× brut)<input type="number" step="0.1" name="multiplicateur10" value="${s.multiplicateur10}"/></label>
          <label>Seuil PSA (cote brute, €)<input type="number" name="seuilPSA" value="${s.seuilPSA}"/></label>
          <label>Jours avant baisse de 10 %<input type="number" name="joursAvantBaisse" value="${s.joursAvantBaisse}"/></label>
          <label>Capital de départ (€)<input type="number" name="capitalDepart" value="${s.capitalDepart}"/></label>
          <label>Thème<select name="theme"><option value="dark" ${s.theme !== "light" ? "selected" : ""}>Sombre</option><option value="light" ${s.theme === "light" ? "selected" : ""}>Clair</option></select></label>
          <div class="full"><button class="btn primary" type="submit">Enregistrer</button></div>
        </form>
      </section>
      <section class="panel glass span-6"><h3>Données</h3><p class="panel-sub">${db.mode === "supabase" ? "Synchronisées avec Supabase : disponibles sur tous tes appareils." : "Mode local : stockées dans ce navigateur uniquement. Configure Supabase (README) pour la synchro."}</p>
        <div class="row">
          <button class="btn" id="exp-json">Exporter (JSON)</button>
          <button class="btn" id="exp-csv">Exporter le stock (CSV)</button>
          <label class="btn" style="flex-direction:row;color:var(--text)">Importer (JSON)<input type="file" id="imp-json" accept="application/json" hidden/></label>
          ${db.mode === "local" ? `<button class="btn" id="demo">Charger un exemple</button>` : ""}
          ${db.mode === "supabase" ? `<button class="btn danger" id="logout">Se déconnecter</button>` : ""}
        </div>
        <p class="muted small" style="margin-top:14px">Astuce : sur téléphone, ouvre le site puis « Ajouter à l'écran d'accueil » pour l'utiliser comme une app.</p>
      </section>
    </div>`;
  $("#set-form", v).addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const next = { ...state.settings };
    for (const [k, val] of fd.entries()) next[k] = k === "theme" ? val : n(val);
    state.settings = next;
    applyTheme();
    try { await db.saveSettings(next); toast("Réglages enregistrés"); } catch (err) { toast("Erreur : " + err.message); }
  });
  $("#exp-json", v).addEventListener("click", () => download(`pokedash-${today()}.json`, JSON.stringify({ lots: state.lots, cards: state.cards, snapshots: state.snapshots, settings: state.settings }, null, 2), "application/json"));
  $("#exp-csv", v).addEventListener("click", () => {
    const cols = ["name", "set_name", "number", "language", "condition", "status", "market_value", "purchase_price", "lot", "grader", "grade", "grading_cost", "sale_price", "sale_fees", "sale_channel", "sale_date", "notes"];
    const rows = state.cards.map((c) => cols.map((k) => (k === "lot" ? lotById(c.lot_id)?.name || "" : c[k] ?? "")));
    const csv = [cols, ...rows].map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(";")).join("\n");
    download(`pokedash-stock-${today()}.csv`, "﻿" + csv, "text/csv");
  });
  $("#imp-json", v).addEventListener("change", (e) => importJSON(e.target.files[0]));
  $("#demo", v)?.addEventListener("click", loadDemo);
  $("#logout", v)?.addEventListener("click", async () => { await db.c.auth.signOut(); location.reload(); });
}

function download(name, content, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function importJSON(file) {
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!confirm(`Importer ${data.lots?.length || 0} lots et ${data.cards?.length || 0} cartes ? Ils seront ajoutés à tes données actuelles.`)) return;
    const idMap = {};
    for (const l of data.lots || []) {
      const { id, user_id, created_at, ...rest } = l;
      const r = await db.insert("lots", rest);
      idMap[id] = r.id;
    }
    for (const c of data.cards || []) {
      const { id, user_id, created_at, ...rest } = c;
      await db.insert("cards", { ...rest, lot_id: rest.lot_id ? idMap[rest.lot_id] || null : null });
    }
    await reload();
    toast("Import terminé");
  } catch (err) { toast("Import impossible : " + err.message); }
}

/* ════════════════════════════════════════════════════════════
   Formulaires (modale)
   ════════════════════════════════════════════════════════════ */
const opt = (list, val, empty = true) => (empty ? `<option value=""></option>` : "") + list.map((x) => `<option ${x === val ? "selected" : ""}>${esc(x)}</option>`).join("");
const field = (label, name, val, type = "text", extra = "") => `<label ${extra}>${label}<input type="${type}" name="${name}" value="${esc(val ?? "")}" ${type === "number" ? 'step="0.01" inputmode="decimal"' : ""}/></label>`;

function openModal(title, bodyHTML, { onSave, onDelete }) {
  const m = $("#modal");
  $("#modal-title").textContent = title;
  $("#modal-body").innerHTML = bodyHTML;
  $("#modal-foot").innerHTML = `${onDelete ? `<button type="button" class="btn danger" id="m-del">Supprimer</button>` : ""}<div class="right"><button class="btn ghost" value="cancel" formnovalidate>Annuler</button><button class="btn primary" value="save" id="m-save">Enregistrer</button></div>`;
  const form = $("#modal-form");
  form.onsubmit = async (e) => {
    if (e.submitter?.value !== "save") return;
    e.preventDefault();
    const btn = $("#m-save"); btn.disabled = true;
    try { await onSave(Object.fromEntries(new FormData(form).entries())); m.close(); await reload(); }
    catch (err) { toast("Erreur : " + err.message); }
    finally { btn.disabled = false; }
  };
  if (onDelete) $("#m-del").onclick = async () => { if (!confirm("Supprimer définitivement ?")) return; try { await onDelete(); m.close(); await reload(); } catch (err) { toast("Erreur : " + err.message); } };
  m.showModal();
  return m;
}

function clean(obj, numeric) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = v === "" ? null : numeric.includes(k) ? Number(String(v).replace(",", ".")) : v;
  return out;
}

function cardModal(c = null) {
  const isNew = !c;
  c = c || { status: "stock", language: "FR", purchase_date: today() };
  const rec = !isNew ? recommend(c) : null;
  const body = `
    <div class="grid-form" id="card-form">
      ${rec ? `<div class="reco"><b>Recommandation :</b> ${esc(rec.text)}</div>` : ""}
      ${field("Nom de la carte *", "name", c.name, "text", 'class="full"').replace("<input", "<input required")}
      ${field("Série / set", "set_name", c.set_name)}
      ${field("Numéro", "number", c.number)}
      <label>Langue<select name="language">${opt(LANGS, c.language, false)}</select></label>
      <label>État<select name="condition">${opt(CONDITIONS, c.condition)}</select></label>
      <label>Statut<select name="status">${Object.entries(STATUSES).map(([k, l]) => `<option value="${k}" ${c.status === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      ${field("Cote actuelle (€)", "market_value", c.market_value, "number")}
      <div class="fieldset-title">Achat</div>
      <label>Lot<select name="lot_id"><option value="">Achat à l'unité</option>${state.lots.map((l) => `<option value="${l.id}" ${c.lot_id === l.id ? "selected" : ""}>${esc(l.name)}</option>`).join("")}</select></label>
      ${field("Prix d'achat unitaire (€)", "purchase_price", c.purchase_price, "number")}
      ${field("Date d'achat", "purchase_date", c.purchase_date, "date")}
      <p class="hint" style="align-self:end">Si la carte vient d'un lot, son coût est déjà compté dans le prix du lot.</p>
      <div class="fieldset-title">Grading</div>
      <label>Société<select name="grader">${opt(GRADERS, c.grader)}</select></label>
      ${field("Note obtenue", "grade", c.grade, "number")}
      ${field("Frais de grading (€)", "grading_cost", c.grading_cost, "number")}
      ${field("Date d'envoi", "grading_sent", c.grading_sent, "date")}
      <div class="fieldset-title">Vente</div>
      ${field("Mise en vente le", "listed_date", c.listed_date, "date")}
      <label>Canal<select name="sale_channel">${opt(CHANNELS, c.sale_channel)}</select></label>
      ${field("Prix de vente (€)", "sale_price", c.sale_price, "number")}
      ${field("Frais de vente (€)", "sale_fees", c.sale_fees, "number")}
      ${field("Date de vente", "sale_date", c.sale_date, "date")}
      <label class="full">Notes<textarea name="notes" rows="2">${esc(c.notes || "")}</textarea></label>
    </div>`;
  openModal(isNew ? "Nouvelle carte" : c.name, body, {
    onSave: async (d) => {
      const row = clean(d, ["market_value", "purchase_price", "grade", "grading_cost", "sale_price", "sale_fees"]);
      if (row.sale_price && row.status !== "sold") row.status = "sold";
      if (row.status === "sold" && !row.sale_date) row.sale_date = today();
      if (row.status === "listed" && !row.listed_date) row.listed_date = today();
      if (row.status === "grading" && !row.grading_sent) row.grading_sent = today();
      row.updated_at = new Date().toISOString();
      if (isNew) await db.insert("cards", row); else await db.update("cards", c.id, row);
      toast(isNew ? "Carte ajoutée" : "Carte mise à jour");
    },
    onDelete: isNew ? null : () => db.remove("cards", c.id),
  });
  // Frais Cardmarket auto (5 %) si le champ frais est vide
  const f = $("#card-form");
  $("[name=sale_price]", f).addEventListener("change", (e) => {
    const fees = $("[name=sale_fees]", f), ch = $("[name=sale_channel]", f).value;
    if (!fees.value && ch === "Cardmarket") fees.value = (n(e.target.value) * 0.05).toFixed(2);
  });
}

function lotModal(l = null) {
  const isNew = !l;
  l = l || { purchase_date: today() };
  const st = !isNew ? lotStats(l) : null;
  const body = `
    <div class="grid-form">
      ${st ? `<div class="reco">${st.count} cartes · ventes ${eur(st.sales)} · stock restant ${eur(st.remaining)} · résultat <b class="${st.latent >= 0 ? "pos" : "neg"}">${signed(st.latent)}</b> (${pct(st.roi)})</div>` : ""}
      ${field("Nom du lot *", "name", l.name, "text", 'class="full"').replace("<input", "<input required")}
      <label>Source<select name="source">${opt(SOURCES, l.source)}</select></label>
      ${field("Prix payé (€) *", "price", l.price, "number").replace("<input", "<input required")}
      ${field("Date d'achat", "purchase_date", l.purchase_date, "date")}
      <label class="full">Notes<textarea name="notes" rows="2">${esc(l.notes || "")}</textarea></label>
      ${!isNew ? `<div class="full"><button type="button" class="btn sm" id="lot-cards">Voir les cartes de ce lot</button></div>` : ""}
    </div>`;
  openModal(isNew ? "Nouveau lot" : l.name, body, {
    onSave: async (d) => {
      const row = clean(d, ["price"]);
      if (isNew) await db.insert("lots", row); else await db.update("lots", l.id, row);
      toast(isNew ? "Lot ajouté" : "Lot mis à jour");
    },
    onDelete: isNew ? null : () => db.remove("lots", l.id),
  });
  $("#lot-cards")?.addEventListener("click", () => { $("#modal").close(); state.filters.lot = l.id; location.hash = "#stock"; route(); });
}

/* ════════════════════════════════════════════════════════════
   Démo (mode local)
   ════════════════════════════════════════════════════════════ */
async function loadDemo() {
  if (!confirm("Ajouter des données d'exemple ? (tu pourras les supprimer ensuite)")) return;
  const d = (k) => new Date(Date.now() - k * 864e5).toISOString().slice(0, 10);
  const l1 = await db.insert("lots", { name: "Classeur enfance 2000", source: "Leboncoin", price: 80, purchase_date: d(75), notes: "~400 cartes, base set FR" });
  const l2 = await db.insert("lots", { name: "Carton Vinted moderne", source: "Vinted", price: 45, purchase_date: d(40) });
  const l3 = await db.insert("lots", { name: "Vide-grenier Revel", source: "Vide-grenier", price: 30, purchase_date: d(12) });
  const cards = [
    { name: "Dracaufeu holo", set_name: "Set de base", number: "4/102", lot_id: l1.id, market_value: 260, status: "grading", grader: "PCA", grading_cost: 22.9, grading_sent: d(60), condition: "Near Mint" },
    { name: "Tortank holo", set_name: "Set de base", number: "2/102", lot_id: l1.id, market_value: 70, status: "sold", sale_price: 75, sale_fees: 3.76, sale_channel: "Cardmarket", sale_date: d(50) },
    { name: "Florizarre holo", set_name: "Set de base", number: "15/102", lot_id: l1.id, market_value: 55, status: "graded", grader: "PCA", grade: 9, grading_cost: 11.9, grading_sent: d(70) },
    { name: "Lot 50 communes", set_name: "Jungle / Fossile", lot_id: l1.id, market_value: 15, status: "sold", sale_price: 18, sale_fees: 0, sale_channel: "Vinted", sale_date: d(45) },
    { name: "Mewtwo holo", set_name: "Set de base", number: "10/102", lot_id: l1.id, market_value: 35, status: "listed", listed_date: d(28) },
    { name: "Nanjamo SAR", set_name: "Évolutions à Paldea", lot_id: l2.id, market_value: 48, status: "stock", language: "FR" },
    { name: "Lot 30 reverse", set_name: "Écarlate et Violet", lot_id: l2.id, market_value: 10, status: "sold", sale_price: 12, sale_fees: 0, sale_channel: "Vinted", sale_date: d(30) },
    { name: "Pikachu illustration rare", set_name: "151", lot_id: l2.id, market_value: 22, status: "sold", sale_price: 24, sale_fees: 1.21, sale_channel: "Cardmarket", sale_date: d(20) },
    { name: "Ectoplasma holo", set_name: "Fossile", number: "5/62", lot_id: l3.id, market_value: 28, status: "stock" },
    { name: "Ronflex holo", set_name: "Jungle", number: "11/64", purchase_price: 15, purchase_date: d(25), market_value: 30, status: "listed", listed_date: d(10) },
  ];
  for (const c of cards) await db.insert("cards", { language: "FR", ...c, updated_at: new Date().toISOString() });
  const demoSnaps = [[30, 380], [20, 395], [10, 410], [3, 418]];
  for (const [k, v] of demoSnaps) await db.upsertSnapshot({ date: d(k), stock_value: v, invested: 0, sales: 0 });
  await reload();
  toast("Exemple chargé");
}

/* ════════════════════════════════════════════════════════════
   Navigation et démarrage
   ════════════════════════════════════════════════════════════ */
function route() {
  const page = (location.hash || "#dashboard").slice(1);
  const p = PAGES[page] ? page : "dashboard";
  $("#page-title").textContent = PAGES[p];
  $$("#nav a").forEach((a) => a.classList.toggle("active", a.dataset.page === p));
  const v = $("#view");
  ({ dashboard: renderDashboard, stock: renderStock, lots: renderLots, grading: renderGrading, simulateur: renderSim, reglages: renderSettings })[p](v);
}

async function reload() {
  const [lots, cards, snapshots] = await Promise.all([db.all("lots"), db.all("cards"), db.all("snapshots")]);
  Object.assign(state, { lots, cards, snapshots });
  await takeSnapshot();
  route();
}

async function takeSnapshot() {
  const m = metrics();
  const snap = { date: today(), stock_value: Math.round(m.stockValue * 100) / 100, invested: Math.round(m.spent * 100) / 100, sales: Math.round(m.sales * 100) / 100 };
  if (!state.cards.length) return;
  await db.upsertSnapshot(snap);
  state.snapshots = state.snapshots.filter((s) => s.date !== snap.date).concat(snap);
}

function applyTheme() {
  document.documentElement.dataset.theme = state.settings.theme === "light" ? "light" : "dark";
}

async function startApp() {
  $("#auth").hidden = true;
  $("#app").hidden = false;
  $("#mode-badge").className = `badge ${db.mode === "supabase" ? "sync" : "local"}`;
  $("#mode-badge").textContent = db.mode === "supabase" ? "Synchronisé" : "Mode local";
  if (db.mode === "local") $("#banner").innerHTML = `<div class="banner warn">Mode local : tes données restent dans ce navigateur. Pour les retrouver sur ton téléphone et ton PC, configure Supabase (README, étape 2).</div>`;
  state.settings = { ...DEFAULTS, ...(await db.getSettings()) };
  applyTheme();
  $("#btn-add-card").onclick = () => cardModal();
  $("#btn-add-lot").onclick = () => lotModal();
  window.addEventListener("hashchange", route);
  await reload();
}

async function boot() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    db = new LocalDB();
    return startApp();
  }
  let createClient;
  try {
    ({ createClient } = await import("https://esm.sh/@supabase/supabase-js@2"));
  } catch {
    $("#auth").hidden = false;
    $("#auth-msg").textContent = "Impossible de charger Supabase. Vérifie ta connexion.";
    return;
  }
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
  db = new SupaDB(client);
  const { data } = await client.auth.getSession();
  if (data.session) return startApp();
  $("#auth").hidden = false;
  $("#auth-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const mode = e.submitter?.dataset.mode || "login";
    const fd = new FormData(e.target);
    const creds = { email: fd.get("email"), password: fd.get("password") };
    const msg = $("#auth-msg");
    msg.textContent = "…";
    const { data: res, error } = mode === "signup" ? await client.auth.signUp(creds) : await client.auth.signInWithPassword(creds);
    if (error) { msg.textContent = error.message; return; }
    if (mode === "signup" && !res.session) { msg.textContent = "Compte créé. Confirme ton e-mail puis connecte-toi."; return; }
    startApp();
  });
}

boot().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML("afterbegin", `<div class="banner warn" style="margin:12px">Erreur au démarrage : ${esc(err.message)}</div>`);
});
