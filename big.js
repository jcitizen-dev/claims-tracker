/* Large-print view: one record at a time, big type, secondary fields behind a
 * "more details" button, oversized Back/Next. Same database and same live
 * updates as the standard view.
 *
 * Read and edit only -- no adding, no deleting. Both of those happen on the
 * standard table view, so there is nothing here that can lose a record. */
import {
  COL, BOARDS,
  configured, $, showSetupError,
  display, editable, parseMoney, fmtMoney, sortRows,
  loadClaims, updateCell, subscribeClaims, isDeleted,
  start, toast,
} from "./shared.js?v=20260731i";

if (!configured) {
  showSetupError();
  throw new Error("Supabase config missing");
}

/* ── State ──────────────────────────────────────────────────────────────── */
let rows = [];
let board = "subrogation";
let index = 0;              // which record on this board we're looking at
let showDetails = false;
let editingKey = null;      // key of the focused input, or null

const boardRows = () =>
  sortRows(rows.filter((r) => r.board === board), BOARDS[board].defaultSort);

const currentRow = () => boardRows()[index] ?? null;

/* ── Rendering ──────────────────────────────────────────────────────────── */
// Re-rendering replaces the inputs, which would interrupt typing. Defer while
// a field has focus and catch up on blur, exactly as the table view does.
let pendingRender = false;

function render() {
  if (editingKey) {
    pendingRender = true;
    return;
  }

  const list = boardRows();
  if (index > list.length - 1) index = Math.max(0, list.length - 1);
  const row = list[index];

  $("empty").hidden = list.length > 0;
  $("card").hidden = list.length === 0;
  $("position").textContent = list.length
    ? `Record ${index + 1} of ${list.length}`
    : "";

  $("prevBtn").disabled = index <= 0;
  $("nextBtn").disabled = index >= list.length - 1;

  // The goal: every amount on this tab, added up. Hidden when the tab has no
  // amounts at all -- Collections currently has none, and a $0.00 "goal" is
  // the opposite of motivating.
  const priced = list.filter((r) => r.amount !== null && r.amount !== undefined);
  $("total").hidden = priced.length === 0;
  if (priced.length) {
    $("totalAmount").textContent =
      fmtMoney(priced.reduce((sum, r) => sum + Number(r.amount), 0));
  }

  const card = $("card");
  card.innerHTML = "";
  if (!row) return;

  const primary = BOARDS[board].primary;
  const secondary = BOARDS[board].defaultCols
    .concat(Object.keys(COL))
    .filter((k, i, a) => a.indexOf(k) === i && !primary.includes(k));

  for (const key of primary) card.append(field(row, key));

  // Don't offer "the other details" on a record that hasn't any -- most of the
  // Collections rows and the unworked Subrogations ones are name-and-car only.
  // The `|| showDetails` keeps the section from vanishing under someone who
  // just blanked the last filled field while it was open; once they close it,
  // the button goes away on the next render.
  const hasDetails = secondary.some((k) => String(row[k] ?? "").trim() !== "");

  if (hasDetails || showDetails) {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "btn disclose";
    toggle.id = "disclose";
    toggle.setAttribute("aria-expanded", String(showDetails));
    toggle.textContent = showDetails
      ? "Hide the other details  ▲"
      : "Show the other details  ▼";
    toggle.addEventListener("click", () => {
      showDetails = !showDetails;
      render();
      $("disclose")?.focus();
    });
    card.append(toggle);

    const details = document.createElement("div");
    details.className = "details";
    details.hidden = !showDetails;
    for (const key of secondary) details.append(field(row, key));
    card.append(details);
  }

  // This view deliberately has no delete, and no add. Reading and editing only
  // -- both of those happen on the standard table view (index.html).

  paintSaved();
}

function field(row, key) {
  const c = COL[key];
  const wrap = document.createElement("div");
  wrap.className =
    "field" + (c.type === "money" ? " money" : "") + (c.mono ? " mono" : "");

  const id = "f-" + key;
  const label = document.createElement("label");
  label.setAttribute("for", id);
  label.textContent = c.label;

  const input = document.createElement("input");
  input.id = id;
  input.type = "text";
  input.value = display(row, key);
  input.dataset.key = key;
  input.dataset.id = row.id;
  // Long numbers are read digit by digit more easily with a text keyboard.
  input.autocomplete = "off";
  input.spellcheck = false;

  input.addEventListener("focus", () => {
    editingKey = key;
    input.dataset.before = editable(row, key);
    input.value = input.dataset.before;
    input.select();
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); input.blur(); }
    else if (e.key === "Escape") {
      e.preventDefault();
      input.value = input.dataset.before ?? "";
      input.dataset.cancel = "1";
      input.blur();
    }
  });

  input.addEventListener("blur", async () => {
    editingKey = null;
    const res = await commit(input);
    if (pendingRender || res.resort) { pendingRender = false; render(); }
    if (res.saved) flashSaved(res.key);
  });

  wrap.append(label, input);
  return wrap;
}

// Returns { saved, key, resort } so the caller can re-render and then put the
// "Saved" note back on the field, which a re-render would otherwise wipe out.
async function commit(input) {
  const { id, key } = input.dataset;
  const nothing = { saved: false, key, resort: false };
  const row = rows.find((r) => r.id === id);
  if (!row) return nothing;

  if (input.dataset.cancel) {
    delete input.dataset.cancel;
    input.value = display(row, key);
    return nothing;
  }

  const raw = input.value.replace(/\s+/g, " ").trim();
  if (raw === (input.dataset.before ?? "")) {
    input.value = display(row, key);
    return nothing;
  }

  let value;
  if (COL[key].type === "money") {
    value = parseMoney(raw);
    if (value === undefined) {
      toast(`“${raw}” is not an amount.`, true);
      input.value = display(row, key);
      return nothing;
    }
  } else {
    value = raw === "" ? null : raw;
  }

  const previous = row[key];
  row[key] = value;
  input.value = display(row, key);

  const { error } = await updateCell(id, key, value);
  if (error) {
    row[key] = previous;
    input.value = display(row, key);
    toast("Could not save: " + error.message, true);
    return nothing;
  }

  // Editing the sorted column moves the record; follow it so the reader stays
  // on the same claim instead of being dropped somewhere else in the list.
  const resort = key === BOARDS[board].defaultSort.key;
  if (resort) {
    const at = boardRows().findIndex((r) => r.id === id);
    if (at !== -1) index = at;
  }
  return { saved: true, key, resort };
}

/* A visible, unhurried confirmation next to the field just edited.
 * Held in state rather than poked straight into the DOM: the database echoes
 * our own write back over the realtime channel, which re-renders the card and
 * would otherwise erase the note before it had been read. */
const SAVED_MS = 2500;
let savedNote = null;                 // { key, at }

function flashSaved(key) {
  savedNote = { key, at: Date.now() };
  paintSaved();
  setTimeout(() => {
    if (savedNote && Date.now() - savedNote.at >= SAVED_MS) {
      savedNote = null;
      paintSaved();
    }
  }, SAVED_MS + 50);
}

function paintSaved() {
  const card = $("card");
  if (!card) return;
  card.querySelectorAll(".saved").forEach((e) => e.remove());
  if (!savedNote || Date.now() - savedNote.at >= SAVED_MS) return;

  const input = card.querySelector(`input[data-key="${CSS.escape(savedNote.key)}"]`);
  const label = input?.closest(".field")?.querySelector("label");
  if (!label) return;
  const tag = document.createElement("span");
  tag.className = "saved";
  tag.textContent = "✓ Saved";
  label.append(tag);
}

/* ── Navigation ─────────────────────────────────────────────────────────── */
function go(delta) {
  const list = boardRows();
  const next = index + delta;
  if (next < 0 || next > list.length - 1) return;
  index = next;
  showDetails = false;      // each record starts with the summary only
  render();
  window.scrollTo({ top: 0 });
}

$("prevBtn").addEventListener("click", () => go(-1));
$("nextBtn").addEventListener("click", () => go(1));

document.addEventListener("keydown", (e) => {
  // Don't hijack the arrow keys while someone is typing in a field.
  if (e.target.tagName === "INPUT") return;
  if (e.key === "ArrowLeft") go(-1);
  if (e.key === "ArrowRight") go(1);
});

$("tabs").addEventListener("click", (e) => {
  const tab = e.target.closest(".tab");
  if (!tab) return;
  board = tab.dataset.board;
  index = 0;
  showDetails = false;
  for (const t of $("tabs").children) t.classList.toggle("is-active", t === tab);
  render();
});

/* ── Data + realtime ────────────────────────────────────────────────────── */
function upsertLocal(row) {
  const i = rows.findIndex((r) => r.id === row.id);
  if (i === -1) rows.push(row);
  else rows[i] = row;
}

start(async () => {
  const { data, error } = await loadClaims();
  if (error) return toast("Could not load claims: " + error.message, true);
  rows = data;
  render();

  subscribeClaims((payload) => {
    const showing = currentRow()?.id;
    if (payload.eventType === "DELETE") {
      rows = rows.filter((r) => r.id !== payload.old.id);
    } else if (isDeleted(payload.new)) {
      // Somebody else deleted it; a soft delete arrives as an UPDATE.
      rows = rows.filter((r) => r.id !== payload.new.id);
    } else {
      if (editingKey && payload.new.id === showing) {
        const keep = rows.find((r) => r.id === payload.new.id);
        if (keep) {
          upsertLocal({ ...payload.new, [editingKey]: keep[editingKey] });
          return;
        }
      }
      upsertLocal(payload.new);
    }
    // Keep the reader on the record they were looking at.
    const at = boardRows().findIndex((r) => r.id === showing);
    if (at !== -1) index = at;
    render();
  });
});
