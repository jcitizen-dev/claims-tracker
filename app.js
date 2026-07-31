import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

/* ── Column definitions ─────────────────────────────────────────────────────
 * Both boards share this list. What differs per board is which keys are
 * visible by default -- see BOARDS below. Everything is stored either way, so
 * switching a Collections column on is just a checkbox in the Columns menu.
 * ------------------------------------------------------------------------ */
const COLUMNS = [
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

const COL = Object.fromEntries(COLUMNS.map((c) => [c.key, c]));
const ALL_KEYS = COLUMNS.map((c) => c.key);

const BOARDS = {
  subrogation: {
    label: "Subrogations",
    defaultCols: ALL_KEYS,
    defaultSort: { key: "amount", dir: "desc" },
  },
  collection: {
    label: "Collections",
    defaultCols: ["car_num", "customer_name"],
    defaultSort: { key: "created_at", dir: "asc" },
  },
};

/* ── Setup ──────────────────────────────────────────────────────────────── */
const cfg = window.CLAIMS_CONFIG || {};
const $ = (id) => document.getElementById(id);

if (!cfg.SUPABASE_URL || cfg.SUPABASE_URL.startsWith("PASTE")) {
  $("setupErr").hidden = false;
  $("setupErr").innerHTML =
    "<strong>Not configured yet.</strong><br>Fill in <code>SUPABASE_URL</code> " +
    "and <code>SUPABASE_ANON_KEY</code> in <code>config.js</code>, then reload.";
  throw new Error("Supabase config missing");
}

const sb = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

/* ── State ──────────────────────────────────────────────────────────────── */
let rows = [];                                   // every row, both boards
let board = "subrogation";
let filter = "";
let sort = { ...BOARDS[board].defaultSort };
let editing = null;                              // { id, key } while a cell has focus
let channel = null;

const visibleCols = {
  subrogation: loadCols("subrogation"),
  collection: loadCols("collection"),
};

function loadCols(b) {
  try {
    const saved = JSON.parse(localStorage.getItem("claims.cols." + b) || "null");
    if (Array.isArray(saved) && saved.length) {
      return ALL_KEYS.filter((k) => saved.includes(k));
    }
  } catch { /* fall through to defaults */ }
  return [...BOARDS[b].defaultCols];
}

function saveCols(b) {
  localStorage.setItem("claims.cols." + b, JSON.stringify(visibleCols[b]));
}

/* ── Formatting & parsing ───────────────────────────────────────────────── */
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

const fmtMoney = (v) =>
  v === null || v === undefined || v === "" ? "" : usd.format(Number(v));

// Returns a number, null for blank, or undefined when it isn't a number.
function parseMoney(text) {
  const t = String(text).replace(/[$,\s]/g, "").trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : undefined;
}

// M/D/YYYY -> timestamp, for sorting only. Never rewrites what was typed.
function dateValue(s) {
  const m = /^\s*(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})\s*$/.exec(s || "");
  if (!m) return null;
  let y = +m[3];
  if (y < 100) y += y < 70 ? 2000 : 1900;
  return new Date(y, +m[1] - 1, +m[2]).getTime();
}

const display = (row, key) =>
  COL[key].type === "money" ? fmtMoney(row[key]) : row[key] ?? "";

// What goes in the cell while it's being edited -- no "$" or commas in the way.
const editable = (row, key) =>
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

function compare(a, b) {
  const av = sortKeyFor(a, sort.key);
  const bv = sortKeyFor(b, sort.key);

  // Blanks always sink to the bottom, whichever way the column is sorted.
  const ae = av === null || av === undefined || Number.isNaN(av);
  const be = bv === null || bv === undefined || Number.isNaN(bv);
  if (ae && be) return Date.parse(a.created_at) - Date.parse(b.created_at);
  if (ae) return 1;
  if (be) return -1;

  const r = av < bv ? -1 : av > bv ? 1 : 0;
  if (r === 0) return Date.parse(a.created_at) - Date.parse(b.created_at);
  return sort.dir === "desc" ? -r : r;
}

function currentRows() {
  const cols = visibleCols[board];
  const q = filter.trim().toLowerCase();
  return rows
    .filter((r) => r.board === board)
    .filter((r) => {
      if (!q) return true;
      return cols.some((k) => String(display(r, k)).toLowerCase().includes(q));
    })
    .sort(compare);
}

/* ── Rendering ──────────────────────────────────────────────────────────── */
// A re-render rebuilds <tbody> from scratch, which would tear the DOM node out
// from under whoever is mid-edit. So while a cell has focus we defer instead,
// and catch up as soon as it blurs.
let pendingRender = false;

function render() {
  if (editing) {
    pendingRender = true;
    return;
  }
  const cols = visibleCols[board];
  const data = currentRows();

  $("printTitle").textContent =
    BOARDS[board].label + " — " + new Date().toLocaleDateString("en-US");

  // Header
  const thead = $("thead");
  thead.innerHTML = "";
  const tr = document.createElement("tr");
  for (const key of cols) {
    const c = COL[key];
    const th = document.createElement("th");
    if (c.type === "money") th.className = "num";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = c.label;
    if (sort.key === key) {
      const arrow = document.createElement("span");
      arrow.className = "arrow";
      arrow.textContent = sort.dir === "desc" ? "▼" : "▲";
      btn.append(arrow);
    }
    btn.addEventListener("click", () => {
      if (sort.key === key) {
        sort.dir = sort.dir === "desc" ? "asc" : "desc";
      } else {
        sort = { key, dir: c.type === "money" ? "desc" : "asc" };
      }
      render();
    });
    th.append(btn);
    tr.append(th);
  }
  const thDel = document.createElement("th");
  thDel.className = "rowdel";
  tr.append(thDel);
  thead.append(tr);

  // Body
  const tbody = $("tbody");
  tbody.innerHTML = "";
  for (const row of data) tbody.append(renderRow(row, cols));

  const total = rows.filter((r) => r.board === board).length;
  $("count").textContent =
    filter.trim() ? `${data.length} of ${total}` : `${total} row${total === 1 ? "" : "s"}`;

  $("empty").hidden = data.length > 0;
  $("empty").textContent = total === 0
    ? "No rows yet. Use “+ Add Row” to start."
    : "Nothing matches that search.";
}

function renderRow(row, cols) {
  const tr = document.createElement("tr");
  tr.dataset.id = row.id;

  for (const key of cols) {
    const c = COL[key];
    const td = document.createElement("td");
    const cell = document.createElement("div");
    cell.className =
      "cell" + (c.type === "money" ? " num" : "") + (c.mono ? " mono" : "");
    cell.contentEditable = "plaintext-only";
    // Safari/Firefox fall back to "true"; the paste handler below covers it.
    if (cell.contentEditable !== "plaintext-only") cell.contentEditable = "true";
    cell.dataset.id = row.id;
    cell.dataset.key = key;
    cell.textContent = display(row, key);
    td.append(cell);
    tr.append(td);
  }

  const tdDel = document.createElement("td");
  tdDel.className = "rowdel";
  const del = document.createElement("button");
  del.className = "del";
  del.type = "button";
  del.title = "Delete row";
  del.setAttribute("aria-label", "Delete row");
  del.textContent = "×";
  del.addEventListener("click", () => askDelete(row));
  tdDel.append(del);
  tr.append(tdDel);

  return tr;
}

function flash(id) {
  const tr = $("tbody").querySelector(`tr[data-id="${CSS.escape(id)}"]`);
  if (!tr) return;
  tr.classList.remove("flash");
  void tr.offsetWidth;
  tr.classList.add("flash");
}

/* ── Cell editing ───────────────────────────────────────────────────────── */
const tbody = $("tbody");

tbody.addEventListener("focusin", (e) => {
  const cell = e.target.closest(".cell");
  if (!cell) return;
  const row = rows.find((r) => r.id === cell.dataset.id);
  if (!row) return;
  editing = { id: cell.dataset.id, key: cell.dataset.key };
  cell.dataset.before = editable(row, cell.dataset.key);
  cell.textContent = cell.dataset.before;
});

tbody.addEventListener("focusout", async (e) => {
  const cell = e.target.closest(".cell");
  if (!cell) return;
  editing = null;
  await commit(cell);
  if (pendingRender) {
    pendingRender = false;
    render();
  }
});

tbody.addEventListener("keydown", (e) => {
  const cell = e.target.closest(".cell");
  if (!cell) return;

  if (e.key === "Enter") {
    e.preventDefault();
    cell.blur();
  } else if (e.key === "Escape") {
    e.preventDefault();
    cell.textContent = cell.dataset.before ?? "";
    cell.dataset.cancel = "1";
    cell.blur();
  } else if (e.key === "Tab") {
    e.preventDefault();
    const cells = [...tbody.querySelectorAll(".cell")];
    const next = cells[cells.indexOf(cell) + (e.shiftKey ? -1 : 1)];
    cell.blur();
    next?.focus();
  }
});

// contenteditable="true" happily accepts rich HTML on paste; force plain text.
tbody.addEventListener("paste", (e) => {
  if (!e.target.closest(".cell")) return;
  e.preventDefault();
  const text = (e.clipboardData || window.clipboardData)
    .getData("text/plain")
    .replace(/\s+/g, " ")
    .trim();
  document.execCommand("insertText", false, text);
});

async function commit(cell) {
  const { id, key } = cell.dataset;
  const row = rows.find((r) => r.id === id);
  if (!row) return;

  if (cell.dataset.cancel) {
    delete cell.dataset.cancel;
    cell.textContent = display(row, key);
    return;
  }

  const raw = cell.textContent.replace(/\s+/g, " ").trim();
  const before = cell.dataset.before ?? "";
  if (raw === before) {
    cell.textContent = display(row, key);
    return;
  }

  let value;
  if (COL[key].type === "money") {
    value = parseMoney(raw);
    if (value === undefined) {
      toast(`“${raw}” isn’t an amount.`, true);
      cell.textContent = display(row, key);
      return;
    }
  } else {
    value = raw === "" ? null : raw;
  }

  const previous = row[key];
  row[key] = value;                 // optimistic -- keeps typing responsive
  cell.textContent = display(row, key);

  const { error } = await sb.from("claims").update({ [key]: value }).eq("id", id);

  if (error) {
    row[key] = previous;
    cell.textContent = display(row, key);
    toast("Could not save: " + error.message, true);
    return;
  }

  // An amount edit changes where the row belongs; re-sort but keep focus sane.
  if (sort.key === key) render();
  flash(id);
}

/* ── Add / delete ───────────────────────────────────────────────────────── */
$("addRow").addEventListener("click", async () => {
  const btn = $("addRow");
  btn.disabled = true;
  const { data, error } = await sb
    .from("claims")
    .insert({ board })
    .select()
    .single();
  btn.disabled = false;

  if (error) return toast("Could not add a row: " + error.message, true);

  upsertLocal(data);
  render();

  const tr = tbody.querySelector(`tr[data-id="${CSS.escape(data.id)}"]`);
  tr?.scrollIntoView({ block: "nearest" });
  tr?.querySelector(".cell")?.focus();
});

let pendingDelete = null;

function askDelete(row) {
  pendingDelete = row;
  const who = (row.customer_name || "").trim();
  const car = (row.car_num || "").trim();
  const label = who || car ? [car, who].filter(Boolean).join(" — ") : "this blank row";
  $("modalBody").textContent = `${label} will be permanently removed for everyone.`;
  $("modal").hidden = false;
  $("modalCancel").focus();
}

function closeModal() {
  $("modal").hidden = true;
  pendingDelete = null;
}

$("modalCancel").addEventListener("click", closeModal);
$("modal").addEventListener("click", (e) => {
  if (e.target === $("modal")) closeModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("modal").hidden) closeModal();
});

$("modalConfirm").addEventListener("click", async () => {
  const row = pendingDelete;
  if (!row) return;
  closeModal();
  const { error } = await sb.from("claims").delete().eq("id", row.id);
  if (error) return toast("Could not delete: " + error.message, true);
  rows = rows.filter((r) => r.id !== row.id);
  render();
  toast("Row deleted.");
});

/* ── Tabs, search, columns, print ───────────────────────────────────────── */
$("tabs").addEventListener("click", (e) => {
  const tab = e.target.closest(".tab");
  if (!tab) return;
  board = tab.dataset.board;
  sort = { ...BOARDS[board].defaultSort };
  filter = "";
  $("search").value = "";
  for (const t of $("tabs").children) t.classList.toggle("is-active", t === tab);
  buildColMenu();
  render();
});

$("search").addEventListener("input", (e) => {
  filter = e.target.value;
  render();
});

$("printBtn").addEventListener("click", () => window.print());

$("colBtn").addEventListener("click", () => {
  const pop = $("colPop");
  pop.hidden = !pop.hidden;
  $("colBtn").setAttribute("aria-expanded", String(!pop.hidden));
});

document.addEventListener("click", (e) => {
  if (!e.target.closest(".menu") && !$("colPop").hidden) {
    $("colPop").hidden = true;
    $("colBtn").setAttribute("aria-expanded", "false");
  }
});

function buildColMenu() {
  const pop = $("colPop");
  pop.innerHTML = "";
  for (const c of COLUMNS) {
    const label = document.createElement("label");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = visibleCols[board].includes(c.key);
    box.addEventListener("change", () => {
      const next = box.checked
        ? [...visibleCols[board], c.key]
        : visibleCols[board].filter((k) => k !== c.key);

      if (!next.length) {           // never leave a table with zero columns
        box.checked = true;
        return;
      }
      visibleCols[board] = ALL_KEYS.filter((k) => next.includes(k));
      saveCols(board);
      if (!visibleCols[board].includes(sort.key) && sort.key !== "created_at") {
        sort = { ...BOARDS[board].defaultSort };
      }
      render();
    });
    label.append(box, document.createTextNode(c.label));
    pop.append(label);
  }
}

/* ── Toast ──────────────────────────────────────────────────────────────── */
let toastTimer;
function toast(msg, bad = false) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.toggle("bad", bad);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), bad ? 5000 : 1800);
}

/* ── Data loading + realtime ────────────────────────────────────────────── */
function upsertLocal(row) {
  const i = rows.findIndex((r) => r.id === row.id);
  if (i === -1) rows.push(row);
  else rows[i] = row;
}

async function load() {
  const { data, error } = await sb.from("claims").select("*");
  if (error) return toast("Could not load claims: " + error.message, true);
  rows = data;
  render();
}

function subscribe() {
  if (channel) sb.removeChannel(channel);
  channel = sb
    .channel("claims-live")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "claims" },
      (payload) => {
        if (payload.eventType === "DELETE") {
          rows = rows.filter((r) => r.id !== payload.old.id);
        } else {
          // Don't yank a cell out from under someone mid-edit.
          if (editing && editing.id === payload.new.id) {
            const keep = rows.find((r) => r.id === payload.new.id);
            if (keep) {
              const held = keep[editing.key];
              upsertLocal({ ...payload.new, [editing.key]: held });
              return;
            }
          }
          upsertLocal(payload.new);
        }
        render();
      }
    )
    .subscribe();
}

/* ── Auth ───────────────────────────────────────────────────────────────── */
$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("loginBtn");
  const err = $("loginErr");
  err.hidden = true;
  btn.disabled = true;
  btn.textContent = "Signing in…";

  const { error } = await sb.auth.signInWithPassword({
    email: $("email").value.trim(),
    password: $("password").value,
  });

  btn.disabled = false;
  btn.textContent = "Sign in";

  if (error) {
    err.textContent = error.message;
    err.hidden = false;
    $("password").select();
  }
});

$("signOut").addEventListener("click", async () => {
  await sb.auth.signOut();
});

let started = false;

sb.auth.onAuthStateChange(async (_event, session) => {
  if (session) {
    $("login").hidden = true;
    $("app").hidden = false;
    $("userEmail").textContent = session.user.email;
    sb.realtime.setAuth(session.access_token);
    if (!started) {
      started = true;
      buildColMenu();
      await load();
      subscribe();
    }
  } else {
    started = false;
    rows = [];
    if (channel) { sb.removeChannel(channel); channel = null; }
    $("app").hidden = true;
    $("login").hidden = false;
    $("password").value = "";
  }
});

// Kick things off — onAuthStateChange fires with the restored session, if any.
sb.auth.getSession().then(({ data }) => {
  if (!data.session) {
    $("login").hidden = false;
    $("email").focus();
  }
});
