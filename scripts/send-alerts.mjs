#!/usr/bin/env node
/**
 * Email alert engine for the project board.
 *
 *   node scripts/send-alerts.mjs daily         due today / due soon / overdue
 *   node scripts/send-alerts.mjs weekly        Monday progress summary
 *   node scripts/send-alerts.mjs blocked       newly blocked tasks, once each
 *   node scripts/send-alerts.mjs access        approval queue: tell the admin, tell the applicant
 *   node scripts/send-alerts.mjs mentions      @mention digests
 *   node scripts/send-alerts.mjs meetings      meetings inside 24h, with an .ics invite
 *   node scripts/send-alerts.mjs admin-digest  weekly roll-up for workspace owners and admins
 *
 * Runs from GitHub Actions on a schedule. Reads with the Supabase service role
 * key so it can see every user's rows (RLS is bypassed by design here), and
 * mails each user only the board they are allowed to see — which since v2 means
 * the projects they reach through workspace and team membership, not the rows
 * that happen to carry their user_id.
 *
 * Every "notified" column is stamped only after the send returns, so a mail
 * failure retries on the next run instead of silently swallowing a notice.
 *
 * Set DRY_RUN=1 to print the emails instead of sending them.
 */

import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'
import { buildIcs } from './lib/ics.mjs'

const MODES = ['daily', 'weekly', 'blocked', 'access', 'mentions', 'meetings', 'admin-digest']

const MODE = process.argv[2]
const DRY_RUN = process.env.DRY_RUN === '1'

if (!MODES.includes(MODE)) {
  console.error(`Usage: send-alerts.mjs <${MODES.join('|')}>`)
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
  ADMIN_EMAIL = '',
} = process.env

const REQUIRED = DRY_RUN
  ? ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']
  : ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SMTP_USER', 'SMTP_PASS']

const missing = REQUIRED.filter(k => !process.env[k])
if (missing.length) {
  // Exit clean rather than failing. The blocker sweep runs every 15 minutes, and
  // a repo whose secrets are not filled in yet should not mail a failure each
  // time. Once the secrets exist, real errors below still fail the job loudly.
  console.log(`Alerts not configured yet — missing: ${missing.join(', ')}`)
  console.log('Add them under Settings -> Secrets and variables -> Actions. See README.md.')
  process.exit(0)
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

/** Workspace roles that can see every project in the workspace (mirrors is_ws_judge). */
const WS_SEE_ALL = new Set(['owner', 'admin', 'judge'])
const WS_ADMIN_ROLES = new Set(['owner', 'admin'])

const STALE_DAYS = 5

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

function plural(n, word, suffix = 's') {
  return `${n} ${word}${n === 1 ? '' : suffix}`
}

function unique(values) {
  return [...new Set(values.filter(v => v !== null && v !== undefined))]
}

function chunk(values, size = 200) {
  const out = []
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size))
  return out
}

/** `.in()` in batches, so a big instance does not blow the URL length limit. */
async function selectIn(table, columns, column, values) {
  const keys = unique(values)
  if (keys.length === 0) return []
  const rows = []
  for (const batch of chunk(keys)) {
    const { data, error } = await db.from(table).select(columns).in(column, batch)
    if (error) throw error
    rows.push(...(data ?? []))
  }
  return rows
}

function byId(rows) {
  return new Map((rows ?? []).map(r => [r.id, r]))
}

/** A timestamp rendered in somebody's own timezone, falling back to UTC. */
function fmtDateTime(value, timeZone = 'UTC') {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value ?? '')
  const opts = {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit', hour12: false, timeZoneName: 'short',
  }
  try {
    return new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: timeZone || 'UTC' }).format(d)
  } catch {
    return new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: 'UTC' }).format(d)
  }
}

function excerpt(text, max = 220) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

function displayName(profile) {
  return profile?.full_name?.trim() || profile?.email || 'A teammate'
}

/** Only ever put a scheme we recognise into an href. */
function safeUrl(value) {
  const raw = String(value ?? '').trim()
  return /^https?:\/\//i.test(raw) ? raw : null
}

function appLink(hash = '') {
  if (!APP_URL) return ''
  return `${APP_URL.replace(/\/+$/, '')}${hash}`
}

function nowISO() {
  return new Date().toISOString()
}

// ------------------------------------------------------------- templating --

/** Wraps body HTML in a table-based shell that survives Gmail and Outlook. */
function layout({ title, intro, body, ctaUrl = APP_URL, ctaLabel = 'Open the board' }) {
  const cta = ctaUrl
    ? `<tr><td style="padding:8px 28px 32px">
         <a href="${escapeHtml(ctaUrl)}"
            style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;
                   font-size:14px;font-weight:600;padding:11px 20px;border-radius:8px">
           ${escapeHtml(ctaLabel)}
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

/** Same heading as section(), without the count — for prose blocks. */
function heading(text, accent) {
  return `
  <div style="margin:18px 0 6px;font-size:12px;font-weight:700;letter-spacing:.05em;
              text-transform:uppercase;color:${accent}">${escapeHtml(text)}</div>`
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

/** A label / value list. Values that look like links become links. */
function detailTable(pairs) {
  const rows = pairs
    .filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== '')
    .map(([label, value]) => {
      const text = String(value)
      const link = safeUrl(text)
      const cell = link
        ? `<a href="${escapeHtml(link)}" style="color:#4f46e5;word-break:break-all">${escapeHtml(text)}</a>`
        : escapeHtml(text).replace(/\n/g, '<br>')
      return `
      <tr>
        <td style="padding:8px 12px 8px 0;vertical-align:top;width:150px;
                   font-size:12px;color:#94a3b8;white-space:nowrap">${escapeHtml(label)}</td>
        <td style="padding:8px 0;vertical-align:top;font-size:14px;color:#0f172a;
                   border-bottom:1px solid #f1f5f9">${cell}</td>
      </tr>`
    })
  if (rows.length === 0) return ''
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows.join('')}</table>`
}

/** A quoted block — comment excerpts, decision notes, agendas. */
function quote(text, accent = '#cbd5e1') {
  return `
  <div style="margin:8px 0 4px;padding:10px 14px;background:#f8fafc;border-left:3px solid ${accent};
              border-radius:0 8px 8px 0;font-size:13px;color:#334155;line-height:1.6">
    ${escapeHtml(text).replace(/\n/g, '<br>')}
  </div>`
}

async function send(to, subject, html, attachments) {
  if (DRY_RUN) {
    const extra = attachments?.length ? ` + ${plural(attachments.length, 'attachment')}` : ''
    console.log(`\n--- DRY RUN -> ${to}\nSubject: ${subject}\n${html.length} bytes of HTML${extra}\n`)
    return
  }
  const message = { from: MAIL_FROM || SMTP_USER, to, subject, html }
  if (attachments?.length) message.attachments = attachments
  await mailer.sendMail(message)
  console.log(`sent "${subject}" -> ${to}`)
}

// ------------------------------------------------------------- membership --

/**
 * Everything the digest modes need to answer "which projects can this person
 * see?" — mirroring can_view_project() in the migration:
 *
 *   · workspace owners, admins and judges see every project in the workspace
 *   · a project with a team is visible to that team
 *   · a project with no team is visible to the whole workspace
 *   · pre-v2 rows that never got a workspace stay visible to their owner
 */
async function loadBoards(flag) {
  const { data: profiles, error } = await db.from('profiles')
    .select('*').eq(flag, true).eq('status', 'active')
  if (error) throw error
  if (!profiles?.length) return []

  const ids = profiles.map(p => p.id)

  const [wsMembers, teamMembers] = await Promise.all([
    selectIn('workspace_members', 'workspace_id,user_id,role', 'user_id', ids),
    selectIn('team_members', 'team_id,user_id,role', 'user_id', ids),
  ])

  const wsIds = unique(wsMembers.map(m => m.workspace_id))

  const [inWorkspaces, legacy] = await Promise.all([
    selectIn('projects', '*', 'workspace_id', wsIds),
    // Anything the v2 backfill could not place still belongs to whoever made it.
    selectIn('projects', '*', 'user_id', ids).then(rows => rows.filter(p => !p.workspace_id)),
  ])

  const projects = [...byId([...inWorkspaces, ...legacy]).values()]
  const tasks = await selectIn('tasks', '*', 'project_id', projects.map(p => p.id))

  const projectName = new Map(projects.map(p => [p.id, p.name]))

  const rolesByUser = new Map(ids.map(id => [id, new Map()]))
  for (const m of wsMembers) rolesByUser.get(m.user_id)?.set(m.workspace_id, m.role)

  const teamsByUser = new Map(ids.map(id => [id, new Set()]))
  for (const m of teamMembers) teamsByUser.get(m.user_id)?.add(m.team_id)

  return profiles.map(profile => {
    const roles = rolesByUser.get(profile.id) ?? new Map()
    const teams = teamsByUser.get(profile.id) ?? new Set()

    const visible = projects.filter(p => {
      if (!p.workspace_id) return p.user_id === profile.id
      const role = roles.get(p.workspace_id)
      if (!role) return false
      if (WS_SEE_ALL.has(role)) return true
      return p.team_id ? teams.has(p.team_id) : true
    })

    const visibleIds = new Set(visible.map(p => p.id))
    const visibleTasks = tasks.filter(t => visibleIds.has(t.project_id))

    return {
      profile,
      projects: visible,
      // Every task on a board they can see — used for project-level progress.
      visibleTasks,
      // The subset that is theirs to act on — used for the task lists.
      tasks: visibleTasks.filter(t => ownsTask(t, profile.id)),
      projectName,
      roles,
    }
  })
}

/**
 * Whose task is it? The assignee, when there is one — otherwise whoever created
 * it. That keeps each task in exactly one person's digest instead of mailing
 * the same row to the assignee and the author both.
 */
function ownsTask(task, userId) {
  if (task.assignee_id) return task.assignee_id === userId
  return task.created_by === userId || task.user_id === userId
}

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

// ------------------------------------------------------------------ modes --

async function daily() {
  const today = todayISO()
  const horizon = addDays(today, 3)

  for (const { profile, tasks, projectName } of await loadBoards('daily_digest')) {
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

  for (const { profile, projects, tasks, visibleTasks, projectName } of await loadBoards('weekly_summary')) {
    const live = projects.filter(p => p.status === 'active' || p.status === 'on_hold')
    if (live.length === 0) {
      console.log(`no active projects for ${profile.email} — skipped`)
      continue
    }

    const rows = live.map(p => {
      // Progress is the whole project's, not just this person's slice of it.
      const own = visibleTasks.filter(t => t.project_id === p.id)
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

// --------------------------------------------------------------- access ----

/** Where the approval queue mail goes. The profiles flag wins; ADMIN_EMAIL is the fallback. */
async function superAdminRecipients() {
  const { data, error } = await db.from('profiles')
    .select('id,email,full_name').eq('is_super_admin', true)
  if (error) throw error
  const emails = unique((data ?? []).map(p => p.email).filter(Boolean))
  if (emails.length) return emails
  if (ADMIN_EMAIL) {
    console.log('no is_super_admin profile found — falling back to ADMIN_EMAIL')
    return [ADMIN_EMAIL]
  }
  return []
}

function requestCard(request) {
  return `
  <div style="margin:14px 0;padding:14px 16px;border:1px solid #e2e8f0;border-radius:10px">
    <div style="font-size:15px;font-weight:700;color:#0f172a">${escapeHtml(request.full_name || request.email)}</div>
    <div style="font-size:12px;color:#94a3b8;margin-top:2px">
      ${escapeHtml(request.email)}
      ${request.created_at ? ` &nbsp;·&nbsp; ${escapeHtml(fmtDateTime(request.created_at, 'UTC'))}` : ''}
    </div>
    ${detailTable([
      ['Gender', request.gender],
      ['Phone', request.phone],
      ['Organization', request.organization],
      ['Role', request.role_title],
      ['Country', request.country],
      ['GitHub', request.github_url],
      ['LinkedIn', request.linkedin_url],
      ['Account id', request.user_id],
      ['Requested workspace', request.requested_workspace_id],
    ])}
    ${request.motivation
      ? `<div style="margin-top:8px;font-size:12px;color:#94a3b8">Why they want in</div>${quote(request.motivation, '#4f46e5')}`
      : ''}
  </div>`
}

/**
 * The safety net behind supabase/functions/notify-admin. Anything the edge
 * function missed (bad secret, SMTP hiccup, function not deployed yet) is still
 * sitting here with admin_notified_at IS NULL, and gets mailed now.
 *
 * Second half: applicants whose request has been decided but never told.
 */
async function access() {
  const { data: requests, error } = await db.from('access_requests')
    .select('*').order('created_at', { ascending: true })
  if (error) throw error

  const pending = (requests ?? []).filter(r => r.status === 'pending' && !r.admin_notified_at)
  const decided = (requests ?? []).filter(r =>
    (r.status === 'approved' || r.status === 'rejected') && !r.user_notified_at)

  // ---- 1. tell the super admin about everyone still waiting -----------------
  if (pending.length) {
    const recipients = await superAdminRecipients()
    if (recipients.length === 0) {
      console.log('no super admin and no ADMIN_EMAIL — cannot route access requests')
    } else {
      const body = heading('Waiting on you', '#4f46e5') + pending.map(requestCard).join('')

      for (const to of recipients) {
        await send(
          to,
          `[Board] ${plural(pending.length, 'access request')} waiting`,
          layout({
            title: 'Approval queue',
            intro: pending.length === 1
              ? 'Someone asked to join the board.'
              : `<strong>${pending.length}</strong> people are waiting to join the board.`,
            body,
            ctaUrl: appLink('#admin'),
            ctaLabel: 'Review in the approval queue',
          }),
        )
      }

      if (!DRY_RUN) {
        const { error: stampError } = await db.from('access_requests')
          .update({ admin_notified_at: nowISO() })
          .in('id', pending.map(r => r.id))
        if (stampError) throw stampError
      }
    }
  } else {
    console.log('no unannounced access requests')
  }

  // ---- 2. tell the applicants what was decided -----------------------------
  for (const request of decided) {
    if (!request.email) {
      console.log(`request ${request.id} has no email — skipped`)
      continue
    }

    const name = request.full_name?.trim() || request.email
    const approved = request.status === 'approved'

    const body = approved
      ? `${heading('You are in', '#059669')}
         <div style="font-size:14px;color:#334155;line-height:1.7">
           Your account is active. Sign in with <strong>${escapeHtml(request.email)}</strong> and your
           workspace will be waiting on the other side.
         </div>
         ${request.decision_note ? quote(request.decision_note, '#059669') : ''}`
      : `${heading('About your request', '#64748b')}
         <div style="font-size:14px;color:#334155;line-height:1.7">
           Thank you for taking the time to apply. We are not able to grant access this time.
         </div>
         ${request.decision_note ? quote(request.decision_note, '#64748b') : ''}
         <div style="font-size:13px;color:#94a3b8;line-height:1.7;margin-top:10px">
           If you think this was a mistake, reply to this email and a human will take another look.
         </div>`

    await send(
      request.email,
      approved ? '[Board] Your access request was approved' : '[Board] About your access request',
      layout({
        title: approved ? 'Welcome aboard' : 'Access request update',
        intro: approved
          ? `Hello ${escapeHtml(name)} — your request to join the project board has been approved.`
          : `Hello ${escapeHtml(name)} — your request to join the project board has been reviewed.`,
        body,
        ctaUrl: approved ? APP_URL : '',
        ctaLabel: 'Open the board',
      }),
    )

    if (!DRY_RUN) {
      const { error: stampError } = await db.from('access_requests')
        .update({ user_notified_at: nowISO() })
        .eq('id', request.id)
      if (stampError) throw stampError
    }
  }

  if (!decided.length) console.log('no undelivered decisions')
}

// -------------------------------------------------------------- mentions ----

async function mentions() {
  const { data: rows, error } = await db.from('mentions')
    .select('*').is('notified_at', null).is('read_at', null)
    .order('created_at', { ascending: true })
  if (error) throw error
  if (!rows?.length) {
    console.log('no unsent mentions')
    return
  }

  const comments = await selectIn('comments', '*', 'id', rows.map(m => m.comment_id))
  const commentById = byId(comments)

  const tasks = await selectIn('tasks', 'id,title,project_id', 'id',
    comments.map(c => c.task_id).filter(Boolean))
  const taskById = byId(tasks)

  const projects = await selectIn('projects', 'id,name', 'id', [
    ...comments.map(c => c.project_id).filter(Boolean),
    ...tasks.map(t => t.project_id).filter(Boolean),
  ])
  const projectById = byId(projects)

  const people = await selectIn('profiles', '*', 'id', [
    ...rows.map(m => m.mentioned_user_id),
    ...comments.map(c => c.author_id),
  ])
  const personById = byId(people)

  // One digest per person, in the order the mentions arrived.
  const grouped = new Map()
  for (const mention of rows) {
    if (!grouped.has(mention.mentioned_user_id)) grouped.set(mention.mentioned_user_id, [])
    grouped.get(mention.mentioned_user_id).push(mention)
  }

  for (const [userId, group] of grouped) {
    const profile = personById.get(userId)
    if (!profile?.email) {
      console.log(`mention for unknown user ${userId} — skipped`)
      continue
    }
    if (profile.mention_alerts === false || profile.status !== 'active') {
      console.log(`${profile.email} has mention alerts off — skipped`)
      continue
    }

    const cards = []
    const sentIds = []

    for (const mention of group) {
      const comment = commentById.get(mention.comment_id)
      if (!comment) continue // the comment was deleted; nothing to say
      const task = comment.task_id ? taskById.get(comment.task_id) : null
      const project = projectById.get(comment.project_id ?? task?.project_id)
      const author = personById.get(comment.author_id)

      cards.push(`
      <tr><td style="padding:11px 0;border-bottom:1px solid #f1f5f9">
        <div style="font-size:14px;font-weight:600;color:#0f172a">
          ${escapeHtml(displayName(author))} mentioned you
        </div>
        <div style="font-size:12px;color:#94a3b8;margin-top:3px">
          ${escapeHtml(task?.title ?? project?.name ?? 'A conversation')}
          ${task && project ? ` &nbsp;·&nbsp; ${escapeHtml(project.name)}` : ''}
          &nbsp;·&nbsp; ${escapeHtml(fmtDateTime(comment.created_at, profile.timezone))}
        </div>
        ${quote(excerpt(comment.body), '#4f46e5')}
      </td></tr>`)
      sentIds.push(mention.id)
    }

    if (cards.length === 0) {
      console.log(`every pending mention for ${profile.email} lost its comment — nothing to send`)
      // Stamp anyway: there is no comment left to notify about, ever.
      if (!DRY_RUN) {
        const { error: stampError } = await db.from('mentions')
          .update({ notified_at: nowISO() }).in('id', group.map(m => m.id))
        if (stampError) throw stampError
      }
      continue
    }

    await send(
      profile.email,
      `[Board] ${plural(cards.length, 'new mention')}`,
      layout({
        title: 'You were mentioned',
        intro: cards.length === 1
          ? 'Someone tagged you in a comment.'
          : `You were tagged in <strong>${cards.length}</strong> comments.`,
        body: section('Mentions', '#4f46e5', cards),
      }),
    )

    if (!DRY_RUN) {
      const { error: stampError } = await db.from('mentions')
        .update({ notified_at: nowISO() }).in('id', sentIds)
      if (stampError) throw stampError
    }
  }
}

// -------------------------------------------------------------- meetings ----

async function meetings() {
  const from = new Date()
  const until = new Date(from.getTime() + 24 * 60 * 60 * 1000)

  const { data: upcoming, error } = await db.from('meetings')
    .select('*')
    .eq('status', 'scheduled')
    .gte('starts_at', from.toISOString())
    .lte('starts_at', until.toISOString())
    .order('starts_at', { ascending: true })
  if (error) throw error
  if (!upcoming?.length) {
    console.log('no meetings in the next 24 hours')
    return
  }

  const attendees = await selectIn('meeting_attendees', '*', 'meeting_id', upcoming.map(m => m.id))
  if (attendees.length === 0) {
    console.log('meetings found, but nobody is invited')
    return
  }

  const people = await selectIn('profiles', '*', 'id', [
    ...attendees.map(a => a.user_id),
    ...upcoming.map(m => m.created_by).filter(Boolean),
  ])
  const personById = byId(people)

  const workspaces = await selectIn('workspaces', 'id,name', 'id', upcoming.map(m => m.workspace_id))
  const workspaceById = byId(workspaces)

  for (const meeting of upcoming) {
    const invited = attendees.filter(a => a.meeting_id === meeting.id)
    const everyEmail = unique(invited.map(a => personById.get(a.user_id)?.email).filter(Boolean))
    const organizer = personById.get(meeting.created_by)?.email || MAIL_FROM || SMTP_USER
    const workspace = workspaceById.get(meeting.workspace_id)
    const join = safeUrl(meeting.meeting_url)

    const ics = buildIcs({
      uid: `meeting-${meeting.id}@project-board`,
      title: meeting.title,
      description: [meeting.agenda, join ? `Join: ${join}` : '', appLink('#meetings')]
        .filter(Boolean).join('\n\n'),
      location: meeting.location || join || '',
      url: join || '',
      startsAt: meeting.starts_at,
      endsAt: meeting.ends_at,
      organizerEmail: organizer,
      attendeeEmails: everyEmail,
      sequence: 0,
      status: meeting.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED',
    })

    for (const attendee of invited) {
      if (attendee.notified_at) continue
      const profile = personById.get(attendee.user_id)
      if (!profile?.email) continue
      if (profile.meeting_alerts === false || profile.status !== 'active') {
        console.log(`${profile.email} has meeting alerts off — skipped`)
        continue
      }

      const tz = profile.timezone || 'UTC'
      const body = `
        ${detailTable([
          ['When', `${fmtDateTime(meeting.starts_at, tz)} → ${fmtDateTime(meeting.ends_at, tz)}`],
          ['Timezone', tz],
          ['Where', meeting.location],
          ['Join link', join],
          ['Workspace', workspace?.name],
          ['Attendees', everyEmail.length ? plural(everyEmail.length, 'person', '') : null],
        ])}
        ${meeting.agenda ? heading('Agenda', '#4f46e5') + quote(meeting.agenda, '#4f46e5') : ''}
        <div style="font-size:12px;color:#94a3b8;line-height:1.7;margin-top:12px">
          The attached invite adds this to your calendar.
        </div>`

      await send(
        profile.email,
        `[Board] ${meeting.title} — ${fmtDateTime(meeting.starts_at, tz)}`,
        layout({
          title: 'Meeting reminder',
          intro: `<strong>${escapeHtml(meeting.title)}</strong> starts at <strong>${escapeHtml(fmtDateTime(meeting.starts_at, tz))}</strong>.`,
          body,
          ctaUrl: join || APP_URL,
          ctaLabel: join ? 'Join the meeting' : 'Open the board',
        }),
        [{
          filename: 'invite.ics',
          content: ics,
          contentType: 'text/calendar; charset=utf-8; method=REQUEST',
        }],
      )

      if (!DRY_RUN) {
        const { error: stampError } = await db.from('meeting_attendees')
          .update({ notified_at: nowISO() }).eq('id', attendee.id)
        if (stampError) throw stampError
      }
    }
  }
}

// ---------------------------------------------------------- admin digest ----

/** Mirrors isAtRisk() in src/lib/types.ts — keep the two in step. */
function atRisk(health) {
  if (health.status === 'completed' || health.status === 'archived') return false
  const stale = health.last_activity
    ? (Date.now() - new Date(health.last_activity).getTime()) / 86_400_000 > STALE_DAYS
    : true
  const overdue = Number(health.overdue_tasks ?? 0)
  const blocked = Number(health.blocked_tasks ?? 0)
  return (overdue > 0 && blocked > 0) || (overdue > 0 && stale)
}

/**
 * project_health is a security_invoker view. The service role should read it
 * straight through, but if the grant is missing on somebody's instance we roll
 * the same numbers up from projects and tasks rather than dropping the digest.
 */
async function loadProjectHealth(workspaceIds) {
  if (workspaceIds.length === 0) return []
  try {
    const rows = await selectIn('project_health', '*', 'workspace_id', workspaceIds)
    if (rows.length) return rows
  } catch (err) {
    console.log(`project_health unreadable (${err.message ?? err}) — rolling up by hand`)
  }

  const projects = await selectIn('projects', '*', 'workspace_id', workspaceIds)
  if (projects.length === 0) return []
  const teams = await selectIn('teams', 'id,name', 'id', projects.map(p => p.team_id).filter(Boolean))
  const teamById = byId(teams)
  const tasks = await selectIn('tasks', 'id,project_id,status,due_date,updated_at', 'project_id',
    projects.map(p => p.id))
  const today = todayISO()

  return projects.map(p => {
    const own = tasks.filter(t => t.project_id === p.id)
    const done = own.filter(t => t.status === 'done').length
    return {
      id: p.id,
      workspace_id: p.workspace_id,
      team_id: p.team_id,
      name: p.name,
      color: p.color,
      status: p.status,
      due_date: p.due_date,
      team_name: teamById.get(p.team_id)?.name ?? null,
      total_tasks: own.length,
      done_tasks: done,
      blocked_tasks: own.filter(t => t.status === 'blocked').length,
      overdue_tasks: own.filter(t => t.status !== 'done' && t.due_date && t.due_date < today).length,
      percent_done: own.length ? Math.round((done / own.length) * 100) : 0,
      last_activity: own.reduce((max, t) => (t.updated_at > max ? t.updated_at : max), ''),
      submitted_at: p.submitted_at,
    }
  })
}

function healthRow(health) {
  const raw = Number(health.percent_done ?? 0)
  const pct = Number.isFinite(raw) ? Math.max(0, Math.min(100, Math.round(raw))) : 0
  const color = health.color || '#6366f1'
  const overdue = Number(health.overdue_tasks ?? 0)
  const blocked = Number(health.blocked_tasks ?? 0)
  const risky = atRisk(health)

  return `
  <tr><td style="padding:11px 0;border-bottom:1px solid #f1f5f9">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td width="4" style="background:${escapeHtml(color)};border-radius:2px"></td>
      <td style="padding-left:12px">
        <div style="font-size:14px;font-weight:600;color:#0f172a">
          ${escapeHtml(health.name)}
          ${risky
            ? `<span style="margin-left:8px;font-size:10px;font-weight:700;letter-spacing:.06em;
                            text-transform:uppercase;color:#be123c;background:#ffe4e6;
                            padding:2px 7px;border-radius:999px">At risk</span>`
            : ''}
        </div>
        <div style="font-size:12px;color:#94a3b8;margin-top:3px">
          ${escapeHtml(String(health.done_tasks ?? 0))}/${escapeHtml(String(health.total_tasks ?? 0))} done · ${pct}%
          ${overdue ? ` · <span style="color:#e11d48;font-weight:600">${overdue} overdue</span>` : ''}
          ${blocked ? ` · <span style="color:#7c3aed;font-weight:600">${blocked} blocked</span>` : ''}
          ${health.last_activity
            ? ` · last touched ${escapeHtml(fmtDateTime(health.last_activity, 'UTC'))}`
            : ' · no activity yet'}
        </div>
        <div style="margin-top:7px;background:#e2e8f0;border-radius:4px;height:6px;width:100%">
          <div style="background:${escapeHtml(color)};height:6px;border-radius:4px;width:${pct}%"></div>
        </div>
      </td>
    </tr></table>
  </td></tr>`
}

async function adminDigest() {
  const memberships = await (async () => {
    const { data, error } = await db.from('workspace_members')
      .select('workspace_id,user_id,role').in('role', [...WS_ADMIN_ROLES])
    if (error) throw error
    return data ?? []
  })()

  if (memberships.length === 0) {
    console.log('nobody administers a workspace yet')
    return
  }

  const admins = await selectIn('profiles', '*', 'id', memberships.map(m => m.user_id))
  const adminById = byId(admins)

  const workspaces = (await selectIn('workspaces', '*', 'id', memberships.map(m => m.workspace_id)))
    .filter(w => !w.is_archived)
  const workspaceById = byId(workspaces)
  const workspaceIds = workspaces.map(w => w.id)

  if (workspaceIds.length === 0) {
    console.log('every workspace is archived — nothing to roll up')
    return
  }

  const [health, milestones, requests] = await Promise.all([
    loadProjectHealth(workspaceIds),
    (async () => {
      const rows = await selectIn('milestones', '*', 'workspace_id', workspaceIds)
      const now = nowISO()
      return rows.filter(m => m.due_at >= now).sort((a, b) => a.due_at.localeCompare(b.due_at))
    })(),
    (async () => {
      const { data, error } = await db.from('access_requests')
        .select('id,requested_workspace_id,status').eq('status', 'pending')
      if (error) throw error
      return data ?? []
    })(),
  ])

  const byWorkspace = new Map(workspaceIds.map(id => [id, []]))
  for (const m of memberships) {
    if (byWorkspace.has(m.workspace_id)) byWorkspace.get(m.workspace_id).push(m.user_id)
  }

  // Flip it around: one email per admin, covering every workspace they run.
  const adminWorkspaces = new Map()
  for (const m of memberships) {
    if (!workspaceById.has(m.workspace_id)) continue
    if (!adminWorkspaces.has(m.user_id)) adminWorkspaces.set(m.user_id, [])
    adminWorkspaces.get(m.user_id).push(m.workspace_id)
  }

  const unplacedRequests = requests.filter(r => !r.requested_workspace_id).length

  for (const [userId, wsIds] of adminWorkspaces) {
    const profile = adminById.get(userId)
    if (!profile?.email) continue
    if (profile.status !== 'active') continue
    // This is the weekly mail, so it honours the weekly switch.
    if (profile.weekly_summary === false) {
      console.log(`${profile.email} has the weekly summary off — skipped`)
      continue
    }

    const blocks = []
    let projectCount = 0
    let riskCount = 0

    for (const wsId of unique(wsIds)) {
      const workspace = workspaceById.get(wsId)
      if (!workspace) continue

      const wsHealth = health.filter(h => h.workspace_id === wsId)
      const wsMilestones = milestones.filter(m => m.workspace_id === wsId).slice(0, 5)
      const wsRequests = requests.filter(r => r.requested_workspace_id === wsId).length

      if (wsHealth.length === 0 && wsMilestones.length === 0 && wsRequests === 0) continue

      // Group each workspace's projects under the team that owns them.
      const teams = new Map()
      for (const h of wsHealth) {
        const key = h.team_name || 'No team'
        if (!teams.has(key)) teams.set(key, [])
        teams.get(key).push(h)
      }

      const teamBlocks = [...teams.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([teamName, rows]) => {
          rows.sort((a, b) => Number(b.overdue_tasks ?? 0) - Number(a.overdue_tasks ?? 0))
          return section(teamName, '#0284c7', rows.map(healthRow))
        })
        .join('')

      projectCount += wsHealth.length
      riskCount += wsHealth.filter(atRisk).length

      const milestoneRows = wsMilestones.map(m => `
        <tr><td style="padding:9px 0;border-bottom:1px solid #f1f5f9">
          <div style="font-size:14px;font-weight:600;color:#0f172a">${escapeHtml(m.name)}</div>
          <div style="font-size:12px;color:#94a3b8;margin-top:3px">
            ${escapeHtml(m.kind)} &nbsp;·&nbsp; ${escapeHtml(fmtDateTime(m.due_at, profile.timezone))}
          </div>
          ${m.description
            ? `<div style="font-size:12px;color:#64748b;margin-top:4px">${escapeHtml(excerpt(m.description, 160))}</div>`
            : ''}
        </td></tr>`)

      const pendingLine = wsRequests || (profile.is_super_admin && unplacedRequests)
        ? `<div style="margin-top:12px;padding:11px 14px;background:#eef2ff;border-radius:10px;
                       font-size:13px;color:#3730a3;line-height:1.6">
             <strong>${wsRequests}</strong> access request${wsRequests === 1 ? '' : 's'} pending for this workspace${
               profile.is_super_admin && unplacedRequests
                 ? ` — plus <strong>${unplacedRequests}</strong> not yet assigned to one.`
                 : '.'}
           </div>`
        : ''

      blocks.push(`
        <div style="margin:22px 0 6px;padding-bottom:6px;border-bottom:2px solid #e2e8f0">
          <div style="font-size:17px;font-weight:700;color:#0f172a">
            ${escapeHtml(workspace.emoji || '')} ${escapeHtml(workspace.name)}
          </div>
          <div style="font-size:12px;color:#94a3b8;margin-top:2px">
            ${escapeHtml(workspace.kind)} &nbsp;·&nbsp; ${plural(wsHealth.length, 'project')}
          </div>
        </div>
        ${teamBlocks}
        ${milestoneRows.length ? section('Upcoming milestones', '#7c3aed', milestoneRows) : ''}
        ${pendingLine}`)
    }

    if (blocks.length === 0) {
      console.log(`nothing to report to ${profile.email} — skipped`)
      continue
    }

    await send(
      profile.email,
      `[Board] Admin roll-up — ${plural(projectCount, 'project')}${riskCount ? `, ${riskCount} at risk` : ''}`,
      layout({
        title: 'Admin roll-up',
        intro: riskCount
          ? `Across the workspaces you run: <strong>${projectCount}</strong> project${projectCount === 1 ? '' : 's'}, <strong>${riskCount}</strong> of them at risk.`
          : `Across the workspaces you run: <strong>${projectCount}</strong> project${projectCount === 1 ? '' : 's'}, none flagged at risk.`,
        body: blocks.join(''),
        ctaUrl: appLink('#admin'),
        ctaLabel: 'Open the admin view',
      }),
    )
  }
}

// ------------------------------------------------------------------- main --

const RUNNERS = {
  daily,
  weekly,
  blocked,
  access,
  mentions,
  meetings,
  'admin-digest': adminDigest,
}

try {
  await RUNNERS[MODE]()
  console.log(`${MODE} alerts complete`)
} catch (err) {
  console.error(`${MODE} alerts failed:`, err.message ?? err)
  process.exit(1)
}
