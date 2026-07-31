/* Shared by both front ends: the standard table view (index.html) and the
 * large-print view (big.html). Columns, money handling and sorting live here
 * so the two can never drift apart.
 */
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

/* ── Columns ────────────────────────────────────────────────────────────── */
export const COLUMNS = [
  { key: "car_num",       label: "Car #",         type: "text" },
  { key: "amount",        label: "Amount",        type: "money" },
  { key: "date_of_loss",  label: "Date of Loss",  type: "date" },
  { key: "claim_num",     label: "Claim #",       type: "text" },
  { key: "date_received", label: "Date Received", type: "date" },
  { key: "customer_name", label: "Customer Name", type: "text" },
  { key: "stage",         label: "Stage",         type: "text" },
  { key: "status",        label: "Status",        type: "text" },
  { key: "vin",           label: "VIN",           type: "text", mono: true },
  { key: "contract",      label: "Contract",      type: "text" },
];

export const COL = Object.fromEntries(COLUMNS.map((c) => [c.key, c]));
export const ALL_KEYS = COLUMNS.map((c) => c.key);

export const BOARDS = {
  subrogation: {
    label: "Subrogations",
    defaultCols: ALL_KEYS,
    defaultSort: { key: "amount", dir: "desc" },
    // What the large-print view shows up front, before "more details".
    primary: ["customer_name", "amount", "car_num"],
  },
  collection: {
    label: "Collections",
    defaultCols: ["car_num", "customer_name"],
    defaultSort: { key: "created_at", dir: "asc" },
    primary: ["customer_name", "car_num"],
  },
};

/* ── Connection ─────────────────────────────────────────────────────────── */
const cfg = window.CLAIMS_CONFIG || {};
const filled = (v) => !!v && !String(v).startsWith("PASTE");
// Both values matter: a real URL with a placeholder key would sail past this
// check and then fail at request time with a far less obvious error.
export const configured = filled(cfg.SUPABASE_URL) && filled(cfg.SUPABASE_ANON_KEY);

export const sb = configured
  ? createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY)
  : null;

export const $ = (id) => document.getElementById(id);

export function showSetupError() {
  const el = $("setupErr");
  if (!el) return;
  el.hidden = false;
  el.innerHTML =
    "<strong>Not configured yet.</strong><br>Fill in <code>SUPABASE_URL</code> " +
    "and <code>SUPABASE_ANON_KEY</code> in <code>config.js</code>, then reload.";
}

/* ── Formatting & parsing ───────────────────────────────────────────────── */
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export const fmtMoney = (v) =>
  v === null || v === undefined || v === "" ? "" : usd.format(Number(v));

// Number, null for blank, or undefined when it isn't a number at all.
export function parseMoney(text) {
  const t = String(text).replace(/[$,\s]/g, "").trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : undefined;
}

// M/D/YYYY -> timestamp, for sorting only. Never rewrites what was typed.
export function dateValue(s) {
  const m = /^\s*(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})\s*$/.exec(s || "");
  if (!m) return null;
  let y = +m[3];
  if (y < 100) y += y < 70 ? 2000 : 1900;
  return new Date(y, +m[1] - 1, +m[2]).getTime();
}

export const display = (row, key) =>
  COL[key].type === "money" ? fmtMoney(row[key]) : row[key] ?? "";

// What belongs in the box while it's being edited: no "$" or commas in the way.
export const editable = (row, key) =>
  COL[key].type === "money"
    ? row[key] === null || row[key] === undefined
      ? ""
      : String(row[key])
    : row[key] ?? "";

/* ── Sorting ────────────────────────────────────────────────────────────── */
function sortKeyFor(row, key) {
  if (key === "created_at") return Date.parse(row.created_at);
  const type = COL[key]?.type;
  if (type === "money") return row[key] === null ? null : Number(row[key]);
  if (type === "date") return dateValue(row[key]);
  const s = (row[key] ?? "").trim().toLowerCase();
  return s === "" ? null : s;
}

export function sortRows(list, sort) {
  return [...list].sort((a, b) => {
    const av = sortKeyFor(a, sort.key);
    const bv = sortKeyFor(b, sort.key);

    // Blanks always sink, whichever way the column is sorted.
    const ae = av === null || av === undefined || Number.isNaN(av);
    const be = bv === null || bv === undefined || Number.isNaN(bv);
    if (ae && be) return Date.parse(a.created_at) - Date.parse(b.created_at);
    if (ae) return 1;
    if (be) return -1;

    const r = av < bv ? -1 : av > bv ? 1 : 0;
    if (r === 0) return Date.parse(a.created_at) - Date.parse(b.created_at);
    return sort.dir === "desc" ? -r : r;
  });
}

/* ── Data access ────────────────────────────────────────────────────────── */
// Deletes are soft: the row keeps existing with `deleted_at` set, so nothing is
// ever actually lost and anything can be brought back from the dashboard. See
// the README for the one-line restore.
export const loadClaims = () =>
  sb.from("claims").select("*").is("deleted_at", null);

export const updateCell = (id, key, value) =>
  sb.from("claims").update({ [key]: value }).eq("id", id);

export const insertRow = (board) =>
  sb.from("claims").insert({ board }).select().single();

export const deleteRow = (id) =>
  sb.from("claims").update({ deleted_at: new Date().toISOString() }).eq("id", id);

// A soft delete reaches other browsers as an UPDATE, not a DELETE, so both
// views need to recognise it as "this row is gone".
export const isDeleted = (row) => row?.deleted_at != null;

export function subscribeClaims(handler) {
  return sb
    .channel("claims-live")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "claims" },
      handler
    )
    .subscribe();
}

/* ── Start ──────────────────────────────────────────────────────────────── */
// There is no sign-in: the page opens straight into the data, by request.
// Access is therefore controlled only by who knows the URL -- the RLS policy
// in supabase-setup.sql grants the anonymous role full read and write.
export function start(onReady) {
  $("app").hidden = false;
  return onReady();
}

/* ── Toast ──────────────────────────────────────────────────────────────── */
let toastTimer;
export function toast(msg, bad = false) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.toggle("bad", bad);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), bad ? 5000 : 1800);
}
