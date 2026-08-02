# Claims Tracker

A shared, browser-based tracker for subrogation and collections claims. Two
tabs, everything editable in place, data in a hosted Postgres database so
everyone sees the same records and each other's edits.

No build step — plain static files talking straight to Supabase.

## Two views of the same data

| | Standard | Large print |
|---|---|---|
| Page | `index.html` | `big.html` |
| Layout | Dense table, all rows at once | One record per screen |
| Add / delete | Yes | No — read and edit only |
| Built for | Everyday work | Low vision |

They share one database and one set of live updates. An edit in either shows
up in the other within a second or two. The standard view links to the large
print one; the link does not go back the other way, so Dave's page has no way
out of itself — bookmark `big.html` directly on his phone.

**Large print** shows the few fields that matter — Customer Name, Amount,
Car # — in very large type, and keeps the rest behind a **Show the other
details** button. That button only appears on records that actually have other
details; a name-and-car-only record shows no dropdown at all. Oversized
**Back** / **Next** buttons (and the left/right arrow keys) move between
records one at a time, and the two tabs are full-width buttons. There is no
page heading, so the record gets the vertical space. Nothing is under 18px.

### The running total

A **Total to Collect** bar sits under Back/Next on the large-print view: every
amount on the current tab, added up. It is a motivator, so it is styled like
the goal it is — brand red, 34px — and it updates the moment any amount
changes, including an amount changed by someone else on the standard view.

### How the large-print layout holds together

`big.html` is a **fixed-height flex column**: `.app` is exactly `100dvh`, the
tabs are pinned at the top, the pager and the total are pinned at the bottom,
and `.card` takes the slack. The card is the *only* thing that scrolls — when a
record is long, or the window is short, the card shrinks and scrolls inside
itself while the nav and the total stay exactly where they are.

This replaced a `position: sticky` total, which pinned itself to the viewport
bottom whenever the page scrolled and rode up over the record counter and the
Back/Next buttons. Sticky always overlaps once content exceeds the viewport;
the flex column cannot, at any height. Verified clean from 620px to 800px tall.

**If you change this file, keep `height: 100dvh` (not `min-height`) on `.app`
and `flex: 1 1 auto; min-height: 0; overflow-y: auto` on `.card`.** Those four
declarations are what make it work; `min-height` only sets a floor and lets the
page grow again.

It shows on both tabs, always. Collections has no amounts yet and so reads
$0.00 — the honest number, and it keeps the bar in the same place whichever tab
is open.

To rename it, edit the `.total-label` text in `big.html`.

### Fitting on a phone

It is laid out so **Back / Next are reachable without scrolling on an iPhone
Pro Max** (~440pt wide) with a worked record on screen — the nav's bottom edge
lands around 712px, inside Safari's visible area.

That budget is tight, so if you add anything to this view, re-measure. The
rules that buy the space:

- The record counter sits *between* Back and Next rather than on its own line.
- Both tabs and both nav buttons stay side by side at phone width. Stacking
  either costs 70–100px and pushes the nav off screen — that is why the
  `max-width: 520px` block places them explicitly instead of falling back to
  one column.
- Padding, not type, was reduced. **Every font size is identical at every
  width** (34px fields, 42px amount, 26px tabs, 28px nav, 19px labels). Do not
  shrink type here to make something fit; take it out of the padding, or leave
  it out.

**The large-print view cannot add or delete records**, on purpose — it reads
and edits existing claims only. Both of those happen on the standard table
view, so there is nothing on Dave's page that can lose or create a record, and
nothing below the pager at all.

One consequence: a record with no other details has no way to gain them from
this view, since the fields are only reachable through that button. Fill those
in from the standard view.

## How it fits together

| Piece | What it does |
|---|---|
| **Supabase** | Hosted Postgres. Stores the rows and pushes live updates. |
| **GitHub Pages** | Serves the static files. |
| `shared.js` | Columns, currency handling, sorting and data access — shared by both views so they cannot drift apart. |
| `supabase-setup.sql` | Creates the table and the security rules. |
| `seed-data.sql` | The starting rows. **Not in this repo** — see below. |
| `config.js` | The only file with environment-specific values. |

### Customer data is not in this repository

This repo is public, so it contains no customer names, VINs or claim numbers.
`supabase-setup.sql` creates an empty table; the actual rows live in
`seed-data.sql`, which is gitignored and kept locally. Run it once in the SQL
Editor after the schema.

### One table, two tabs

Everything lives in `public.claims`. A `board` column (`subrogation` or
`collection`) decides which tab a row appears on. Both boards therefore already
have the full column set in the database — Collections just hides most of them
in the UI.

**To show more Collections columns:** click **Columns** in the toolbar and tick
them. The choice is remembered per person, per tab. To change the default for
everyone, edit `BOARDS.collection.defaultCols` in `app.js`.

## Access model — read this

**There is no sign-in.** Anyone who opens the URL sees the data and can edit or
delete it. This was a deliberate choice; the trade-off is worth stating plainly:

- The site is on a public URL and this repo is public, so the Supabase anon key
  is visible in the page source.
- The RLS policy grants the anonymous role full read **and write**. Someone with
  the URL — or with the key from this repo — can change or delete every record.
- The data is customer PII: names, VINs, claim numbers.
- The pages send `noindex`, which discourages search engines but is not
  protection.

Do not put the `service_role` key in `config.js`. That one is a real secret and
bypasses RLS entirely.

### Turning a login back on later

The plumbing is still here, so this is a small job:

1. In `supabase-setup.sql`, change the policy from `to anon, authenticated` to
   `to authenticated`, and re-run it.
2. Restore the sign-in card markup in `index.html` / `big.html` and swap
   `start()` back for an auth wrapper in `shared.js` (see git history — commit
   `d6d744a` has the working version).
3. Create users under **Authentication → Users → Add user**, ticking
   **Auto Confirm User**, and turn off public signup under
   **Authentication → Sign In / Providers → Email**.

The login styles are still in `styles.css` and `big.css` for this reason.

## Deleting is reversible

Delete does not actually remove anything. It sets `deleted_at` on the row; both
views load only rows where `deleted_at is null`, so it vanishes from the app
while staying in the database.

**To see what has been deleted**, in the SQL Editor:

```sql
select car_num, customer_name, amount, board, deleted_at
from claims
where deleted_at is not null
order by deleted_at desc;
```

**To bring one back**, clear the flag — it reappears in the app immediately, in
every open browser:

```sql
update claims set deleted_at = null where car_num = '471';
```

**To really destroy something** (there is no undo for this):

```sql
delete from claims where deleted_at is not null;
```

This matters because the app has no login and the free Supabase tier keeps no
automatic backups — a soft delete is the only safety net under a mis-click.

## Data notes

- **Amount** is a real `numeric` column. Type `1234.56`, `$1,234.56`, or
  `1,234.56` — all work. It displays as `$1,234.56`. Anything that isn't a
  number is rejected and the cell reverts.
- **Car #** is free text, so `SMALL CLAIMS` is fine alongside `471`.
- **VIN** is free text and is never validated or auto-corrected — the source
  VINs were transcribed from photographs and some characters may be wrong.
- **Dates** are stored as text so partial or unusual entries are never rejected.
  Sorting still understands `M/D/YYYY` and orders them chronologically.
- **Blank values always sort to the bottom**, whichever column you sort by.

## Behavior

- Subrogations opens sorted by Amount, highest first, and re-sorts the moment
  an amount changes.
- Click any column header to sort by it; click again to reverse.
- The search box filters the visible tab across its visible columns.
- **Enter** saves, **Esc** cancels, **Tab** moves to the next cell.
- Edits save on their own — there is no save button. A row flashes green when
  it saves; a red message appears if it didn't.
- **Print** hides the toolbar, tabs, and delete column, and lays the table out
  landscape.

## Running it locally

Any static server works:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000` (or `/big.html` for the large-print view). It talks to the same Supabase project as the
live site, so local edits are real edits.

## Getting at the database directly

Supabase dashboard → **Table Editor** → `claims` for a spreadsheet-style view,
or **SQL Editor** to query it:

```sql
select car_num, amount, customer_name, status
from claims
where board = 'subrogation'
order by amount desc nulls last;
```

## Deploying a change

GitHub Pages serves files with `Cache-Control: max-age=600`, so browsers will
happily run ten-minute-old JavaScript against a freshly-changed database. That
is a real hazard — old code plus a new schema is how a "soft" delete can turn
out to be a hard one.

So **every time you change a `.js` or `.css` file, bump the version stamp** and
push both together:

```bash
./bump-version.sh   # rewrites the ?v= stamps everywhere
git commit -am "..." && git push
```

The stamp appears in `index.html`, `big.html` (on the `config.js`, `app.js`,
`big.js` and stylesheet tags) and in the `./shared.js?v=` import inside `app.js`
and `big.js`. All of them have to match.
