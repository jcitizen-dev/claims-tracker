/* Standard table view. Dense grid, every cell editable in place. */
import {
  COLUMNS, COL, ALL_KEYS, BOARDS,
  configured, $, showSetupError,
  display, editable, parseMoney, sortRows,
  loadClaims, updateCell, insertRow, deleteRow, subscribeClaims, isDeleted,
  start, toast,
} from "./shared.js?v=20260731c";

if (!configured) {
  showSetupError();
  throw new Error("Supabase config missing");
}

/* ── State ──────────────────────────────────────────────────────────────── */
let rows = [];
let board = "subrogation";
let filter = "";
let sort = { ...BOARDS[board].defaultSort };
let editing = null;      // { id, key } while a cell has focus

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

const saveCols = (b) =>
  localStorage.setItem("claims.cols." + b, JSON.stringify(visibleCols[b]));

function currentRows() {
  const cols = visibleCols[board];
  const q = filter.trim().toLowerCase();
  const list = rows
    .filter((r) => r.board === board)
    .filter((r) =>
      !q || cols.some((k) => String(display(r, k)).toLowerCase().includes(q))
    );
  return sortRows(list, sort);
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
      if (sort.key === key) sort.dir = sort.dir === "desc" ? "asc" : "desc";
      else sort = { key, dir: c.type === "money" ? "desc" : "asc" };
      render();
    });
    th.append(btn);
    tr.append(th);
  }
  const thDel = document.createElement("th");
  thDel.className = "rowdel";
  tr.append(thDel);
  thead.append(tr);

  const tbody = $("tbody");
  tbody.innerHTML = "";
  for (const row of data) tbody.append(renderRow(row, cols));

  const total = rows.filter((r) => r.board === board).length;
  $("count").textContent = filter.trim()
    ? `${data.length} of ${total}`
    : `${total} row${total === 1 ? "" : "s"}`;

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
    // Safari/Firefox fall back to "true"; the paste handler covers that case.
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
  if (raw === (cell.dataset.before ?? "")) {
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
  row[key] = value;                  // optimistic -- keeps typing responsive
  cell.textContent = display(row, key);

  const { error } = await updateCell(id, key, value);
  if (error) {
    row[key] = previous;
    cell.textContent = display(row, key);
    toast("Could not save: " + error.message, true);
    return;
  }

  if (sort.key === key) render();    // the row may belong somewhere else now
  flash(id);
}

/* ── Add / delete ───────────────────────────────────────────────────────── */
$("addRow").addEventListener("click", async () => {
  const btn = $("addRow");
  btn.disabled = true;
  const { data, error } = await insertRow(board);
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
  $("modalBody").textContent =
    `${label} will disappear for everyone. Nothing is destroyed — it can be ` +
    `restored from the database if this was a mistake.`;
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
  const { error } = await deleteRow(row.id);
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

      if (!next.length) {          // never leave a table with zero columns
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

/* ── Data + realtime ────────────────────────────────────────────────────── */
function upsertLocal(row) {
  const i = rows.findIndex((r) => r.id === row.id);
  if (i === -1) rows.push(row);
  else rows[i] = row;
}

start(async () => {
  buildColMenu();
  const { data, error } = await loadClaims();
  if (error) return toast("Could not load claims: " + error.message, true);
  rows = data;
  render();

  subscribeClaims((payload) => {
    if (payload.eventType === "DELETE") {
      rows = rows.filter((r) => r.id !== payload.old.id);
    } else if (isDeleted(payload.new)) {
      // Somebody else deleted it; a soft delete arrives as an UPDATE.
      rows = rows.filter((r) => r.id !== payload.new.id);
    } else {
      // Don't yank a cell out from under someone mid-edit.
      if (editing && editing.id === payload.new.id) {
        const keep = rows.find((r) => r.id === payload.new.id);
        if (keep) {
          upsertLocal({ ...payload.new, [editing.key]: keep[editing.key] });
          return;
        }
      }
      upsertLocal(payload.new);
    }
    render();
  });
});
