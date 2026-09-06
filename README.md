# 🗂️ Project Board

A personal Kanban board for tracking all your projects, hosted free on GitHub Pages,
with real email/password sign-in and automatic email alerts.

- **Board** — drag-and-drop columns (Backlog → To Do → In Progress → Blocked → Done), one board per project
- **Auth** — email + password and Google sign-in, with password reset
- **Private** — Postgres row level security means only you can read your rows, enforced by the database, not the UI
- **Email alerts** — weekday digest, Monday summary, and blocker alerts, each individually switchable
- **Dark mode**, keyboard accessible, works on phones

---

## What runs where

| Piece | Where it lives | Cost |
| --- | --- | --- |
| The board UI | GitHub Pages, built by GitHub Actions | Free |
| Login + database | Supabase (Postgres + Auth) | Free tier |
| Alert emails | GitHub Actions cron + Gmail SMTP | Free |

Nothing needs a server you have to keep alive.

---

## Setup

Roughly 15 minutes, once.

### 1. Create the Supabase project

1. Sign up at [supabase.com](https://supabase.com) and create a new project. Any region; pick the closest one.
2. Once it finishes provisioning, open **SQL Editor → New query**, paste the whole of
   [`db/schema.sql`](db/schema.sql), and click **Run**.
   This creates the `profiles`, `projects` and `tasks` tables, the lifecycle triggers, and
   the row level security policies. It is safe to run again later.
3. Open **Project Settings → API** and copy three values — you will need all of them:
   - **Project URL** (`https://xxxx.supabase.co`)
   - **anon / public key** — safe to publish; it only ever grants what RLS allows
   - **service_role key** — **secret**. Only ever goes into a GitHub secret, never the browser bundle.

### 2. Turn on Google sign-in (optional)

Supabase → **Authentication → Providers → Google**. Follow their instructions to get a
Google OAuth client ID and secret. Skip this and email/password still works fine.

While you are in **Authentication → URL Configuration**, add your Pages URL
(`https://<your-username>.github.io/<repo>/`) to **Redirect URLs**, so confirmation and
password-reset links come back to the right place.

> If you would rather not confirm your email address on first signup, turn off
> **Authentication → Sign In / Providers → Confirm email**.

### 3. Create a Gmail app password

Alerts are sent through Gmail's SMTP server using an app password — not your real password.

1. Your Google account needs 2-Step Verification enabled.
2. Go to [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords),
   create one named `project-board`, and copy the 16-character code.

### 4. Add the repository secrets

In your GitHub repo: **Settings → Secrets and variables → Actions**.

Under **Secrets**, add:

| Secret | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key |
| `SUPABASE_URL` | Same project URL again (used by the alert job) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase **service_role** key |
| `SMTP_HOST` | `smtp.gmail.com` |
| `SMTP_PORT` | `465` |
| `SMTP_USER` | Your Gmail address |
| `SMTP_PASS` | The 16-character app password |
| `MAIL_FROM` | e.g. `Project Board <you@gmail.com>` |

Under **Variables**, add:

| Variable | Value |
| --- | --- |
| `APP_URL` | `https://<your-username>.github.io/<repo>/` — turns the "Open the board" button in emails into a working link |

### 5. Turn on Pages

**Settings → Pages → Build and deployment → Source: GitHub Actions.**

Then push to `main` (or run the **Deploy to GitHub Pages** workflow manually). Your board
goes live at `https://<your-username>.github.io/<repo>/`.

---

## The alerts

| Alert | When | What it says |
| --- | --- | --- |
| **Daily digest** | Weekdays 06:00 UTC | Overdue, due today, due within 3 days, and anything still blocked |
| **Weekly summary** | Mondays 07:00 UTC | Per-project progress bars, what closed last week, what is due this week |
| **Blocker alert** | Checked every 15 minutes | Tasks that just landed in the Blocked column, with the reason you typed |

Ghana is UTC+0 year-round, so those are local times. To shift them, edit the `cron`
lines in [`.github/workflows/alerts.yml`](.github/workflows/alerts.yml).

Each user toggles their own three alerts from the **mail icon** in the board header.
A blocker is only ever mailed once — the send stamps `blocked_notified_at` on the task —
and moving the task out of Blocked and back in re-arms it.

Digests that would be empty are skipped, so a quiet week does not fill your inbox.

**To test without waiting:** Actions → **Email alerts** → **Run workflow**, pick a mode,
and tick **dry run** to print the emails to the job log instead of sending them.

> ⚠️ GitHub pauses scheduled workflows in repos with no commits for 60 days. It emails
> you first; a single commit re-enables them.

---

## Running it locally

```bash
npm install
cp .env.example .env.local     # then fill in your Supabase URL + anon key
npm run dev
```

To try the alert emails from your machine:

```bash
# PowerShell
$env:SUPABASE_URL="https://xxxx.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="..."
$env:DRY_RUN="1"
npm run alerts:daily
```

Drop `DRY_RUN` and add `SMTP_USER` / `SMTP_PASS` to actually send.

---

## How it is put together

```
src/
  lib/
    supabase.ts        Supabase client; detects a build with no credentials
    auth.tsx           Session context — restores your session before first paint
    types.ts           Task/Project shapes, column and priority definitions
    dates.ts           Timezone-safe due-date maths on 'YYYY-MM-DD' strings
  hooks/useBoard.ts    All reads and writes; optimistic updates + realtime sync
  components/          Board, Column, TaskCard, dialogs, sidebar, login
db/schema.sql          Tables, triggers, RLS policies — run once in Supabase
scripts/send-alerts.mjs  The three alert emails, run by Actions
.github/workflows/     Pages deploy + the alert schedules
```

A few decisions worth knowing:

- **Card order** is a `double precision` `sort_order`. Dropping a card writes the midpoint
  between its two new neighbours, so a reorder updates exactly one row.
- **`blocked_at` and `completed_at` are set by database triggers**, not the UI, so they stay
  right no matter what changed the row.
- **The anon key is public on purpose.** Every table has an `auth.uid() = user_id` policy;
  the database refuses to return anyone else's rows even with a valid key.
- **The service_role key bypasses RLS** — that is why it lives only in Actions secrets and
  never in the frontend build.

---

## Licence

MIT — it is your board, do what you like with it.
