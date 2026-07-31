# Claims Tracker

A shared, browser-based tracker for subrogation and collections claims. Two
tabs, every cell editable in place, data in a hosted Postgres database so
everyone sees the same records and each other's edits.

No build step. Three static files (`index.html`, `styles.css`, `app.js`) plus
`config.js`, talking straight to Supabase.

## How it fits together

| Piece | What it does |
|---|---|
| **Supabase** | Hosted Postgres. Stores the rows, handles login, pushes live updates. |
| **GitHub Pages** | Serves the three static files. |
| `supabase-setup.sql` | Creates the table, the security rules, and the starting data. |
| `config.js` | The only file with environment-specific values. |

### One table, two tabs

Everything lives in `public.claims`. A `board` column (`subrogation` or
`collection`) decides which tab a row appears on. Both boards therefore already
have the full column set in the database — Collections just hides most of them
in the UI.

**To show more Collections columns:** click **Columns** in the toolbar and tick
them. The choice is remembered per person, per tab. To change the default for
everyone, edit `BOARDS.collection.defaultCols` in `app.js`.

## Security model

`config.js` holds the Supabase URL and the **anon key**. Both are designed to
be public — the anon key is a publishable identifier, not a secret.

What actually protects the data is Row Level Security: the policy in
`supabase-setup.sql` grants access only to the `authenticated` role. Someone who
reads the anon key out of the page source and points a client at the database
gets nothing back without a valid login.

This is why it is safe for the site's source to be public while the customer
data is not. It also means: **do not** put the `service_role` key in `config.js`
or anywhere else in this repo. That one *is* a secret and it bypasses RLS.

## Managing who can log in

Signups are handled by you, not by a public registration form.

1. Supabase dashboard → **Authentication** → **Users** → **Add user**
2. Enter an email and password, tick **Auto Confirm User**
3. Send those to the colleague

To revoke access, delete the user there. To make everyone share one login,
create a single user and hand the same credentials out — the app does not care
either way.

Turn public signup off under **Authentication → Sign In / Providers → Email →
Allow new users to sign up** so nobody can self-register.

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

Then open `http://localhost:8000`. It talks to the same Supabase project as the
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
