import { SUPABASE_URL, SUPABASE_ANON_KEY, DEFAULTS } from "./config.js";

/* ════════════════════════════════════════════════════════════
   Constantes
   ════════════════════════════════════════════════════════════ */
const STATUSES = {
  stock: "En stock",
  listed: "En vente",
  grading: "Au grading",
  graded: "Gradée (en main)",
  sold: "Vendue",
};
const GRADERS = ["PCA", "CCC", "PSA", "CGC", "CollectAura", "SFG", "Autre"];
const SEALED_TYPES = ["Display", "ETB", "Coffret", "Booster", "Tripack", "Blister", "Bundle", "UPC", "Pokébox / Tin", "Autre"];
const CHANNELS = ["Cardmarket", "Vinted", "eBay", "Leboncoin", "Discord", "Main propre", "Autre"];
const SOURCES = ["Leboncoin", "Vinted", "Facebook", "Vide-grenier", "Cardmarket", "eBay", "Boutique", "Autre"];
const CONDITIONS = ["Mint", "Near Mint", "Excellent", "Good", "Light Played", "Played", "Poor"];
const LANGS = ["FR", "EN", "JP", "Autre"];
const PAGES = {
  dashboard: "Tableau de bord",
  stock: "Stock achat-revente",
  grading: "Grading",
  lots: "Lots",
  collection: "Ma collection",
  reglages: "Réglages",
};
const TABS = {
  stock: { cartes: "Cartes brutes", scelle: "Scellé", gradees: "Gradées", vendus: "Vendus" },
  grading: { encours: "En cours", candidates: "Candidates", gradeurs: "Mes gradeurs", simulateur: "Simulateur" },
  collection: { tout: "Tout", cartes: "Cartes", scelle: "Scellé", gradees: "Gradées" },
};

/* Stratégie et tarifs par défaut (tous modifiables dans Réglages) */
const STRAT_DEFAULTS = { seuilGradingBrut: 50, multiplicateur10: 2.5, seuilCCC: 60, seuilPSA: 200, joursAvantBaisse: 21, capitalDepart: 600 };
const TARIF_DEFAULTS = {
  t_pca_classic: 12.9, d_pca_classic: 180,
  t_pca_fast: 19.9, d_pca_fast: 30,
  t_pca_fastplus: 49.9, d_pca_fastplus: 7,
  t_ccc_50: 17, t_ccc_100: 20, t_ccc_500: 24, t_ccc_max: 28, t_ccc_ins: 2, t_ccc_express: 5,
  d_ccc_std: 35, d_ccc_express: 12,
  t_psa: 59.99, d_psa: 125,
  t_cgc: 22.61, d_cgc: 70,
};

const state = {
  lots: [], cards: [], snapshots: [],
  settings: { ...STRAT_DEFAULTS, ...TARIF_DEFAULTS, ...DEFAULTS },
  ui: { stock: "cartes", grading: "encours", collection: "tout", q: "", lot: "", status: "", sort: "updated", dir: -1 },
};
let db;

/* ════════════════════════════════════════════════════════════
   Utilitaires
   ════════════════════════════════════════════════════════════ */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const n = (v) => (v === null || v === undefined || v === "" || isNaN(Number(v)) ? 0 : Number(v));
const round2 = (v) => Math.round(n(v) * 100) / 100;
const eur = (v, d = 0) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: d, minimumFractionDigits: d }).format(n(v));
const eur2 = (v) => eur(v, 2);
const pct = (v) => (isFinite(v) ? `${v >= 0 ? "+" : ""}${Math.round(v * 100)} %` : "—");
const pctPlain = (v) => (isFinite(v) ? `${Math.round(v * 100)} %` : "—");
const signed = (v) => `${v >= 0 ? "+" : ""}${eur(v)}`;
const signedCell = (v) => (v === null || !isFinite(v) ? `<span class="muted">—</span>` : `<span class="${v >= 0 ? "pos" : "neg"}">${signed(v)}</span>`);
const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
const addDays = (d, k) => new Date(Date.parse(d) + k * 864e5).toISOString().slice(0, 10);
const dayDiff = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const fmtDate = (d) => (d ? new Date(d + "T12:00:00").toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "2-digit" }) : "—");
const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const plural = (k, one, many) => `${k} ${k > 1 ? many : one}`;

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), 2600);
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
    let { error } = await this.c.from("snapshots").upsert(s, { onConflict: "user_id,date" });
    if (error && "perso_value" in s) {
      const { perso_value, ...rest } = s;
      ({ error } = await this.c.from("snapshots").upsert(rest, { onConflict: "user_id,date" }));
    }
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
   Modèle : rubriques, types, valeurs
   ════════════════════════════════════════════════════════════ */
const lotById = (id) => state.lots.find((l) => l.id === id);
const cardById = (id) => state.cards.find((c) => c.id === id);
const isPerso = (c) => c.portfolio === "perso";
const isBiz = (c) => !isPerso(c);
const isSealed = (c) => c.kind === "sealed";
const qty = (c) => (isSealed(c) ? Math.max(1, Math.round(n(c.quantity) || 1)) : 1);
const hasGrade = (c) => c.grade !== null && c.grade !== undefined && c.grade !== "";
const isSlab = (c) => !isSealed(c) && (hasGrade(c) || c.status === "graded");
const inStock = (c) => c.status !== "sold";
const value = (c) => n(c.market_value) * qty(c);
const cardCost = (c) => (c.lot_id ? 0 : n(c.purchase_price) * qty(c));
const knownCost = (c) => (c.lot_id ? null : n(c.purchase_price) * qty(c) + n(c.grading_cost));
const acquired = (c) => c.purchase_date || lotById(c.lot_id)?.purchase_date || (c.created_at || "").slice(0, 10) || null;
const netSale = (c) => (c.status === "sold" ? n(c.sale_price) - n(c.sale_fees) : 0);
/** cartes brutes · scellé · gradées */
const category = (c) => (isSealed(c) ? "scelle" : isSlab(c) ? "gradees" : "cartes");
const gradingPlusValue = (c) => (hasGrade(c) && n(c.raw_value) > 0 ? n(c.market_value) - n(c.raw_value) - n(c.grading_cost) : null);

/** Les anciennes cartes au statut « perso » passent dans la rubrique Ma collection */
function normalize(c) {
  const out = { ...c };
  if (out.status === "perso") { out.portfolio = "perso"; out.status = "stock"; }
  if (!out.portfolio) out.portfolio = "business";
  if (!out.kind) out.kind = "card";
  return out;
}

/* ════════════════════════════════════════════════════════════
   Tarifs des gradeurs
   ════════════════════════════════════════════════════════════ */
function cccFee(s, v, express) {
  v = n(v);
  const base = v <= 50 ? n(s.t_ccc_50) : v <= 100 ? n(s.t_ccc_100) : v <= 500 ? n(s.t_ccc_500) : n(s.t_ccc_max);
  return round2(base + (v * n(s.t_ccc_ins)) / 100 + (express ? n(s.t_ccc_express) : 0));
}
const SERVICES = {
  PCA: {
    Classic: (s) => ({ fee: n(s.t_pca_classic), days: n(s.d_pca_classic) }),
    Fast: (s) => ({ fee: n(s.t_pca_fast), days: n(s.d_pca_fast) }),
    "Fast+": (s) => ({ fee: n(s.t_pca_fastplus), days: n(s.d_pca_fastplus) }),
  },
  CCC: {
    Standard: (s, v) => ({ fee: cccFee(s, v, false), days: n(s.d_ccc_std) }),
    Express: (s, v) => ({ fee: cccFee(s, v, true), days: n(s.d_ccc_express) }),
  },
  PSA: { "Standard Francfort": (s) => ({ fee: n(s.t_psa), days: n(s.d_psa) }) },
  CGC: { Economy: (s) => ({ fee: n(s.t_cgc), days: n(s.d_cgc) }) },
};
const servicesOf = (g) => Object.keys(SERVICES[g] || {});
function service(grader, svc, declared) {
  const g = SERVICES[grader];
  if (!g) return null;
  const f = g[svc] || Object.values(g)[0];
  return f(state.settings, declared);
}
function expectedBack(c) {
  if (!c.grading_sent) return null;
  const sv = service(c.grader, c.grading_service, c.declared_value || c.market_value);
  return sv ? addDays(c.grading_sent, sv.days) : null;
}
/** Gradeur conseillé pour une cote brute */
function suggestGrader(v) {
  const s = state.settings;
  const pca = service("PCA", "Classic", v), ccc = service("CCC", "Standard", v), psa = service("PSA", null, v);
  if (v >= s.seuilPSA) return { short: "PSA", text: `PSA Francfort (${eur2(psa.fee)}, ~${Math.round(psa.days / 30)} mois) : c'est la marque qui se revend le mieux sur les grosses cartes.` };
  if (v >= s.seuilCCC) return { short: "PCA ou CCC", text: `PCA Classic (${eur2(pca.fee)}, ~${Math.round(pca.days / 30)} mois) si tu peux attendre, ou CCC (${eur2(ccc.fee)}, ~${Math.round(ccc.days / 7)} semaines) si tu veux récupérer ton argent vite.` };
  return { short: "PCA", text: `PCA Classic (${eur2(pca.fee)}) : le moins cher, rentable seulement si le 10 est très probable.` };
}

/* ════════════════════════════════════════════════════════════
   Calculs
   ════════════════════════════════════════════════════════════ */
function metrics() {
  const biz = state.cards.filter(isBiz);
  const spentLots = state.lots.reduce((s, l) => s + n(l.price), 0);
  const spentSingles = biz.reduce((s, c) => s + cardCost(c), 0);
  const spentGrading = biz.reduce((s, c) => s + n(c.grading_cost), 0);
  const spent = spentLots + spentSingles + spentGrading;
  const sales = biz.reduce((s, c) => s + netSale(c), 0);
  const stock = biz.filter(inStock);
  const split = { cartes: 0, grading: 0, scelle: 0, gradees: 0 };
  const counts = { cartes: 0, grading: 0, scelle: 0, gradees: 0 };
  stock.forEach((c) => { const k = c.status === "grading" ? "grading" : category(c); split[k] += value(c); counts[k] += qty(c); });
  const stockValue = split.cartes + split.grading + split.scelle + split.gradees;
  const cash = sales - spent;
  const latent = cash + stockValue;
  const roi = spent > 0 ? latent / spent : NaN;
  const sold = biz.filter((c) => c.status === "sold" && c.sale_date && acquired(c));
  const rotation = sold.length ? sold.reduce((s, c) => s + Math.max(0, dayDiff(acquired(c), c.sale_date)), 0) / sold.length : NaN;
  const graded = state.cards.filter((c) => !isSealed(c) && hasGrade(c));
  const tens = graded.filter((c) => n(c.grade) >= 10).length;
  return {
    spent, spentLots, spentSingles, spentGrading, sales, stockValue, split, counts, cash, latent, roi, rotation,
    treasury: n(state.settings.capitalDepart) + cash,
    stockCount: stock.reduce((s, c) => s + qty(c), 0),
    soldCount: biz.filter((c) => c.status === "sold").reduce((s, c) => s + qty(c), 0),
    gradingShare: stockValue > 0 ? split.grading / stockValue : 0,
    gradedCount: graded.length, tenRate: graded.length ? tens / graded.length : NaN,
  };
}

function collectionMetrics() {
  const p = state.cards.filter((c) => isPerso(c) && inStock(c));
  const val = p.reduce((s, c) => s + value(c), 0);
  const withCost = p.filter((c) => knownCost(c) !== null);
  const cost = withCost.reduce((s, c) => s + knownCost(c), 0);
  const plus = withCost.reduce((s, c) => s + value(c), 0) - cost;
  const counts = { cartes: 0, scelle: 0, gradees: 0 };
  p.forEach((c) => (counts[category(c)] += qty(c)));
  return { items: p, value: val, cost, plus, counts, total: counts.cartes + counts.scelle + counts.gradees };
}

function lotStats(l) {
  const all = state.cards.filter((c) => c.lot_id === l.id);
  const cs = all.filter(isBiz);
  const sales = cs.reduce((s, c) => s + netSale(c), 0);
  const grading = cs.reduce((s, c) => s + n(c.grading_cost), 0);
  const remaining = cs.filter(inStock).reduce((s, c) => s + value(c), 0);
  const cost = n(l.price) + grading;
  const realized = sales - cost;
  const latent = realized + remaining;
  return {
    count: cs.reduce((s, c) => s + qty(c), 0), soldCount: cs.filter((c) => c.status === "sold").reduce((s, c) => s + qty(c), 0),
    persoCount: all.length - cs.length, sales, grading, remaining, cost, realized, latent, roi: cost > 0 ? latent / cost : NaN,
  };
}

function needsPriceDrop(c) {
  return c.status === "listed" && c.listed_date && dayDiff(c.listed_date, today()) >= state.settings.joursAvantBaisse;
}
const isCandidate = (c) => isBiz(c) && !isSealed(c) && !isSlab(c) && c.status === "stock" && n(c.market_value) >= state.settings.seuilGradingBrut;

/** Recommandation affichée dans la fiche */
function recommend(c) {
  const s = state.settings;
  const v = n(c.market_value);
  if (c.status === "sold") return null;
  if (isPerso(c)) return { tone: "info", text: "Ma collection : cet article n'est jamais compté dans tes chiffres d'achat-revente." };
  if (isSealed(c)) {
    const cost = knownCost(c);
    if (!v) return { tone: "maybe", text: "Renseigne la cote unitaire pour suivre la plus-value." };
    if (cost === null) return { tone: "info", text: `Valeur actuelle : ${eur(value(c))} pour ${plural(qty(c), "unité", "unités")}.` };
    const pv = value(c) - cost;
    return { tone: pv >= 0 ? "go" : "no", text: `Plus-value latente : ${signed(pv)} (${pct(cost > 0 ? pv / cost : NaN)}) sur ${plural(qty(c), "unité", "unités")}.` };
  }
  if (c.status === "grading") {
    const back = expectedBack(c);
    return { tone: "maybe", text: `Chez ${c.grader || "?"}${c.grading_service ? " (" + c.grading_service + ")" : ""} depuis ${c.grading_sent ? dayDiff(c.grading_sent, today()) + " j" : "?"}${back ? ` · retour prévu vers le ${fmtDate(back)}` : ""}.` };
  }
  if (isSlab(c)) return { tone: "go", text: `Gradée ${c.grader || ""} ${c.grade ?? ""} : mets-la en vente au prix des dernières ventes réussies de cette note chez ce gradeur.` };
  if (!v) return { tone: "maybe", text: "Renseigne la cote pour obtenir une recommandation." };
  if (v < s.seuilGradingBrut) return { tone: "no", text: `Cote < ${eur(s.seuilGradingBrut)} : vente brute (Cardmarket) ou en lot sur Vinted. Le grading ne couvrirait pas les frais.` };
  const sg = suggestGrader(v);
  return { tone: "maybe", text: `Inspecte-la sous lampe. Si elle est parfaite ET que le 10 se vend ≥ ${eur(v * s.multiplicateur10)} : ${sg.text} Sinon, vente brute.` };
}

/* ════════════════════════════════════════════════════════════
   Graphiques SVG (taille réelle de l'écran → texte lisible)
   ════════════════════════════════════════════════════════════ */
const tip = $("#tooltip");
function showTip(e, html) {
  tip.innerHTML = html;
  tip.hidden = false;
  const pad = 14, w = tip.offsetWidth, h = tip.offsetHeight;
  let x = e.clientX + pad, y = e.clientY + pad;
  if (x + w > innerWidth - 8) x = e.clientX - w - pad;
  if (y + h > innerHeight - 8) y = e.clientY - h - pad;
  tip.style.left = Math.max(8, x) + "px";
  tip.style.top = Math.max(8, y) + "px";
}
const hideTip = () => (tip.hidden = true);
const widthOf = (el, fallback) => Math.max(280, Math.round(el.clientWidth || fallback));

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
function lineChart(el, series, empty = "Pas encore assez d'historique.<br>La courbe se construit chaque jour où tu ouvres le dashboard.") {
  const all = series.flatMap((s) => s.points);
  const legend = `<div class="legend">${series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}${s.points.length ? ` <b>${eur(s.points.at(-1).y)}</b>` : ""}</span>`).join("")}</div>`;
  if (all.length < 2) { el.innerHTML = legend + `<div class="empty-chart">${empty}</div>`; return; }
  const W = widthOf(el, 760), narrow = W < 560;
  const H = narrow ? 220 : 280, L = 50, R = narrow ? 12 : 112, T = 12, B = 28;
  const xs = [...new Set(all.map((p) => p.x))].sort();
  const t0 = Date.parse(xs[0]), t1 = Date.parse(xs.at(-1)) || t0 + 864e5;
  const ys = all.map((p) => p.y);
  const ticks = niceTicks(Math.min(0, ...ys), Math.max(...ys));
  const yMin = ticks[0], yMax = ticks.at(-1);
  const X = (d) => L + ((Date.parse(d) - t0) / Math.max(1, t1 - t0)) * (W - L - R);
  const Y = (v) => T + (1 - (v - yMin) / (yMax - yMin || 1)) * (H - T - B);
  const xTicks = [];
  const nT = Math.min(narrow ? 3 : 6, xs.length);
  for (let i = 0; i < nT; i++) {
    const t = t0 + ((t1 - t0) * i) / Math.max(1, nT - 1);
    const d = new Date(t);
    xTicks.push({ x: L + ((t - t0) / Math.max(1, t1 - t0)) * (W - L - R), label: `${d.getDate()} ${MONTHS.at(d.getMonth())}`, anchor: i === 0 ? "start" : i === nT - 1 ? "end" : "middle" });
  }
  const paths = series.map((s) => {
    if (!s.points.length) return "";
    const d = s.points.map((p, i) => `${i ? "L" : "M"}${X(p.x).toFixed(1)} ${Y(p.y).toFixed(1)}`).join("");
    const last = s.points.at(-1);
    return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${X(last.x)}" cy="${Y(last.y)}" r="4" fill="${s.color}" stroke="var(--bg-2)" stroke-width="2"/>`;
  }).join("");
  let labels = "";
  if (!narrow) {
    const ends = series.filter((s) => s.points.length).map((s) => ({ s, y: Y(s.points.at(-1).y), v: s.points.at(-1).y })).sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 30) ends[i].y = ends[i - 1].y + 30;
    labels = ends.map((e) => `<text x="${W - R + 10}" y="${e.y - 2}" font-size="11.5" fill="var(--text-2)">${esc(e.s.name)}</text><text x="${W - R + 10}" y="${e.y + 12}" font-size="12" font-weight="600" fill="var(--text)">${shortEur(e.v)}</text>`).join("");
  }
  el.innerHTML = `${legend}
    <svg class="chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Évolution dans le temps">
      ${ticks.map((t) => `<line x1="${L}" x2="${W - R}" y1="${Y(t)}" y2="${Y(t)}" stroke="${t === 0 ? "var(--axis)" : "var(--grid)"}"/><text x="${L - 8}" y="${Y(t) + 4}" text-anchor="end" font-size="11" fill="var(--text-3)">${shortEur(t)}</text>`).join("")}
      ${xTicks.map((t) => `<text x="${t.x}" y="${H - 8}" text-anchor="${t.anchor}" font-size="11" fill="var(--text-3)">${t.label}</text>`).join("")}
      ${paths}${labels}
      <line class="xhair" x1="0" x2="0" y1="${T}" y2="${H - B}" stroke="var(--axis)" stroke-dasharray="3 3" visibility="hidden"/>
      <rect class="hit" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent"/>
    </svg>`;
  const svg = $("svg", el), hit = $(".hit", el), xh = $(".xhair", el);
  const valueAt = (s, d) => { let v = null; for (const p of s.points) { if (p.x <= d) v = p.y; else break; } return v; };
  const move = (e) => {
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const d = xs.reduce((best, x) => (Math.abs(X(x) - px) < Math.abs(X(best) - px) ? x : best), xs[0]);
    xh.setAttribute("x1", X(d)); xh.setAttribute("x2", X(d)); xh.setAttribute("visibility", "visible");
    showTip(e, `<div class="t-head">${fmtDate(d)}</div>` + series.map((s) => { const v = valueAt(s, d); return v === null ? "" : `<div class="t-row"><span><i class="sw" style="background:${s.color}"></i>${esc(s.name)}</span><b>${eur(v)}</b></div>`; }).join(""));
  };
  hit.addEventListener("pointermove", move);
  hit.addEventListener("pointerdown", move);
  hit.addEventListener("pointerleave", () => { hideTip(); xh.setAttribute("visibility", "hidden"); });
}

/** Barres verticales signées : rows = [{label, value, detail}] */
function signedBars(el, rows, { posColor = "var(--s1)", negColor = "var(--s2)", posName = "Positif", negName = "Négatif" } = {}) {
  if (!rows.length) { el.innerHTML = `<div class="empty-chart">Aucune donnée pour l'instant.</div>`; return; }
  const W = widthOf(el, 520), H = 220, L = 50, R = 8, T = 12, B = 28;
  const ticks = niceTicks(Math.min(0, ...rows.map((r) => r.value)), Math.max(0, ...rows.map((r) => r.value)));
  const yMin = ticks[0], yMax = ticks.at(-1);
  const Y = (v) => T + (1 - (v - yMin) / (yMax - yMin || 1)) * (H - T - B);
  const slot = (W - L - R) / rows.length, bw = Math.min(44, slot * 0.6);
  const every = slot < 38 ? Math.ceil(38 / slot) : 1;
  const bars = rows.map((r, i) => {
    const x = L + i * slot + (slot - bw) / 2, y0 = Y(0), y1 = Y(r.value);
    const h = Math.max(1, Math.abs(y1 - y0)), top = Math.min(y0, y1);
    const rr = Math.min(4, h / 2), up = r.value >= 0;
    const d = up
      ? `M${x} ${y0}V${top + rr}Q${x} ${top} ${x + rr} ${top}H${x + bw - rr}Q${x + bw} ${top} ${x + bw} ${top + rr}V${y0}Z`
      : `M${x} ${y0}V${top + h - rr}Q${x} ${top + h} ${x + rr} ${top + h}H${x + bw - rr}Q${x + bw} ${top + h} ${x + bw} ${top + h - rr}V${y0}Z`;
    return `<g class="bar" data-i="${i}"><rect x="${L + i * slot}" y="${T}" width="${slot}" height="${H - T - B}" fill="transparent"/><path d="${d}" fill="${up ? posColor : negColor}"/></g>
      ${i % every === 0 ? `<text x="${x + bw / 2}" y="${H - 8}" text-anchor="middle" font-size="11" fill="var(--text-3)">${esc(r.label)}</text>` : ""}`;
  }).join("");
  el.innerHTML = `
    <div class="legend"><span><i style="background:${posColor}"></i>${esc(posName)}</span><span><i style="background:${negColor}"></i>${esc(negName)}</span></div>
    <svg class="chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Barres par période">
      ${ticks.map((t) => `<line x1="${L}" x2="${W - R}" y1="${Y(t)}" y2="${Y(t)}" stroke="${t === 0 ? "var(--axis)" : "var(--grid)"}"/><text x="${L - 8}" y="${Y(t) + 4}" text-anchor="end" font-size="11" fill="var(--text-3)">${shortEur(t)}</text>`).join("")}
      ${bars}
    </svg>`;
  $$(".bar", el).forEach((g) => {
    const r = rows[+g.dataset.i];
    const show = (e) => showTip(e, `<div class="t-head">${esc(r.label)}</div><div class="t-row"><span>Résultat</span><b>${signed(r.value)}</b></div>${r.detail || ""}`);
    g.addEventListener("pointermove", show);
    g.addEventListener("pointerdown", show);
    g.addEventListener("pointerleave", hideTip);
  });
}

/** Barres horizontales : rows = [{label, value, detail, color}] */
function hBars(el, rows, { posColor = "var(--s3)", negColor = "var(--s2)", fmt = signed, empty = "Aucun lot enregistré." } = {}) {
  if (!rows.length) { el.innerHTML = `<div class="empty-chart">${empty}</div>`; return; }
  const W = widthOf(el, 340), rowH = 32, T = 4;
  const L = Math.min(170, Math.round(W * 0.38)), R = 74;
  const maxChars = Math.floor((L - 14) / 6.6);
  const H = T * 2 + rows.length * rowH;
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  const hasNeg = rows.some((r) => r.value < 0);
  const x0 = hasNeg ? L + (W - L - R) / 2 : L;
  const span = hasNeg ? (W - L - R) / 2 : W - L - R;
  const bars = rows.map((r, i) => {
    const y = T + i * rowH, w = Math.max(2, (Math.abs(r.value) / max) * span), up = r.value >= 0;
    const x = up ? x0 : x0 - w;
    const label = r.label.length > maxChars ? r.label.slice(0, maxChars - 1) + "…" : r.label;
    return `<g class="hbar" data-i="${i}"><rect x="0" y="${y}" width="${W}" height="${rowH}" fill="transparent"/>
      <text x="${L - 10}" y="${y + rowH / 2 + 4}" text-anchor="end" font-size="12" fill="var(--text-2)">${esc(label)}</text>
      <rect x="${x}" y="${y + 8}" width="${w}" height="${rowH - 16}" rx="4" fill="${r.color || (up ? posColor : negColor)}"/>
      <text x="${up ? x + w + 6 : x0 + 6}" y="${y + rowH / 2 + 4}" font-size="12" font-weight="600" fill="var(--text)">${fmt(r.value)}</text></g>`;
  }).join("");
  el.innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Barres horizontales"><line x1="${x0}" x2="${x0}" y1="0" y2="${H}" stroke="var(--axis)"/>${bars}</svg>`;
  $$(".hbar", el).forEach((g) => {
    const r = rows[+g.dataset.i];
    const show = (e) => showTip(e, `<div class="t-head">${esc(r.label)}</div>${r.detail || `<div class="t-row"><span>Valeur</span><b>${fmt(r.value)}</b></div>`}`);
    g.addEventListener("pointermove", show);
    g.addEventListener("pointerdown", show);
    g.addEventListener("pointerleave", hideTip);
  });
}

/* ════════════════════════════════════════════════════════════
   Séries temporelles (achat-revente uniquement)
   ════════════════════════════════════════════════════════════ */
function timeSeries() {
  const ev = [];
  state.lots.forEach((l) => ev.push({ d: l.purchase_date || (l.created_at || "").slice(0, 10), spent: n(l.price), sale: 0 }));
  state.cards.filter(isBiz).forEach((c) => {
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
  const snaps = [...state.snapshots].sort((a, b) => a.date.localeCompare(b.date));
  const stock = snaps.map((x) => ({ x: x.date, y: n(x.stock_value) }));
  const perso = snaps.filter((x) => x.perso_value !== undefined && x.perso_value !== null).map((x) => ({ x: x.date, y: n(x.perso_value) }));
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
  return { spent, sales, stock, perso, months };
}

/* ════════════════════════════════════════════════════════════
   Petits composants
   ════════════════════════════════════════════════════════════ */
function kpi(label, val, sub = "", cls = "", help = "") {
  return `<div class="kpi glass ${cls}"${help ? ` title="${esc(help)}"` : ""}><div class="label">${label}</div><div class="value">${val}</div><div class="sub">${sub}</div></div>`;
}
function tabsBar(page) {
  const cur = state.ui[page];
  const counts = tabCounts(page);
  return `<div class="tabs" role="tablist">${Object.entries(TABS[page]).map(([k, l]) => `<a role="tab" href="#${page}/${k}" class="${cur === k ? "active" : ""}">${l}${counts[k] !== undefined ? ` <span class="count">${counts[k]}</span>` : ""}</a>`).join("")}</div>`;
}
function tabCounts(page) {
  const c = state.cards;
  const sum = (arr) => arr.reduce((s, x) => s + qty(x), 0);
  if (page === "stock") {
    const b = c.filter(isBiz);
    return {
      cartes: sum(b.filter((x) => inStock(x) && category(x) === "cartes")),
      scelle: sum(b.filter((x) => inStock(x) && isSealed(x))),
      gradees: sum(b.filter((x) => inStock(x) && category(x) === "gradees")),
      vendus: sum(b.filter((x) => x.status === "sold")),
    };
  }
  if (page === "grading") return { encours: c.filter((x) => x.status === "grading").length, candidates: c.filter(isCandidate).length };
  if (page === "collection") {
    const p = c.filter((x) => isPerso(x) && inStock(x));
    return { tout: sum(p), cartes: sum(p.filter((x) => category(x) === "cartes")), scelle: sum(p.filter(isSealed)), gradees: sum(p.filter((x) => category(x) === "gradees")) };
  }
  return {};
}
const statusBadge = (c) => `<span class="badge st-${c.status}">${STATUSES[c.status] || c.status}</span>`;
const gradeChip = (c) => (hasGrade(c) ? `<span class="grade-chip">${esc(c.grader || "?")} <b>${esc(c.grade)}</b></span>` : `<span class="muted">—</span>`);
function metaOf(c) {
  const parts = isSealed(c)
    ? [c.sealed_type, c.set_name, c.language]
    : [c.set_name, c.number, c.language, c.condition];
  return parts.filter(Boolean).map(esc).join(" · ");
}
function nameCell(c, extra = "") {
  const tags = [];
  if (needsPriceDrop(c)) tags.push(`<span class="alert-dot" title="Baisser le prix">−10 %</span>`);
  if (isCandidate(c)) tags.push(`<span class="tag" title="Cote ≥ seuil de grading">◈ à inspecter</span>`);
  if (isPerso(c) && extra === "show-perso") tags.push(`<span class="tag">collection</span>`);
  return `<div class="card-name">${esc(c.name)} ${tags.join(" ")}</div><div class="card-meta">${metaOf(c)}</div>`;
}

/** Tableau générique. cols = [{h, v(row), r?, m?(masqué mobile), sort?}] */
function table(rows, cols, { empty = "Rien ici pour l'instant.", foot = "" } = {}) {
  if (!rows.length) return `<div class="empty">${empty}</div>`;
  const u = state.ui;
  return `<div class="table-wrap"><table><thead><tr>${cols.map((c) => `<th class="${c.r ? "r" : ""} ${c.m ? "hide-m" : ""} ${c.sort ? "sortable" : ""}" ${c.sort ? `data-sort="${c.sort}"` : ""}>${c.h}${c.sort && u.sort === c.sort ? (u.dir > 0 ? " ↑" : " ↓") : ""}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((r) => `<tr data-id="${r.id}">${cols.map((c) => `<td class="${c.r ? "r num" : ""} ${c.m ? "hide-m" : ""}">${c.v(r)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>${foot}`;
}
function bindRows(scope, redraw) {
  $$("tbody tr[data-id]", scope).forEach((tr) => tr.addEventListener("click", () => itemModal(cardById(tr.dataset.id))));
  if (redraw) $$("th[data-sort]", scope).forEach((th) => th.addEventListener("click", () => {
    const u = state.ui;
    u.dir = u.sort === th.dataset.sort ? -u.dir : 1;
    u.sort = th.dataset.sort;
    redraw();
  }));
}
const SORTS = {
  name: (c) => (c.name || "").toLowerCase(),
  value: (c) => value(c),
  date: (c) => acquired(c) || "",
  qty: (c) => qty(c),
  grade: (c) => n(c.grade),
  sold: (c) => c.sale_date || "",
  net: (c) => netSale(c),
  updated: (c) => c.updated_at || c.created_at || "",
};
function sortRows(rows) {
  const u = state.ui, key = SORTS[u.sort] || SORTS.updated;
  return rows.sort((a, b) => (key(a) > key(b) ? 1 : key(a) < key(b) ? -1 : 0) * u.dir);
}
function matchQ(c) {
  const q = state.ui.q.toLowerCase();
  return !q || [c.name, c.set_name, c.number, c.notes, c.sealed_type, c.cert_number, c.grader].some((x) => String(x || "").toLowerCase().includes(q));
}

/* ════════════════════════════════════════════════════════════
   Page : Tableau de bord (achat-revente)
   ════════════════════════════════════════════════════════════ */
function todoList() {
  const s = state.settings;
  const todo = [];
  const biz = state.cards.filter(isBiz);
  biz.forEach((c) => {
    if (needsPriceDrop(c)) todo.push({ c, t: `En vente depuis ${dayDiff(c.listed_date, today())} j : baisser le prix de 10 %`, p: 1 });
    if (c.status === "graded" && !c.listed_date) todo.push({ c, t: "Gradée reçue : à mettre en vente", p: 2 });
  });
  state.cards.forEach((c) => {
    const back = c.status === "grading" ? expectedBack(c) : null;
    if (back && dayDiff(back, today()) > 15) todo.push({ c, t: `Retour prévu le ${fmtDate(back)} dépassé : relancer ${c.grader}`, p: 1 });
  });
  const cands = biz.filter(isCandidate).sort((a, b) => n(b.market_value) - n(a.market_value));
  cands.slice(0, 3).forEach((c) => todo.push({ c, t: `À inspecter pour le grading (${suggestGrader(n(c.market_value)).short})`, p: 3 }));
  todo.sort((a, b) => a.p - b.p);
  return { todo: todo.slice(0, 9), moreCands: Math.max(0, cands.length - 3) };
}

function renderDashboard(v) {
  const m = metrics();
  const cm = collectionMetrics();
  const s = state.settings;
  const { todo, moreCands } = todoList();
  v.innerHTML = `
    <div class="kpis">
      ${kpi("Bénéfice si tout est vendu", `<span class="${m.latent >= 0 ? "pos" : "neg"}">${signed(m.latent)}</span>`, `ROI ${pct(m.roi)} · ventes + stock à la cote − dépenses`, "hero")}
      ${kpi("Trésorerie estimée", eur(m.treasury), `capital ${eur(s.capitalDepart)} ${m.cash >= 0 ? "+" : "−"} ${eur(Math.abs(m.cash))} (ventes − dépenses)`, "", "Ce qu'il te reste à investir : capital de départ + argent récupéré par les ventes − argent dépensé")}
      ${kpi("Valeur du stock", eur(m.stockValue), `${plural(m.stockCount, "article", "articles")} à la cote actuelle`)}
      ${kpi("Ventes nettes", eur(m.sales), `${plural(m.soldCount, "article vendu", "articles vendus")}, frais déduits`)}
      ${kpi("Total dépensé", eur(m.spent), `lots ${eur(m.spentLots)} · unités ${eur(m.spentSingles)} · grading ${eur(m.spentGrading)}`)}
      ${kpi("Rotation moyenne", isFinite(m.rotation) ? `${Math.round(m.rotation)} j` : "—", "de l'achat à la vente · cible ≤ 30 j")}
      ${kpi("Au grading", eur(m.split.grading), `${plural(m.counts.grading, "carte", "cartes")} · ${Math.round(m.gradingShare * 100)} % du stock · cible ≤ 25 %`)}
      ${kpi("Taux de 10", isFinite(m.tenRate) ? pctPlain(m.tenRate) : "—", `${plural(m.gradedCount, "carte notée", "cartes notées")} · détail dans Grading`)}
    </div>
    <a class="strip glass" href="#collection">
      <span class="strip-ico">♥</span>
      <span><b>Ma collection</b> · ${plural(cm.total, "article", "articles")} · ${eur(cm.value)}</span>
      <span class="muted small hide-m">comptée à part, jamais dans les chiffres ci-dessus</span>
      <span class="strip-go">→</span>
    </a>
    <div class="cards-grid">
      <section class="panel glass span-8"><h3>Évolution</h3><p class="panel-sub">Dépenses et ventes cumulées, et valeur du stock relevée chaque jour où tu ouvres le dashboard</p><div id="ch-evo"></div></section>
      <section class="panel glass span-4"><h3>Répartition du stock</h3><p class="panel-sub">Valeur à la cote actuelle</p><div id="ch-split"></div></section>
      <section class="panel glass span-6"><h3>Résultat cash par mois</h3><p class="panel-sub">Ventes nettes − dépenses du mois (un mois d'achats est normalement négatif)</p><div id="ch-months"></div></section>
      <section class="panel glass span-6"><h3>Résultat par lot</h3><p class="panel-sub">Ventes + stock restant − coût du lot et du grading</p><div id="ch-lots"></div></section>
      <section class="panel glass span-12"><h3>À faire</h3><p class="panel-sub">Généré à partir des règles de ta stratégie (Réglages)</p>
        ${todo.length ? `<div class="todo">${todo.map(({ c, t, p }) => `<button class="todo-row" data-id="${c.id}"><span class="prio p${p}"></span><span class="todo-main"><span class="card-name">${esc(c.name)}</span><span class="card-meta">${metaOf(c)}</span></span><span class="todo-txt">${esc(t)}</span></button>`).join("")}
          ${moreCands ? `<a class="todo-more" href="#grading/candidates">+ ${plural(moreCands, "autre candidate", "autres candidates")} au grading →</a>` : ""}</div>` : `<div class="empty-chart">Rien à faire, tout est à jour.</div>`}
      </section>
    </div>`;
  const ts = timeSeries();
  lineChart($("#ch-evo", v), [
    { name: "Valeur du stock", color: "var(--s1)", points: ts.stock },
    { name: "Dépenses cumulées", color: "var(--s2)", points: ts.spent },
    { name: "Ventes cumulées", color: "var(--s3)", points: ts.sales },
  ]);
  const splitRows = [
    { label: "Cartes brutes", value: m.split.cartes, color: "var(--s1)", n: m.counts.cartes },
    { label: "Au grading", value: m.split.grading, color: "var(--warn)", n: m.counts.grading },
    { label: "Gradées", value: m.split.gradees, color: "var(--s4)", n: m.counts.gradees },
    { label: "Scellé", value: m.split.scelle, color: "var(--s3)", n: m.counts.scelle },
  ].filter((r) => r.value > 0 || r.n > 0).map((r) => ({ ...r, detail: `<div class="t-row"><span>Valeur</span><b>${eur(r.value)}</b></div><div class="t-row"><span>Articles</span><b>${r.n}</b></div>` }));
  hBars($("#ch-split", v), splitRows, { fmt: (x) => eur(x), empty: "Aucun article en stock." });
  signedBars($("#ch-months", v), ts.months, { posName: "Mois positif", negName: "Mois négatif (achats)" });
  const lr = state.lots.map((l) => ({ l, st: lotStats(l) })).sort((a, b) => b.st.latent - a.st.latent).slice(0, 8).map(({ l, st }) => ({
    label: l.name, value: st.latent,
    detail: `<div class="t-row"><span>Coût (lot + grading)</span><b>${eur(st.cost)}</b></div><div class="t-row"><span>Ventes nettes</span><b>${eur(st.sales)}</b></div><div class="t-row"><span>Stock restant</span><b>${eur(st.remaining)}</b></div><div class="t-row"><span>ROI</span><b>${pct(st.roi)}</b></div>`,
  }));
  hBars($("#ch-lots", v), lr);
  $$(".todo-row", v).forEach((b) => b.addEventListener("click", () => itemModal(cardById(b.dataset.id))));
}

/* ════════════════════════════════════════════════════════════
   Page : Stock achat-revente (Cartes · Scellé · Gradées · Vendus)
   ════════════════════════════════════════════════════════════ */
function toolbar(statusOptions) {
  const u = state.ui;
  return `<div class="toolbar">
    <input class="grow" id="f-q" type="search" placeholder="Rechercher un nom, un set, un n° de certificat…" value="${esc(u.q)}" />
    ${statusOptions ? `<select id="f-status"><option value="">Tous les statuts</option>${statusOptions.map((k) => `<option value="${k}" ${u.status === k ? "selected" : ""}>${STATUSES[k]}</option>`).join("")}</select>` : ""}
    <select id="f-lot"><option value="">Tous les lots</option><option value="none" ${u.lot === "none" ? "selected" : ""}>Hors lot</option>${state.lots.map((l) => `<option value="${l.id}" ${u.lot === l.id ? "selected" : ""}>${esc(l.name)}</option>`).join("")}</select>
  </div>`;
}
function bindToolbar(v, draw) {
  const u = state.ui;
  $("#f-q", v).addEventListener("input", (e) => { u.q = e.target.value; draw(); });
  $("#f-status", v)?.addEventListener("change", (e) => { u.status = e.target.value; draw(); });
  $("#f-lot", v).addEventListener("change", (e) => { u.lot = e.target.value; draw(); });
}
const matchLot = (c) => !state.ui.lot || (state.ui.lot === "none" ? !c.lot_id : c.lot_id === state.ui.lot);
const matchStatus = (c) => !state.ui.status || c.status === state.ui.status;

function renderStock(v) {
  const tab = state.ui.stock;
  const statusOpts = { cartes: ["stock", "listed", "grading"], scelle: ["stock", "listed"], gradees: ["graded", "listed"], vendus: null }[tab];
  v.innerHTML = `${tabsBar("stock")}${toolbar(statusOpts)}<section class="panel glass flush"><div id="stock-table"></div></section>`;
  const draw = () => {
    const base = state.cards.filter((c) => isBiz(c) && matchQ(c) && matchLot(c) && matchStatus(c));
    let rows, cols, foot = "", empty;
    if (tab === "cartes") {
      rows = base.filter((c) => inStock(c) && category(c) === "cartes");
      cols = [
        { h: "Carte", sort: "name", v: (c) => nameCell(c) },
        { h: "Statut", v: statusBadge },
        { h: "Lot", m: true, v: (c) => `<span class="muted">${esc(lotById(c.lot_id)?.name || "—")}</span>` },
        { h: "Cote", r: true, sort: "value", v: (c) => (c.market_value ? eur2(c.market_value) : "—") },
        { h: "Acquise", m: true, sort: "date", v: (c) => `<span class="muted">${fmtDate(acquired(c))}</span>` },
      ];
      empty = "Aucune carte brute. Clique sur « + Ajouter » → Carte à revendre.";
    } else if (tab === "scelle") {
      rows = base.filter((c) => inStock(c) && isSealed(c));
      cols = [
        { h: "Produit", sort: "name", v: (c) => nameCell(c) },
        { h: "Qté", r: true, sort: "qty", v: (c) => qty(c) },
        { h: "Cote unit.", r: true, m: true, v: (c) => (c.market_value ? eur2(c.market_value) : "—") },
        { h: "Valeur", r: true, sort: "value", v: (c) => eur(value(c)) },
        { h: "Coût unit.", r: true, m: true, v: (c) => (c.lot_id ? `<span class="muted">lot</span>` : eur2(c.purchase_price)) },
        { h: "Plus-value", r: true, v: (c) => signedCell(knownCost(c) === null ? null : value(c) - knownCost(c)) },
        { h: "Statut", m: true, v: statusBadge },
      ];
      const tv = rows.reduce((s, c) => s + value(c), 0), tc = rows.filter((c) => knownCost(c) !== null);
      const pv = tc.reduce((s, c) => s + value(c) - knownCost(c), 0);
      foot = `<p class="table-foot">${plural(rows.reduce((s, c) => s + qty(c), 0), "produit", "produits")} · valeur ${eur(tv)} · plus-value latente <span class="${pv >= 0 ? "pos" : "neg"}">${signed(pv)}</span></p>`;
      empty = "Aucun produit scellé. Clique sur « + Ajouter » → Produit scellé.";
    } else if (tab === "gradees") {
      rows = base.filter((c) => inStock(c) && category(c) === "gradees");
      cols = [
        { h: "Carte", sort: "name", v: (c) => nameCell(c) },
        { h: "Note", sort: "grade", v: gradeChip },
        { h: "Certificat", m: true, v: (c) => `<span class="muted num">${esc(c.cert_number || "—")}</span>` },
        { h: "Cote", r: true, sort: "value", v: (c) => (c.market_value ? eur2(c.market_value) : "—") },
        { h: "Gain du grading", r: true, m: true, v: (c) => signedCell(gradingPlusValue(c)) },
        { h: "Statut", v: statusBadge },
      ];
      empty = "Aucune carte gradée en stock. Quand une carte revient du gradeur, passe-la en « Gradée (en main) ».";
    } else {
      rows = base.filter((c) => c.status === "sold");
      if (!["sold", "net", "name"].includes(state.ui.sort)) { state.ui.sort = "sold"; state.ui.dir = -1; }
      cols = [
        { h: "Article", sort: "name", v: (c) => `${nameCell(c)}${qty(c) > 1 ? `<div class="card-meta">× ${qty(c)}</div>` : ""}` },
        { h: "Type", m: true, v: (c) => ({ cartes: "Carte brute", scelle: "Scellé", gradees: "Gradée" })[category(c)] },
        { h: "Canal", m: true, v: (c) => `<span class="muted">${esc(c.sale_channel || "—")}</span>` },
        { h: "Vendu le", sort: "sold", v: (c) => `<span class="muted">${fmtDate(c.sale_date)}</span>` },
        { h: "Net", r: true, sort: "net", v: (c) => eur2(netSale(c)) },
        { h: "Marge", r: true, v: (c) => (knownCost(c) === null ? `<span class="muted" title="Coût inclus dans le lot">lot</span>` : signedCell(netSale(c) - knownCost(c))) },
      ];
      const tot = rows.reduce((s, c) => s + netSale(c), 0);
      foot = `<p class="table-foot">${plural(rows.reduce((s, c) => s + qty(c), 0), "article vendu", "articles vendus")} · ${eur(tot)} nets</p>`;
      empty = "Aucune vente pour l'instant.";
    }
    sortRows(rows);
    if (tab === "cartes" || tab === "gradees") {
      const tv = rows.reduce((s, c) => s + value(c), 0);
      foot = rows.length ? `<p class="table-foot">${plural(rows.length, "carte", "cartes")} · valeur ${eur(tv)}</p>` : "";
    }
    const el = $("#stock-table", v);
    el.innerHTML = table(rows, cols, { empty, foot });
    bindRows(el, draw);
  };
  bindToolbar(v, draw);
  draw();
}

/* ════════════════════════════════════════════════════════════
   Page : Ma collection (à part)
   ════════════════════════════════════════════════════════════ */
function renderCollection(v) {
  const cm = collectionMetrics();
  const tab = state.ui.collection;
  v.innerHTML = `
    <div class="banner info">Ta collection est <b>complètement séparée</b> : elle n'entre jamais dans les chiffres d'achat-revente du tableau de bord.</div>
    <div class="kpis">
      ${kpi("Valeur de ma collection", eur(cm.value), "à la cote actuelle", "hero perso")}
      ${kpi("Articles", `${cm.total}`, `${plural(cm.counts.cartes, "carte", "cartes")} · ${plural(cm.counts.scelle, "scellé", "scellés")} · ${plural(cm.counts.gradees, "gradée", "gradées")}`)}
      ${kpi("Coût connu", eur(cm.cost), "achats + grading (hors cartes issues de lots)")}
      ${kpi("Plus-value latente", `<span class="${cm.plus >= 0 ? "pos" : "neg"}">${signed(cm.plus)}</span>`, "sur les articles dont le coût est connu")}
    </div>
    <div class="cards-grid">
      <section class="panel glass span-12"><h3>Évolution de la valeur</h3><p class="panel-sub">Relevée chaque jour où tu ouvres le dashboard</p><div id="ch-coll"></div></section>
    </div>
    <div style="height:12px"></div>
    ${tabsBar("collection")}
    <div class="toolbar"><input class="grow" id="f-q" type="search" placeholder="Rechercher dans ma collection…" value="${esc(state.ui.q)}" /></div>
    <section class="panel glass flush"><div id="coll-table"></div></section>`;
  lineChart($("#ch-coll", v), [{ name: "Valeur de ma collection", color: "var(--s4)", points: timeSeries().perso }]);
  const draw = () => {
    let rows = cm.items.filter((c) => matchQ(c) && (tab === "tout" || category(c) === tab));
    sortRows(rows);
    const el = $("#coll-table", v);
    el.innerHTML = table(rows, [
      { h: "Article", sort: "name", v: (c) => nameCell(c) },
      { h: "Type", m: true, v: (c) => (isSealed(c) ? "Scellé" : isSlab(c) ? gradeChip(c) : "Carte") },
      { h: "Qté", r: true, m: true, v: (c) => qty(c) },
      { h: "Valeur", r: true, sort: "value", v: (c) => eur(value(c)) },
      { h: "Plus-value", r: true, v: (c) => signedCell(knownCost(c) === null ? null : value(c) - knownCost(c)) },
      { h: "Statut", m: true, v: statusBadge },
    ], { empty: "Rien dans ta collection pour l'instant. « + Ajouter » → Carte ou Scellé de ma collection." });
    bindRows(el, draw);
  };
  $("#f-q", v).addEventListener("input", (e) => { state.ui.q = e.target.value; draw(); });
  draw();
}

/* ════════════════════════════════════════════════════════════
   Page : Lots
   ════════════════════════════════════════════════════════════ */
function renderLots(v) {
  const rows = state.lots.map((l) => ({ l, st: lotStats(l) })).sort((a, b) => (b.l.purchase_date || "").localeCompare(a.l.purchase_date || ""));
  v.innerHTML = `<section class="panel glass flush">${rows.length ? `<div class="table-wrap">
    <table><thead><tr><th>Lot</th><th class="hide-m">Source</th><th class="hide-m">Acheté</th><th class="r">Prix</th><th class="r hide-m">Vendus</th><th class="r hide-m">Ventes</th><th class="r hide-m">Stock restant</th><th class="r">Résultat</th><th class="r">ROI</th></tr></thead>
    <tbody>${rows.map(({ l, st }) => `
      <tr data-lot="${l.id}">
        <td><div class="card-name">${esc(l.name)}</div><div class="card-meta">${[l.source, fmtDate(l.purchase_date)].filter(Boolean).map(esc).join(" · ")}${st.persoCount ? ` · ${st.persoCount} gardée(s) en collection` : ""}</div></td>
        <td class="hide-m muted">${esc(l.source || "—")}</td>
        <td class="hide-m muted">${fmtDate(l.purchase_date)}</td>
        <td class="r num">${eur2(l.price)}</td>
        <td class="r num hide-m">${st.soldCount}/${st.count}</td>
        <td class="r num hide-m">${eur(st.sales)}</td>
        <td class="r num hide-m">${eur(st.remaining)}</td>
        <td class="r num">${signedCell(st.latent)}</td>
        <td class="r num">${isFinite(st.roi) ? `<span class="${st.roi >= 0 ? "pos" : "neg"}">${pct(st.roi)}</span>` : "—"}</td>
      </tr>`).join("")}</tbody></table></div>
    <p class="table-foot">Cible : payer au maximum 50-60 % de la cote Cardmarket des cartes qui ont de la valeur. Les cartes que tu gardes pour ta collection sortent du calcul du lot.</p>` : `<div class="empty">Aucun lot. Clique sur « + Lot » pour enregistrer ton premier achat.</div>`}</section>`;
  $$("tbody tr[data-lot]", v).forEach((tr) => tr.addEventListener("click", () => lotModal(lotById(tr.dataset.lot))));
}

/* ════════════════════════════════════════════════════════════
   Page : Grading (En cours · Candidates · Mes gradeurs · Simulateur)
   ════════════════════════════════════════════════════════════ */
function graderStats() {
  const list = state.cards.filter((c) => !isSealed(c) && c.grader && (c.grading_sent || hasGrade(c) || c.status === "grading"));
  const by = new Map();
  list.forEach((c) => { if (!by.has(c.grader)) by.set(c.grader, []); by.get(c.grader).push(c); });
  const avg = (arr) => (arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : NaN);
  return [...by.entries()].map(([g, cs]) => {
    const back = cs.filter(hasGrade);
    const delays = cs.filter((c) => c.grading_sent && c.grading_back).map((c) => dayDiff(c.grading_sent, c.grading_back));
    const fees = cs.map((c) => n(c.grading_cost)).filter((x) => x > 0);
    const pvs = cs.map(gradingPlusValue).filter((x) => x !== null);
    return {
      g, sent: cs.length, pending: cs.filter((c) => c.status === "grading").length, back: back.length,
      delay: avg(delays), tenRate: back.length ? back.filter((c) => n(c.grade) >= 10).length / back.length : NaN,
      avgGrade: avg(back.map((c) => n(c.grade))), fee: avg(fees), pv: avg(pvs), pvN: pvs.length,
    };
  }).sort((a, b) => b.sent - a.sent);
}

function renderGrading(v) {
  const tab = state.ui.grading;
  v.innerHTML = `${tabsBar("grading")}<div id="g-body"></div>`;
  const body = $("#g-body", v);
  const s = state.settings;
  if (tab === "encours") {
    const rows = state.cards.filter((c) => c.status === "grading").sort((a, b) => (a.grading_sent || "").localeCompare(b.grading_sent || ""));
    body.innerHTML = `<section class="panel glass flush">${table(rows, [
      { h: "Carte", v: (c) => nameCell(c, "show-perso") },
      { h: "Gradeur", v: (c) => `${esc(c.grader || "—")}<div class="card-meta">${esc(c.grading_service || "")}</div>` },
      { h: "Envoyée", m: true, v: (c) => `<span class="muted">${fmtDate(c.grading_sent)}</span>` },
      { h: "Jours", r: true, v: (c) => (c.grading_sent ? dayDiff(c.grading_sent, today()) : "—") },
      { h: "Retour prévu", v: (c) => { const b = expectedBack(c); return b ? `<span class="${dayDiff(b, today()) > 15 ? "neg" : "muted"}">${fmtDate(b)}</span>` : "—"; } },
      { h: "Frais", r: true, m: true, v: (c) => eur2(c.grading_cost) },
    ], { empty: "Aucune carte chez un gradeur. Pour en envoyer une, ouvre-la et passe son statut à « Au grading »." })}</section>`;
    bindRows(body);
  } else if (tab === "candidates") {
    const rows = state.cards.filter(isCandidate).sort((a, b) => n(b.market_value) - n(a.market_value));
    body.innerHTML = `<p class="muted small" style="margin:0 0 10px">Cartes brutes en stock avec une cote ≥ ${eur(s.seuilGradingBrut)}. Passe-les à la lampe : seules les cartes parfaites valent le coup.</p>
      <section class="panel glass flush">${table(rows, [
        { h: "Carte", v: (c) => nameCell(c) },
        { h: "Cote", r: true, v: (c) => eur2(c.market_value) },
        { h: "10 mini", r: true, m: true, v: (c) => eur(n(c.market_value) * s.multiplicateur10) },
        { h: "PCA", r: true, m: true, v: (c) => eur2(service("PCA", "Classic", c.market_value).fee) },
        { h: "CCC", r: true, m: true, v: (c) => eur2(service("CCC", "Standard", c.market_value).fee) },
        { h: "Conseil", v: (c) => `<span class="tag">${suggestGrader(n(c.market_value)).short}</span>` },
      ], { empty: `Aucune carte brute au-dessus de ${eur(s.seuilGradingBrut)}.` })}</section>`;
    bindRows(body);
  } else if (tab === "gradeurs") {
    const st = graderStats();
    const done = state.cards.filter((c) => !isSealed(c) && hasGrade(c)).sort((a, b) => (b.grading_back || "").localeCompare(a.grading_back || ""));
    const dist = {};
    done.forEach((c) => { const g = n(c.grade); dist[g] = (dist[g] || 0) + 1; });
    body.innerHTML = `
      <section class="panel glass"><h3>Comparatif de tes gradeurs</h3><p class="panel-sub">Calculé sur tes vrais envois. Au bout de 2 ou 3 envois, tu sais qui te rapporte le plus.</p>
        ${st.length ? `<div class="table-wrap"><table><thead><tr><th>Gradeur</th><th class="r">Envois</th><th class="r hide-m">En cours</th><th class="r">Délai réel</th><th class="r">Taux de 10</th><th class="r hide-m">Note moy.</th><th class="r hide-m">Frais moy.</th><th class="r">Gain moyen</th></tr></thead>
          <tbody>${st.map((r) => `<tr class="static"><td><b>${esc(r.g)}</b></td><td class="r num">${r.sent}</td><td class="r num hide-m">${r.pending}</td><td class="r num">${isFinite(r.delay) ? Math.round(r.delay) + " j" : "—"}</td><td class="r num">${pctPlain(r.tenRate)}</td><td class="r num hide-m">${isFinite(r.avgGrade) ? r.avgGrade.toFixed(1) : "—"}</td><td class="r num hide-m">${isFinite(r.fee) ? eur2(r.fee) : "—"}</td><td class="r num" title="Cote gradée − cote brute à l'envoi − frais, sur ${r.pvN} carte(s)">${isFinite(r.pv) ? signedCell(r.pv) : "—"}</td></tr>`).join("")}</tbody></table></div>
          <p class="table-foot">Gain moyen = cote gradée − cote brute au moment de l'envoi − frais. Renseigne la « cote brute à l'envoi » pour qu'il soit calculé.</p>` : `<div class="empty">Pas encore d'envoi. Les statistiques apparaîtront dès ta première carte envoyée.</div>`}
      </section>
      <div style="height:12px"></div>
      <section class="panel glass flush"><div class="panel-pad"><h3>Notes reçues (${done.length})</h3><p class="panel-sub">${Object.entries(dist).sort(([a], [b]) => b - a).map(([g, k]) => `${g} : ${k}`).join(" · ") || "aucune"}</p></div>
        ${table(done, [
          { h: "Carte", v: (c) => nameCell(c, "show-perso") },
          { h: "Note", v: gradeChip },
          { h: "Délai", r: true, m: true, v: (c) => (c.grading_sent && c.grading_back ? dayDiff(c.grading_sent, c.grading_back) + " j" : "—") },
          { h: "Frais", r: true, m: true, v: (c) => eur2(c.grading_cost) },
          { h: "Gain", r: true, v: (c) => signedCell(gradingPlusValue(c)) },
          { h: "Statut", m: true, v: statusBadge },
        ], { empty: "Aucune note reçue pour l'instant." })}
      </section>`;
    bindRows(body);
  } else {
    renderSim(body);
  }
}

/* ════════════════════════════════════════════════════════════
   Simulateur : PCA, CCC et PSA côte à côte
   ════════════════════════════════════════════════════════════ */
function renderSim(el) {
  const s = state.settings;
  const opts = [
    { g: "PCA", svc: "Classic", p: [180, 85, 55] },
    { g: "CCC", svc: "Standard", p: [180, 85, 55] },
    { g: "PSA", svc: "Standard Francfort", p: [240, 105, 65] },
  ];
  el.innerHTML = `
    <section class="panel glass"><h3>Grader ou vendre brut ?</h3><p class="panel-sub">Mets les prix des dernières ventes <b>réussies</b> (Cardmarket, eBay « vendus », Vinted). Les probabilités dépendent de l'état de ta carte.</p>
      <div class="grid-form cols-3" id="sim-common">
        <label>Prix brut (€)<input type="number" step="0.01" name="raw" value="60"/></label>
        <label>Valeur déclarée (€)<input type="number" step="0.01" name="declared" value="60"/><span class="hint">sert au tarif CCC</span></label>
        <label>Port aller-retour par carte (€)<input type="number" step="0.01" name="ship" value="6"/></label>
        <label>Proba d'un 10 (%)<input type="number" name="q10" value="40"/></label>
        <label>Proba d'un 9 (%)<input type="number" name="q9" value="40"/></label>
        <label>Commission de vente (%)<input type="number" step="0.1" name="com" value="5"/></label>
      </div>
    </section>
    <div id="sim-verdict" class="sim-verdict glass"></div>
    <div class="sim-grid">${opts.map((o, i) => `
      <section class="panel glass sim-card" data-i="${i}">
        <div class="sim-head"><h3>${o.g}</h3><select name="svc">${servicesOf(o.g).map((k) => `<option ${k === o.svc ? "selected" : ""}>${esc(k)}</option>`).join("")}</select></div>
        <div class="grid-form cols-3 tight">
          <label>Prix d'un 10<input type="number" step="0.01" name="p10" value="${o.p[0]}"/></label>
          <label>Prix d'un 9<input type="number" step="0.01" name="p9" value="${o.p[1]}"/></label>
          <label>8 ou moins<input type="number" step="0.01" name="p8" value="${o.p[2]}"/></label>
        </div>
        <div class="sim-out"></div>
      </section>`).join("")}
    </div>
    <p class="muted small">Tarifs et délais utilisés : ceux de Réglages → Tarifs des gradeurs. Vérifie-les sur le site de chaque gradeur, ils changent souvent.</p>`;
  const common = $("#sim-common", el);
  const dec = $("[name=declared]", common);
  $("[name=raw]", common).addEventListener("input", (e) => { if (!dec.dataset.edited) dec.value = e.target.value; });
  dec.addEventListener("input", () => (dec.dataset.edited = "1"));
  const calc = () => {
    const g = (k) => n($(`[name=${k}]`, common).value);
    const com = g("com") / 100, raw = g("raw");
    const q10 = Math.min(1, g("q10") / 100), q9 = Math.min(1 - q10, g("q9") / 100), q8 = Math.max(0, 1 - q10 - q9);
    const brut = raw * (1 - com);
    const res = $$(".sim-card", el).map((card) => {
      const o = opts[+card.dataset.i];
      const p = (k) => n($(`[name=${k}]`, card).value);
      const sv = service(o.g, $("[name=svc]", card).value, g("declared"));
      const expected = (q10 * p("p10") + q9 * p("p9") + q8 * p("p8")) * (1 - com) - sv.fee - g("ship");
      const gain = expected - brut;
      const months = Math.max(1, sv.days / 30);
      const worst = p("p8") * (1 - com) - sv.fee - g("ship") - brut;
      const ratio = raw > 0 ? p("p10") / raw : 0;
      const ok = gain > 0 && ratio >= s.multiplicateur10 && raw >= s.seuilGradingBrut;
      return { card, o, sv, expected, gain, perMonth: gain / months, worst, ratio, ok };
    });
    const best = [...res].sort((a, b) => b.gain - a.gain)[0];
    const fastest = [...res].filter((r) => r.gain > 0).sort((a, b) => b.perMonth - a.perMonth)[0];
    res.forEach((r) => {
      r.card.classList.toggle("best", r === best && r.gain > 0);
      $(".sim-out", r.card).innerHTML = `
        <div class="sim-line"><span>Frais de grading</span><b>${eur2(r.sv.fee)}</b></div>
        <div class="sim-line"><span>Délai estimé</span><b>${r.sv.days < 30 ? r.sv.days + " j" : "~" + Math.round(r.sv.days / 30) + " mois"}</b></div>
        <div class="sim-line"><span>Espérance nette</span><b>${eur2(r.expected)}</b></div>
        <div class="sim-line big"><span>Gain vs vente brute</span><b class="${r.gain >= 0 ? "pos" : "neg"}">${r.gain >= 0 ? "+" : ""}${eur2(r.gain)}</b></div>
        <div class="sim-line"><span>Gain par mois d'attente</span><b class="${r.perMonth >= 0 ? "pos" : "neg"}">${r.perMonth >= 0 ? "+" : ""}${eur2(r.perMonth)}</b></div>
        <div class="sim-line"><span>Pire cas (8 ou moins)</span><b class="${r.worst >= 0 ? "pos" : "neg"}">${r.worst >= 0 ? "+" : ""}${eur2(r.worst)}</b></div>
        <div class="sim-line"><span>Prix du 10 / brut</span><b class="${r.ratio >= s.multiplicateur10 ? "pos" : "neg"}">${r.ratio.toFixed(1).replace(".", ",")}×</b></div>`;
    });
    const okBest = res.filter((r) => r.ok).sort((a, b) => b.gain - a.gain)[0];
    const verdict = okBest
      ? ["go", `Grader chez ${okBest.o.g}`, `+${eur2(okBest.gain)} espérés par rapport à une vente brute de ${eur2(brut)}.`]
      : best.gain > 0
        ? ["maybe", "Rentable mais risqué", `Le gain espéré est positif, mais une règle de ta stratégie n'est pas remplie (cote ≥ ${eur(s.seuilGradingBrut)} et 10 ≥ ${String(s.multiplicateur10).replace(".", ",")}× le brut).`]
        : ["no", "Vendre brut", `Aucun gradeur ne bat la vente brute (${eur2(brut)} nets).`];
    $("#sim-verdict", el).innerHTML = `<div class="verdict ${verdict[0]}">${verdict[1]}</div><p class="muted">${verdict[2]}${fastest && fastest !== (okBest || best) ? ` Si tu veux récupérer ton argent vite, ${fastest.o.g} rapporte le plus par mois d'attente.` : ""} Probabilité d'un 8 ou moins : ${Math.round(q8 * 100)} %.</p>`;
  };
  el.addEventListener("input", calc);
  el.addEventListener("change", calc);
  calc();
}

/* ════════════════════════════════════════════════════════════
   Page : Réglages
   ════════════════════════════════════════════════════════════ */
function renderSettings(v) {
  const s = state.settings;
  const num = (label, name, step = "1", hint = "") => `<label>${label}<input type="number" step="${step}" name="${name}" value="${esc(s[name])}"/>${hint ? `<span class="hint">${hint}</span>` : ""}</label>`;
  v.innerHTML = `
    <form id="set-form">
    <div class="cards-grid">
      <section class="panel glass span-6"><h3>Règles de la stratégie</h3><p class="panel-sub">Utilisées pour les conseils, le simulateur et la liste « À faire »</p>
        <div class="grid-form">
          ${num("Seuil de grading (cote brute, €)", "seuilGradingBrut", "1", "en dessous : vente brute")}
          ${num("Prix du 10 minimum (× brut)", "multiplicateur10", "0.1")}
          ${num("Seuil CCC (cote brute, €)", "seuilCCC", "1", "au-dessus : CCC proposé si tu veux du cash vite")}
          ${num("Seuil PSA (cote brute, €)", "seuilPSA", "1", "au-dessus : PSA conseillé")}
          ${num("Jours avant baisse de 10 %", "joursAvantBaisse")}
          ${num("Capital de départ (€)", "capitalDepart")}
          <label>Thème<select name="theme"><option value="dark" ${s.theme !== "light" ? "selected" : ""}>Sombre</option><option value="light" ${s.theme === "light" ? "selected" : ""}>Clair</option></select></label>
        </div>
      </section>
      <section class="panel glass span-6"><h3>Tarifs des gradeurs</h3><p class="panel-sub">Tarifs relevés en sept.-oct. 2026. Vérifie-les sur le site de chaque gradeur, ils changent souvent.</p>
        <div class="grid-form cols-4 tight">
          <div class="fieldset-title first">PCA</div>
          ${num("Classic (€)", "t_pca_classic", "0.01")}${num("Délai (j)", "d_pca_classic")}
          ${num("Fast (€)", "t_pca_fast", "0.01")}${num("Délai (j)", "d_pca_fast")}
          ${num("Fast+ (€)", "t_pca_fastplus", "0.01")}${num("Délai (j)", "d_pca_fastplus")}
          <div class="fieldset-title">CCC · selon la valeur déclarée</div>
          ${num("≤ 50 € (€)", "t_ccc_50", "0.01")}${num("≤ 100 € (€)", "t_ccc_100", "0.01")}
          ${num("≤ 500 € (€)", "t_ccc_500", "0.01")}${num("> 500 € (€)", "t_ccc_max", "0.01")}
          ${num("Assurance (% valeur)", "t_ccc_ins", "0.1")}${num("Supplément Express (€)", "t_ccc_express", "0.01")}
          ${num("Délai Standard (j)", "d_ccc_std")}${num("Délai Express (j)", "d_ccc_express")}
          <div class="fieldset-title">PSA Francfort · CGC</div>
          ${num("PSA Standard (€)", "t_psa", "0.01")}${num("Délai (j)", "d_psa")}
          ${num("CGC Economy (€)", "t_cgc", "0.01")}${num("Délai (j)", "d_cgc")}
        </div>
      </section>
      <div class="span-12 save-row"><button class="btn primary" type="submit">Enregistrer les réglages</button></div>
    </div>
    </form>
    <div style="height:12px"></div>
    <section class="panel glass"><h3>Données</h3><p class="panel-sub">${db.mode === "supabase" ? "Synchronisées avec Supabase : disponibles sur tous tes appareils." : "Mode local : stockées dans ce navigateur uniquement. Configure Supabase (README) pour la synchro."}</p>
      <div class="row">
        <button class="btn" id="exp-json">Exporter (JSON)</button>
        <button class="btn" id="exp-csv">Exporter le stock (CSV)</button>
        <label class="btn" style="flex-direction:row;color:var(--text)">Importer (JSON)<input type="file" id="imp-json" accept="application/json" hidden/></label>
        ${db.mode === "local" ? `<button class="btn" id="demo">Charger un exemple</button>` : ""}
        ${db.mode === "supabase" ? `<button class="btn danger" id="logout">Se déconnecter</button>` : ""}
      </div>
      <p class="muted small" style="margin-top:14px">Astuce : sur téléphone, ouvre le site puis « Ajouter à l'écran d'accueil » pour l'utiliser comme une app.</p>
    </section>`;
  $("#set-form", v).addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const next = { ...state.settings };
    for (const [k, val] of fd.entries()) next[k] = k === "theme" ? val : n(String(val).replace(",", "."));
    state.settings = next;
    applyTheme();
    try { await db.saveSettings(next); toast("Réglages enregistrés"); } catch (err) { toast("Erreur : " + err.message); }
  });
  $("#exp-json", v).addEventListener("click", () => download(`pokedash-${today()}.json`, JSON.stringify({ lots: state.lots, cards: state.cards, snapshots: state.snapshots, settings: state.settings }, null, 2), "application/json"));
  $("#exp-csv", v).addEventListener("click", () => {
    const cols = ["portfolio", "kind", "name", "sealed_type", "quantity", "set_name", "number", "language", "condition", "status", "market_value", "purchase_price", "purchase_date", "lot", "grader", "grading_service", "grade", "cert_number", "grading_cost", "raw_value", "grading_sent", "grading_back", "listed_date", "sale_price", "sale_fees", "sale_channel", "sale_date", "notes"];
    const rows = state.cards.map((c) => cols.map((k) => (k === "lot" ? lotById(c.lot_id)?.name || "" : k === "quantity" ? qty(c) : c[k] ?? "")));
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
    if (!confirm(`Importer ${data.lots?.length || 0} lots et ${data.cards?.length || 0} articles ? Ils seront ajoutés à tes données actuelles.`)) return;
    const idMap = {};
    for (const l of data.lots || []) {
      const { id, user_id, created_at, ...rest } = l;
      const r = await db.insert("lots", rest);
      idMap[id] = r.id;
    }
    for (const c of data.cards || []) {
      const { id, user_id, created_at, ...rest } = normalize(c);
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

function openModal(title, bodyHTML, { onSave, onDelete, saveLabel = "Enregistrer" } = {}) {
  const m = $("#modal");
  $("#modal-title").textContent = title;
  $("#modal-body").innerHTML = bodyHTML;
  $("#modal-foot").innerHTML = `${onDelete ? `<button type="button" class="btn danger" id="m-del">Supprimer</button>` : ""}<div class="right"><button class="btn ghost" value="cancel" formnovalidate>${onSave ? "Annuler" : "Fermer"}</button>${onSave ? `<button class="btn primary" value="save" id="m-save">${saveLabel}</button>` : ""}</div>`;
  const form = $("#modal-form");
  form.onsubmit = async (e) => {
    if (e.submitter?.value !== "save" || !onSave) return;
    e.preventDefault();
    const btn = $("#m-save"); btn.disabled = true;
    try { await onSave(Object.fromEntries(new FormData(form).entries())); m.close(); await reload(); }
    catch (err) { toast("Erreur : " + err.message); }
    finally { btn.disabled = false; }
  };
  if (onDelete) $("#m-del").onclick = async () => { if (!confirm("Supprimer définitivement ?")) return; try { await onDelete(); m.close(); await reload(); } catch (err) { toast("Erreur : " + err.message); } };
  if (!m.open) m.showModal();
  $("#modal-body").scrollTop = 0;
  return m;
}

function clean(obj, numeric) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = v === "" ? null : numeric.includes(k) ? Number(String(v).replace(",", ".")) : v;
  return out;
}

/** Choix du type d'article à ajouter */
function addChooser() {
  const choices = [
    { kind: "card", portfolio: "business", status: "stock", t: "Carte à revendre", d: "Carte brute achetée pour la revente", ico: "▤" },
    { kind: "sealed", portfolio: "business", status: "stock", t: "Produit scellé à revendre", d: "Display, ETB, coffret, booster… avec quantité", ico: "▣" },
    { kind: "card", portfolio: "business", status: "graded", t: "Carte gradée à revendre", d: "Achetée déjà gradée (slab)", ico: "◈" },
    { kind: "card", portfolio: "perso", status: "stock", t: "Carte de ma collection", d: "Comptée à part, jamais dans le business", ico: "♥" },
    { kind: "sealed", portfolio: "perso", status: "stock", t: "Scellé de ma collection", d: "Comptée à part, jamais dans le business", ico: "♥" },
  ];
  openModal("Ajouter", `<div class="chooser">${choices.map((c, i) => `<button type="button" class="choice" data-i="${i}"><span class="choice-ico">${c.ico}</span><span><b>${c.t}</b><span class="hint">${c.d}</span></span></button>`).join("")}
    <button type="button" class="choice" data-lot="1"><span class="choice-ico">◫</span><span><b>Lot acheté</b><span class="hint">Un achat groupé : ajoute ensuite les cartes en les rattachant au lot</span></span></button></div>`);
  $$(".choice", $("#modal-body")).forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.lot) return lotModal();
    const c = choices[+b.dataset.i];
    itemModal(null, { kind: c.kind, portfolio: c.portfolio, status: c.status });
  }));
}

const NUM_FIELDS = ["market_value", "purchase_price", "grade", "grading_cost", "sale_price", "sale_fees", "quantity", "declared_value", "raw_value", "sold_qty"];

function itemModal(c = null, preset = {}) {
  const isNew = !c;
  const d = c || { status: "stock", language: "FR", purchase_date: today(), kind: "card", portfolio: "business", quantity: 1, ...preset };
  const rec = !isNew ? recommend(d) : null;
  const title = isNew ? (d.kind === "sealed" ? "Nouveau produit scellé" : "Nouvelle carte") + (d.portfolio === "perso" ? " · ma collection" : "") : d.name;
  const body = `
    <div class="grid-form" id="card-form">
      ${rec ? `<div class="reco ${rec.tone}">${esc(rec.text)}</div>` : ""}
      <label>Rubrique<select name="portfolio"><option value="business" ${d.portfolio !== "perso" ? "selected" : ""}>Achat-revente</option><option value="perso" ${d.portfolio === "perso" ? "selected" : ""}>Ma collection</option></select></label>
      <label>Type<select name="kind"><option value="card" ${d.kind !== "sealed" ? "selected" : ""}>Carte</option><option value="sealed" ${d.kind === "sealed" ? "selected" : ""}>Produit scellé</option></select></label>
      <label class="full"><span data-k="card">Nom de la carte *</span><span data-k="sealed">Nom du produit * (ex. Display 151)</span><input name="name" required value="${esc(d.name || "")}"/></label>
      <label data-k="sealed">Type de produit<select name="sealed_type">${opt(SEALED_TYPES, d.sealed_type)}</select></label>
      <label data-k="sealed">Quantité<input type="number" name="quantity" min="1" step="1" inputmode="numeric" value="${esc(d.quantity || 1)}"/></label>
      ${field("Extension / set", "set_name", d.set_name)}
      <label data-k="card">Numéro<input name="number" value="${esc(d.number || "")}"/></label>
      <label>Langue<select name="language">${opt(LANGS, d.language, false)}</select></label>
      <label data-k="card">État<select name="condition">${opt(CONDITIONS, d.condition)}</select></label>
      <label>Statut<select name="status">${Object.entries(STATUSES).map(([k, l]) => `<option value="${k}" ${d.status === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <label><span data-k="card">Cote actuelle (€)</span><span data-k="sealed">Cote unitaire (€)</span><input type="number" step="0.01" inputmode="decimal" name="market_value" value="${esc(d.market_value ?? "")}"/></label>

      <div class="fieldset-title">Achat</div>
      <label>Lot<select name="lot_id"><option value="">Achat à l'unité</option>${state.lots.map((l) => `<option value="${l.id}" ${d.lot_id === l.id ? "selected" : ""}>${esc(l.name)}</option>`).join("")}</select></label>
      <label><span data-k="card">Prix d'achat (€)</span><span data-k="sealed">Prix d'achat unitaire (€)</span><input type="number" step="0.01" inputmode="decimal" name="purchase_price" value="${esc(d.purchase_price ?? "")}"/></label>
      ${field("Date d'achat", "purchase_date", d.purchase_date, "date")}
      <p class="hint" style="align-self:end">Si l'article vient d'un lot, son coût est déjà compté dans le prix du lot.</p>

      <div class="fieldset-title" data-sec="grading">Grading</div>
      <label data-sec="grading">Gradeur<select name="grader">${opt(GRADERS, d.grader)}</select></label>
      <label data-sec="grading">Formule<select name="grading_service"></select></label>
      <label data-sec="grading">Valeur déclarée (€)<input type="number" step="0.01" inputmode="decimal" name="declared_value" value="${esc(d.declared_value ?? "")}"/></label>
      <label data-sec="grading">Frais de grading (€)<input type="number" step="0.01" inputmode="decimal" name="grading_cost" value="${esc(d.grading_cost ?? "")}"/><span class="hint" id="fee-hint"></span></label>
      <label data-sec="grading">Cote brute à l'envoi (€)<input type="number" step="0.01" inputmode="decimal" name="raw_value" value="${esc(d.raw_value ?? "")}"/><span class="hint">sert à calculer le gain du grading</span></label>
      ${field("Date d'envoi", "grading_sent", d.grading_sent, "date", 'data-sec="grading"')}
      ${field("Date de retour", "grading_back", d.grading_back, "date", 'data-sec="grading"')}
      <label data-sec="grading">Note obtenue<input type="number" step="0.5" min="1" max="10" inputmode="decimal" name="grade" value="${esc(d.grade ?? "")}"/></label>
      <label data-sec="grading">N° de certificat<input name="cert_number" value="${esc(d.cert_number || "")}"/></label>

      <div class="fieldset-title" data-sec="sale">Vente</div>
      ${field("Mise en vente le", "listed_date", d.listed_date, "date", 'data-sec="sale"')}
      <label data-sec="sale">Canal<select name="sale_channel">${opt(CHANNELS, d.sale_channel)}</select></label>
      <label data-sec="soldqty">Quantité vendue<input type="number" min="1" step="1" inputmode="numeric" name="sold_qty" value=""/><span class="hint">le reste restera en stock</span></label>
      <label data-sec="sale">Prix de vente total (€)<input type="number" step="0.01" inputmode="decimal" name="sale_price" value="${esc(d.sale_price ?? "")}"/></label>
      ${field("Frais de vente (€)", "sale_fees", d.sale_fees, "number", 'data-sec="sale"')}
      ${field("Date de vente", "sale_date", d.sale_date, "date", 'data-sec="sale"')}
      <label class="full">Notes<textarea name="notes" rows="2">${esc(d.notes || "")}</textarea></label>
    </div>`;
  openModal(title, body, {
    onSave: async (fd) => {
      const row = clean(fd, NUM_FIELDS);
      const soldQty = row.sold_qty; delete row.sold_qty;
      if (row.kind === "sealed") {
        row.quantity = Math.max(1, Math.round(row.quantity || 1));
        Object.assign(row, { grader: null, grade: null, grading_cost: 0, grading_sent: null, grading_back: null, grading_service: null, declared_value: null, raw_value: null, cert_number: null, number: null, condition: null });
        if (["grading", "graded"].includes(row.status)) row.status = "stock";
      } else {
        row.quantity = 1;
        row.sealed_type = null;
      }
      if (row.sale_price && row.status !== "sold") row.status = "sold";
      if (row.status === "sold" && !row.sale_date) row.sale_date = today();
      if (row.status === "listed" && !row.listed_date) row.listed_date = today();
      if (row.status === "grading") {
        if (!row.grading_sent) row.grading_sent = today();
        if (row.declared_value == null && row.market_value) row.declared_value = row.market_value;
        if (row.raw_value == null && row.market_value) row.raw_value = row.market_value;
        if (row.grading_cost == null && row.grader) row.grading_cost = service(row.grader, row.grading_service, row.declared_value)?.fee ?? null;
      }
      if ((row.status === "graded" || hasGrade(row)) && row.grading_sent && !row.grading_back) row.grading_back = today();
      if (row.grading_cost == null) row.grading_cost = 0;
      if (row.sale_fees == null) row.sale_fees = 0;
      row.updated_at = new Date().toISOString();
      const q = row.quantity;
      if (row.status === "sold" && row.kind === "sealed" && soldQty && soldQty < q) {
        const sq = Math.max(1, Math.round(soldQty));
        const prev = !isNew && c.status !== "sold" ? c.status : "stock";
        const keep = { ...row, quantity: q - sq, status: prev, sale_price: null, sale_fees: 0, sale_date: null, sale_channel: null };
        const soldRow = { ...row, quantity: sq };
        if (isNew) await db.insert("cards", keep); else await db.update("cards", c.id, keep);
        await db.insert("cards", soldRow);
        toast(`${sq} vendu${sq > 1 ? "s" : ""}, ${q - sq} restant${q - sq > 1 ? "s" : ""} en stock`);
        return;
      }
      if (isNew) await db.insert("cards", row); else await db.update("cards", c.id, row);
      toast(isNew ? "Article ajouté" : "Article mis à jour");
    },
    onDelete: isNew ? null : () => db.remove("cards", c.id),
  });

  const f = $("#card-form");
  const F = (name) => $(`[name=${name}]`, f);
  const fillServices = () => {
    const list = servicesOf(F("grader").value);
    const cur = d.grading_service;
    F("grading_service").innerHTML = list.length ? list.map((k) => `<option ${k === cur ? "selected" : ""}>${esc(k)}</option>`).join("") : `<option value="">—</option>`;
  };
  const fee = F("grading_cost");
  if (fee.value === "") fee.dataset.auto = "1";
  fee.addEventListener("input", () => (fee.dataset.auto = ""));
  const autoFee = () => {
    const sv = service(F("grader").value, F("grading_service").value, F("declared_value").value || F("market_value").value);
    $("#fee-hint", f).textContent = sv ? `tarif ${F("grader").value} : ${eur2(sv.fee)} · délai ~${sv.days} j` : "";
    if (sv && fee.dataset.auto) fee.value = sv.fee.toFixed(2);
  };
  const sync = () => {
    const kind = F("kind").value, st = F("status");
    $$("[data-k]", f).forEach((el) => (el.hidden = el.dataset.k !== kind));
    $$("option[value=grading], option[value=graded]", st).forEach((o) => (o.hidden = o.disabled = kind === "sealed"));
    if (kind === "sealed" && ["grading", "graded"].includes(st.value)) st.value = "stock";
    const s = st.value;
    const showGrading = kind === "card" && (["grading", "graded"].includes(s) || F("grader").value || F("grade").value);
    const showSale = ["listed", "sold"].includes(s) || F("sale_price").value;
    $$("[data-sec=grading]", f).forEach((el) => (el.hidden = !showGrading));
    $$("[data-sec=sale]", f).forEach((el) => (el.hidden = !showSale));
    const q = Math.max(1, Math.round(n(F("quantity").value) || 1));
    $$("[data-sec=soldqty]", f).forEach((el) => (el.hidden = !(kind === "sealed" && s === "sold" && q > 1)));
    if (s === "grading") {
      if (!F("declared_value").value && F("market_value").value) F("declared_value").value = F("market_value").value;
      if (!F("raw_value").value && F("market_value").value) F("raw_value").value = F("market_value").value;
    }
    if (showGrading) autoFee();
  };
  fillServices();
  F("grader").addEventListener("change", () => { fillServices(); autoFee(); sync(); });
  F("grading_service").addEventListener("change", autoFee);
  F("declared_value").addEventListener("input", autoFee);
  ["kind", "status", "quantity", "grade", "sale_price"].forEach((k) => F(k).addEventListener("input", sync));
  ["kind", "status"].forEach((k) => F(k).addEventListener("change", sync));
  const autoSaleFees = () => {
    const fees = F("sale_fees");
    if (!n(fees.value) && F("sale_channel").value === "Cardmarket" && F("sale_price").value) fees.value = (n(F("sale_price").value) * 0.05).toFixed(2);
  };
  F("sale_price").addEventListener("change", autoSaleFees);
  F("sale_channel").addEventListener("change", autoSaleFees);
  sync();
}

function lotModal(l = null) {
  const isNew = !l;
  l = l || { purchase_date: today() };
  const st = !isNew ? lotStats(l) : null;
  const body = `
    <div class="grid-form">
      ${st ? `<div class="reco info">${st.count} articles · ventes ${eur(st.sales)} · stock restant ${eur(st.remaining)} · résultat <b class="${st.latent >= 0 ? "pos" : "neg"}">${signed(st.latent)}</b> (${pct(st.roi)})${st.persoCount ? ` · ${st.persoCount} gardé(s) en collection` : ""}</div>` : ""}
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
  $("#lot-cards")?.addEventListener("click", () => { $("#modal").close(); state.ui.lot = l.id; location.hash = "#stock/cartes"; route(); });
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
  const items = [
    { name: "Dracaufeu holo", set_name: "Set de base", number: "4/102", lot_id: l1.id, market_value: 260, raw_value: 260, declared_value: 260, status: "grading", grader: "PSA", grading_service: "Standard Francfort", grading_cost: 59.99, grading_sent: d(60), condition: "Near Mint" },
    { name: "Tortank holo", set_name: "Set de base", number: "2/102", lot_id: l1.id, market_value: 70, status: "sold", sale_price: 75, sale_fees: 3.75, sale_channel: "Cardmarket", sale_date: d(50) },
    { name: "Florizarre holo", set_name: "Set de base", number: "15/102", lot_id: l1.id, market_value: 110, raw_value: 55, status: "graded", grader: "PCA", grading_service: "Classic", grade: 9, grading_cost: 12.9, grading_sent: d(70), grading_back: d(8), cert_number: "PCA-0012345" },
    { name: "Mew ex SAR", set_name: "151", number: "205/165", lot_id: l2.id, market_value: 160, raw_value: 70, declared_value: 70, status: "graded", grader: "CCC", grading_service: "Standard", grade: 10, grading_cost: 21.4, grading_sent: d(38), grading_back: d(4), listed_date: d(3), cert_number: "CCC-88412" },
    { name: "Lot 50 communes", set_name: "Jungle / Fossile", lot_id: l1.id, market_value: 15, status: "sold", sale_price: 18, sale_fees: 0, sale_channel: "Vinted", sale_date: d(45) },
    { name: "Mewtwo holo", set_name: "Set de base", number: "10/102", lot_id: l1.id, market_value: 35, status: "listed", listed_date: d(28) },
    { name: "Nanjamo SAR", set_name: "Évolutions à Paldea", lot_id: l2.id, market_value: 68, status: "stock" },
    { name: "Pikachu illustration rare", set_name: "151", lot_id: l2.id, market_value: 22, status: "sold", sale_price: 24, sale_fees: 1.2, sale_channel: "Cardmarket", sale_date: d(20) },
    { name: "Ectoplasma holo", set_name: "Fossile", number: "5/62", lot_id: l3.id, market_value: 28, status: "stock" },
    { name: "Ronflex holo", set_name: "Jungle", number: "11/64", purchase_price: 15, purchase_date: d(25), market_value: 30, status: "listed", listed_date: d(10) },
    { kind: "sealed", sealed_type: "Display", name: "Display 151", set_name: "151", quantity: 2, purchase_price: 150, purchase_date: d(60), market_value: 185, status: "stock" },
    { kind: "sealed", sealed_type: "ETB", name: "ETB Évolutions Prismatiques", set_name: "Évolutions Prismatiques", quantity: 3, purchase_price: 60, purchase_date: d(30), market_value: 72, status: "stock" },
    { kind: "sealed", sealed_type: "ETB", name: "ETB Flammes Obsidiennes", set_name: "Flammes Obsidiennes", quantity: 1, purchase_price: 48, purchase_date: d(55), market_value: 55, status: "sold", sale_price: 68, sale_fees: 3.4, sale_channel: "Cardmarket", sale_date: d(15) },
    { portfolio: "perso", name: "Pikachu Promo Célébrations", set_name: "Célébrations", market_value: 40, purchase_price: 25, purchase_date: d(200), status: "stock" },
    { portfolio: "perso", name: "Lugia holo", set_name: "Neo Genesis", number: "9/111", market_value: 210, status: "graded", grader: "PCA", grade: 8.5, grading_cost: 12.9, purchase_price: 90, purchase_date: d(300), grading_sent: d(220), grading_back: d(40) },
    { portfolio: "perso", kind: "sealed", sealed_type: "Booster", name: "Booster Set de base", set_name: "Set de base", quantity: 2, market_value: 180, purchase_price: 120, purchase_date: d(400), status: "stock" },
  ];
  for (const c of items) await db.insert("cards", { language: "FR", kind: "card", portfolio: "business", quantity: 1, ...c, updated_at: new Date().toISOString() });
  const demoSnaps = [[30, 980, 380], [20, 1010, 395], [10, 1040, 410], [3, 1070, 418]];
  for (const [k, sv, pv] of demoSnaps) await db.upsertSnapshot({ date: d(k), stock_value: sv, invested: 0, sales: 0, perso_value: pv });
  await reload();
  toast("Exemple chargé");
}

/* ════════════════════════════════════════════════════════════
   Navigation et démarrage
   ════════════════════════════════════════════════════════════ */
function route() {
  let [page, sub] = (location.hash || "#dashboard").slice(1).split("/");
  if (page === "simulateur") { page = "grading"; sub = "simulateur"; }
  if (page === "perso") page = "collection";
  const p = PAGES[page] ? page : "dashboard";
  if (TABS[p] && sub && TABS[p][sub]) {
    if (state.ui[p] !== sub) { state.ui.status = ""; }
    state.ui[p] = sub;
  }
  $("#page-title").textContent = PAGES[p];
  $$("#nav a").forEach((a) => a.classList.toggle("active", a.dataset.page === p));
  const v = $("#view");
  hideTip();
  ({ dashboard: renderDashboard, stock: renderStock, grading: renderGrading, lots: renderLots, collection: renderCollection, reglages: renderSettings })[p](v);
}

async function reload() {
  const [lots, cards, snapshots] = await Promise.all([db.all("lots"), db.all("cards"), db.all("snapshots")]);
  Object.assign(state, { lots, cards: cards.map(normalize), snapshots });
  await takeSnapshot();
  route();
}

async function takeSnapshot() {
  if (!state.cards.length) return;
  const m = metrics(), cm = collectionMetrics();
  const snap = { date: today(), stock_value: round2(m.stockValue), invested: round2(m.spent), sales: round2(m.sales), perso_value: round2(cm.value) };
  await db.upsertSnapshot(snap);
  state.snapshots = state.snapshots.filter((s) => s.date !== snap.date).concat(snap);
}

function applyTheme() {
  document.documentElement.dataset.theme = state.settings.theme === "light" ? "light" : "dark";
}

let lastW = innerWidth, rz;
addEventListener("resize", () => {
  clearTimeout(rz);
  rz = setTimeout(() => {
    if (Math.abs(innerWidth - lastW) < 40 || $("#app").hidden || $("#modal").open) return;
    lastW = innerWidth;
    route();
  }, 200);
});

async function startApp() {
  $("#auth").hidden = true;
  $("#app").hidden = false;
  $("#mode-badge").className = `badge ${db.mode === "supabase" ? "sync" : "local"}`;
  $("#mode-badge").textContent = db.mode === "supabase" ? "Synchronisé" : "Mode local";
  if (db.mode === "local") $("#banner").innerHTML = `<div class="banner warn">Mode local : tes données restent dans ce navigateur. Pour les retrouver sur ton téléphone et ton PC, configure Supabase (README, étape 2).</div>`;
  state.settings = { ...STRAT_DEFAULTS, ...TARIF_DEFAULTS, ...DEFAULTS, ...(await db.getSettings()) };
  applyTheme();
  $("#btn-add").onclick = () => addChooser();
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
