#!/usr/bin/env node
/**
 * Email alert engine for the project board.
 *
 *   node scripts/send-alerts.mjs daily     due today / due soon / overdue
 *   node scripts/send-alerts.mjs weekly    Monday progress summary
 *   node scripts/send-alerts.mjs blocked   newly blocked tasks, once each
 *
 * Runs from GitHub Actions on a schedule. Reads with the Supabase service role
 * key so it can see every user's rows (RLS is bypassed by design here), and
 * mails each user only their own board.
 *
 * Set DRY_RUN=1 to print the emails instead of sending them.
 */

import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'

const MODE = process.argv[2]
const DRY_RUN = process.env.DRY_RUN === '1'

if (!['daily', 'weekly', 'blocked'].includes(MODE)) {
  console.error('Usage: send-alerts.mjs <daily|weekly|blocked>')
  process.exit(1)
}

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  SMTP_HOST = 'smtp.gmail.com',
  SMTP_PORT = '465',
  SMTP_USER,
  SMTP_PASS,
  MAIL_FROM,
  APP_URL = '',
} = process.env

const missing = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SMTP_USER', 'SMTP_PASS']
  .filter(k => !process.env[k])
if (missing.length && !DRY_RUN) {
  console.error(`Missing required secrets: ${missing.join(', ')}`)
  process.exit(1)
}

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

const mailer = DRY_RUN ? null : nodemailer.createTransport({
  host: SMTP_HOST,
  port: Number(SMTP_PORT),
  secure: Number(SMTP_PORT) === 465,
  auth: { user: SMTP_USER, pass: SMTP_PASS },
})

// ---------------------------------------------------------------- helpers --

const PRIORITY_COLOR = { urgent: '#e11d48', high: '#d97706', medium: '#0284c7', low: '#64748b' }
const STATUS_LABEL = {
  backlog: 'Backlog', todo: 'To Do', in_progress: 'In Progress',
  blocked: 'Blocked', done: 'Done',
}

function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return t.toISOString().slice(0, 10)
}

function prettyDate(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
    .toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
}

function daysBetween(a, b) {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000)
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

// ------------------------------------------------------------- templating --

/** Wraps body HTML in a table-based shell that survives Gmail and Outlook. */
function layout({ title, intro, body }) {
  const cta = APP_URL
    ? `<tr><td style="padding:8px 28px 32px">
         <a href="${escapeHtml(APP_URL)}"
            style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;
                   font-size:14px;font-weight:600;padding:11px 20px;border-radius:8px">
           Open the board
         </a>
       </td></tr>`
    : ''

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f1f5f9">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:28px 12px">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
         style="max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;
                font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
                box-shadow:0 1px 3px rgba(15,23,42,.12)">
    <tr><td style="background:#4f46e5;padding:22px 28px">
      <div style="color:#c7d2fe;font-size:11px;letter-spacing:.09em;text-transform:uppercase;font-weight:600">
        Project Board
      </div>
      <div style="color:#ffffff;font-size:21px;font-weight:700;margin-top:4px">${escapeHtml(title)}</div>
    </td></tr>
    <tr><td style="padding:24px 28px 4px;color:#475569;font-size:14px;line-height:1.6">${intro}</td></tr>
    <tr><td style="padding:8px 28px">${body}</td></tr>
    ${cta}
    <tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:16px 28px;
                   color:#94a3b8;font-size:11px;line-height:1.6">
      Sent by your project board's scheduled GitHub Action.
      Turn this off under the mail icon in the board header.
    </td></tr>
  </table>
</td></tr></table>
</body></html>`
}

function section(heading, accent, rows) {
  if (rows.length === 0) return ''
  return `
  <div style="margin:18px 0 6px;font-size:12px;font-weight:700;letter-spacing:.05em;
              text-transform:uppercase;color:${accent}">
    ${escapeHtml(heading)} <span style="color:#cbd5e1">(${rows.length})</span>
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows.join('')}</table>`
}

function taskRow(task, projectName, note) {
  const color = PRIORITY_COLOR[task.priority] ?? '#64748b'
  return `
  <tr><td style="padding:9px 0;border-bottom:1px solid #f1f5f9">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td width="4" style="background:${color};border-radius:2px"></td>
      <td style="padding-left:12px">
        <div style="font-size:14px;font-weight:600;color:#0f172a">${escapeHtml(task.title)}</div>
        <div style="font-size:12px;color:#94a3b8;margin-top:3px">
          ${escapeHtml(projectName)}
          &nbsp;·&nbsp; ${escapeHtml(STATUS_LABEL[task.status] ?? task.status)}
          &nbsp;·&nbsp; <span style="color:${color};font-weight:600">${escapeHtml(task.priority)}</span>
          ${note ? `&nbsp;·&nbsp; ${escapeHtml(note)}` : ''}
        </div>
        ${task.blocked_reason
          ? `<div style="font-size:12px;color:#be123c;margin-top:4px">Blocked: ${escapeHtml(task.blocked_reason)}</div>`
          : ''}
      </td>
    </tr></table>
  </td></tr>`
}

async function send(to, subject, html) {
  if (DRY_RUN) {
    console.log(`\n--- DRY RUN -> ${to}\nSubject: ${subject}\n${html.length} bytes of HTML\n`)
    return
  }
  await mailer.sendMail({ from: MAIL_FROM || SMTP_USER, to, subject, html })
  console.log(`sent "${subject}" -> ${to}`)
}

// ------------------------------------------------------------------ modes --

/** Loads every profile that has this alert switched on, plus their board data. */
async function loadUsers(flag) {
  const { data: profiles, error } = await db.from('profiles').select('*').eq(flag, true)
  if (error) throw error
  if (!profiles?.length) return []

  const ids = profiles.map(p => p.id)
  const [{ data: projects, error: pe }, { data: tasks, error: te }] = await Promise.all([
    db.from('projects').select('*').in('user_id', ids),
    db.from('tasks').select('*').in('user_id', ids),
  ])
  if (pe) throw pe
  if (te) throw te

  const projectName = new Map((projects ?? []).map(p => [p.id, p.name]))
  return profiles.map(profile => ({
    profile,
    projects: (projects ?? []).filter(p => p.user_id === profile.id),
    tasks: (tasks ?? []).filter(t => t.user_id === profile.id),
    projectName,
  }))
}

async function daily() {
  const today = todayISO()
  const horizon = addDays(today, 3)

  for (const { profile, tasks, projectName } of await loadUsers('daily_digest')) {
    const open = tasks.filter(t => t.status !== 'done' && t.due_date)
    const overdue = open.filter(t => t.due_date < today).sort((a, b) => a.due_date.localeCompare(b.due_date))
    const dueToday = open.filter(t => t.due_date === today)
    const soon = open.filter(t => t.due_date > today && t.due_date <= horizon)
      .sort((a, b) => a.due_date.localeCompare(b.due_date))
    const blocked = tasks.filter(t => t.status === 'blocked')

    if (overdue.length + dueToday.length + soon.length + blocked.length === 0) {
      console.log(`nothing due for ${profile.email} — skipped`)
      continue
    }

    const body = [
      section('Overdue', '#e11d48', overdue.map(t =>
        taskRow(t, projectName.get(t.project_id) ?? 'Project',
          `${daysBetween(t.due_date, today)}d late`))),
      section('Due today', '#d97706', dueToday.map(t =>
        taskRow(t, projectName.get(t.project_id) ?? 'Project', 'due today'))),
      section('Due in the next 3 days', '#0284c7', soon.map(t =>
        taskRow(t, projectName.get(t.project_id) ?? 'Project', prettyDate(t.due_date)))),
      section('Still blocked', '#7c3aed', blocked.map(t =>
        taskRow(t, projectName.get(t.project_id) ?? 'Project', null))),
    ].join('')

    const headline = overdue.length
      ? `${overdue.length} overdue`
      : dueToday.length ? `${dueToday.length} due today` : 'Your day ahead'

    await send(
      profile.email,
      `[Board] ${headline} — ${prettyDate(today)}`,
      layout({
        title: 'Daily digest',
        intro: `Here is where your board stands on <strong>${prettyDate(today)}</strong>.`,
        body,
      }),
    )
  }
}

async function weekly() {
  const today = todayISO()
  const weekAgo = addDays(today, -7)
  const weekAhead = addDays(today, 7)

  for (const { profile, projects, tasks, projectName } of await loadUsers('weekly_summary')) {
    const live = projects.filter(p => p.status === 'active' || p.status === 'on_hold')
    if (live.length === 0) {
      console.log(`no active projects for ${profile.email} — skipped`)
      continue
    }

    const rows = live.map(p => {
      const own = tasks.filter(t => t.project_id === p.id)
      const done = own.filter(t => t.status === 'done').length
      const pct = own.length ? Math.round((done / own.length) * 100) : 0
      const blocked = own.filter(t => t.status === 'blocked').length
      return `
      <tr><td style="padding:11px 0;border-bottom:1px solid #f1f5f9">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td width="4" style="background:${escapeHtml(p.color)};border-radius:2px"></td>
          <td style="padding-left:12px">
            <div style="font-size:14px;font-weight:600;color:#0f172a">${escapeHtml(p.name)}</div>
            <div style="font-size:12px;color:#94a3b8;margin-top:3px">
              ${done}/${own.length} done · ${pct}%
              ${blocked ? ` · <span style="color:#e11d48;font-weight:600">${blocked} blocked</span>` : ''}
              ${p.status === 'on_hold' ? ' · on hold' : ''}
            </div>
            <div style="margin-top:7px;background:#e2e8f0;border-radius:4px;height:6px;width:100%">
              <div style="background:${escapeHtml(p.color)};height:6px;border-radius:4px;width:${pct}%"></div>
            </div>
          </td>
        </tr></table>
      </td></tr>`
    })

    const completed = tasks.filter(t =>
      t.status === 'done' && t.completed_at && t.completed_at.slice(0, 10) >= weekAgo)
    const upcoming = tasks.filter(t =>
      t.status !== 'done' && t.due_date && t.due_date >= today && t.due_date <= weekAhead)
      .sort((a, b) => a.due_date.localeCompare(b.due_date))
    const overdue = tasks.filter(t => t.status !== 'done' && t.due_date && t.due_date < today)

    const body = [
      section('Project progress', '#4f46e5', rows),
      section('Closed in the last 7 days', '#059669', completed.map(t =>
        taskRow(t, projectName.get(t.project_id) ?? 'Project', null))),
      section('Due this week', '#0284c7', upcoming.map(t =>
        taskRow(t, projectName.get(t.project_id) ?? 'Project', prettyDate(t.due_date)))),
      section('Carrying over — overdue', '#e11d48', overdue.map(t =>
        taskRow(t, projectName.get(t.project_id) ?? 'Project',
          `${daysBetween(t.due_date, today)}d late`))),
    ].join('')

    await send(
      profile.email,
      `[Board] Week ahead — ${live.length} active project${live.length === 1 ? '' : 's'}`,
      layout({
        title: 'Weekly summary',
        intro: `You closed <strong>${completed.length}</strong> task${completed.length === 1 ? '' : 's'} last week and have <strong>${upcoming.length}</strong> due in the next seven days.`,
        body,
      }),
    )
  }
}

async function blocked() {
  for (const { profile, tasks, projectName } of await loadUsers('blocker_alerts')) {
    const fresh = tasks.filter(t => t.status === 'blocked' && !t.blocked_notified_at)
    if (fresh.length === 0) continue

    const body = section('Newly blocked', '#e11d48', fresh.map(t =>
      taskRow(t, projectName.get(t.project_id) ?? 'Project',
        t.blocked_at ? `blocked ${new Date(t.blocked_at).toUTCString().slice(5, 22)} UTC` : null)))

    await send(
      profile.email,
      `[Board] ${fresh.length} task${fresh.length === 1 ? '' : 's'} blocked`,
      layout({
        title: 'Blocker alert',
        intro: fresh.length === 1
          ? 'A task just moved into the Blocked column.'
          : `${fresh.length} tasks just moved into the Blocked column.`,
        body,
      }),
    )

    // Stamp only after a successful send, so a mail failure retries next run.
    if (!DRY_RUN) {
      const { error } = await db.from('tasks')
        .update({ blocked_notified_at: new Date().toISOString() })
        .in('id', fresh.map(t => t.id))
      if (error) throw error
    }
  }
}

// ------------------------------------------------------------------- main --

try {
  if (MODE === 'daily') await daily()
  else if (MODE === 'weekly') await weekly()
  else await blocked()
  console.log(`${MODE} alerts complete`)
} catch (err) {
  console.error(`${MODE} alerts failed:`, err.message ?? err)
  process.exit(1)
}
