# 🗂️ Project Board

A project management platform for running your own work **and** multi-team programmes
like hackathons, hosted free on GitHub Pages.

- **Workspaces** — `Personal` for your private work, plus programme workspaces like a
  hackathon or `Orion EdX`. You only ever see workspaces you belong to.
- **Teams** — teams inside a workspace own their own projects and boards
- **Board** — drag-and-drop columns (Backlog → To Do → In Progress → Blocked → Done)
- **Access gate** — people request access with a full profile; nobody gets in until you
  approve them, or they redeem a workspace join code
- **Admin dashboard** — approval queue, member and role management, and a cross-project
  progress table that flags at-risk work
- **Programme tools** — milestones with a live countdown, submission links, a demo-day
  showcase page, and weighted judging with a leaderboard
- **Collaboration** — comments with @mentions, link attachments, and meetings that email
  attendees a real calendar invite
- **Email alerts** — seven kinds, each individually switchable
- **Private by construction** — Postgres row level security decides every read and write,
  so the database enforces access, not the UI
- **Dark mode**, keyboard accessible, works on phones

---

## How access works

```
Someone signs up  ──►  profile status = 'pending'  ──►  they can read NOTHING
                            │
                            ├──► instant email to you (Edge Function)
                            │    + a 15-min sweep as the safety net
                            │
                            └──►  you approve in the admin dashboard
                                  choosing workspace + role (+ team)
                                        │
                                        └──►  status = 'active', they see only
                                              what their membership allows

Shortcut: anyone entering a workspace join code is admitted to that
workspace automatically, without joining the approval queue.
```

The gate is a database policy, not a screen. A pending account that reached the app
anyway would still read an empty database — verified by the test suite.

### Roles

| Role | Sees | Can |
| --- | --- | --- |
| **Super admin** (you) | Everything | Approve signups, create workspaces |
| **Owner / Admin** | One whole workspace | Manage teams, members, every project |
| **Manager** | Their teams | Run projects |
| **Judge** | Every project in the workspace | Score, but not edit |
| **Member** | Their teams' projects | Work on their boards |

Scores are visible to the judge who wrote them and to workspace admins — never to the
teams being judged. Publishing results stays a deliberate act on your side.

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

The Supabase project, database schema, auth URLs, GitHub Pages and most repository
secrets are **already provisioned** (see [Provisioned setup](#provisioned-setup) below).
Only the Gmail credentials are left — everything in this section is the record of how it
was done, and what to repeat if you ever rebuild it from scratch.

### Provisioned setup

| Thing | Value |
| --- | --- |
| Supabase project | `project-board` — ref `fvgvvkrsncynsfphhvfx`, West EU (Ireland) |
| API URL | `https://fvgvvkrsncynsfphhvfx.supabase.co` |
| Site URL / redirects | `https://bryanspirit.github.io/project-board/**` and `http://localhost:5173/**` |
| Email confirmation | Off — signup is immediate |
| Live site | https://bryanspirit.github.io/project-board/ |

### Still to do: Gmail credentials

Alerts go out through Gmail SMTP using an app password, never your real password.
This is the one step no CLI can perform for you.

1. Enable 2-Step Verification on your Google account.
2. Create an app password at [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords),
   named e.g. `project-board`, and copy the 16-character code.
3. Set the three remaining secrets:

   ```bash
   gh secret set SMTP_USER -R Bryanspirit/project-board -b "you@gmail.com"
   gh secret set SMTP_PASS -R Bryanspirit/project-board -b "abcdefghijklmnop"
   gh secret set MAIL_FROM -R Bryanspirit/project-board -b "Project Board <you@gmail.com>"
   ```

Until those exist the alert job logs what is missing and exits successfully, so the
15-minute blocker sweep does not fill your inbox with workflow failures.

### Rebuilding from scratch

```bash
supabase login
supabase projects create project-board --org-id <org> --db-password <pw> --region eu-west-1
supabase link --project-ref <new-ref>
supabase db push       # applies supabase/migrations/
supabase config push   # applies the [auth] site_url and redirect allow-list
```

Then point the repository secrets at the new project:

| Secret | Value |
| --- | --- |
| `VITE_SUPABASE_URL` / `SUPABASE_URL` | Project URL |
| `VITE_SUPABASE_ANON_KEY` | anon key — safe to publish; RLS is what protects the data |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key — **secret**, bypasses RLS, Actions only |
| `SMTP_HOST` / `SMTP_PORT` | `smtp.gmail.com` / `465` |
| `SMTP_USER` / `SMTP_PASS` / `MAIL_FROM` | Gmail address, app password, From header |

and the `APP_URL` *variable* to the Pages URL, which turns the "Open the board" button
in each email into a working link.

Pages itself is served from GitHub Actions (**Settings → Pages → Source: GitHub Actions**).

### Google sign-in (optional)

Supabase → **Authentication → Providers → Google**, then supply a Google OAuth client ID
and secret. Email/password works without it; the button is already in the UI.

---

## The alerts

| Alert | When | What it says |
| --- | --- | --- |
| **Daily digest** | Weekdays 06:00 UTC | Overdue, due today, due within 3 days, and anything still blocked |
| **Weekly summary** | Mondays 07:00 UTC | Per-project progress bars, what closed last week, what is due this week |
| **Blocker alert** | Every 15 minutes | Tasks that just landed in the Blocked column, with the reason you typed |
| **Access request** | Instantly, + swept every 15 min | Someone asked to join — every field they submitted |
| **Approval / decline** | Every 15 minutes | Tells the applicant the outcome |
| **@mentions** | Every 15 minutes | Who mentioned you, on which task, with the comment |
| **Meeting reminder** | Hourly | Meetings inside 24h, in each attendee's own timezone, with an `.ics` invite |
| **Admin roll-up** | Mondays 07:30 UTC | Every team's progress, at-risk projects, pending requests |

A task lands in the digest of its **assignee** when it has one, otherwise its creator —
so it reaches exactly one inbox rather than two.

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
supabase/
  config.toml          Auth URLs and project config, pushed with `supabase config push`
  migrations/          Tables, triggers, RLS policies, applied with `supabase db push`
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
