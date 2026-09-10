#!/usr/bin/env node
/**
 * End-to-end smoke test: every flow the UI performs, driven as real signed-in
 * users through PostgREST so row level security is fully in play. Unit tests
 * cannot catch RLS regressions — only a real JWT against a real policy can.
 *
 *   SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=...  *     npm run smoke
 *
 * It creates three throwaway accounts (`smoke.*@example.com`) and deletes them
 * in a finally block, along with everything they made, which cascades. It never
 * touches rows it did not create. Safe to run against production, though a
 * staging project is the better habit.
 */

import fs from 'node:fs'

const base = process.env.SUPABASE_URL
const ANON = process.env.SUPABASE_ANON_KEY
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!base || !ANON || !SERVICE) {
  console.error('Set SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY.')
  process.exit(1)
}
void fs

const svc = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' }

const pass = [], fail = []
const ok = (c, label, extra = '') => (c ? pass : fail).push(label + (!c && extra ? ` — ${extra}` : ''))

async function admin(path, method = 'GET', body, prefer) {
  const r = await fetch(`${base}${path}`, {
    method, headers: prefer ? { ...svc, Prefer: prefer } : svc,
    body: body ? JSON.stringify(body) : undefined,
  })
  const t = await r.text()
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${t.slice(0, 200)}`)
  return t ? JSON.parse(t) : null
}

/** Everything a signed-in user does goes through here, exactly like the app. */
async function as(jwt, path, method = 'GET', body, prefer = 'return=representation') {
  const r = await fetch(`${base}${path}`, {
    method,
    headers: { apikey: ANON, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json', Prefer: prefer },
    body: body ? JSON.stringify(body) : undefined,
  })
  const t = await r.text()
  let j = null
  try { j = JSON.parse(t) } catch { /* empty body */ }
  return { status: r.status, json: j, text: t }
}

async function rpc(jwt, fn, args) {
  const r = await fetch(`${base}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args ?? {}),
  })
  const t = await r.text()
  let j = null
  try { j = JSON.parse(t) } catch { /* */ }
  return { status: r.status, json: j, text: t }
}

async function signUp(email, password, meta) {
  const r = await fetch(`${base}/auth/v1/signup`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, data: meta ?? {} }),
  })
  return r.json()
}

async function signIn(email, password) {
  const r = await fetch(`${base}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  return r.json()
}

const stamp = Date.now()
const PW = 'SmokeTest-' + Math.random().toString(36).slice(2, 10)
const owner = { email: `smoke.owner.${stamp}@example.com` }
const joiner = { email: `smoke.joiner.${stamp}@example.com` }
const applicant = { email: `smoke.applicant.${stamp}@example.com` }
const created = []

try {
  // ---------------------------------------------------------------- setup --
  const o = await admin('/auth/v1/admin/users', 'POST', { email: owner.email, password: PW, email_confirm: true })
  owner.id = o.id; created.push(o.id)
  await admin(`/rest/v1/profiles?id=eq.${owner.id}`, 'PATCH', { status: 'active', is_super_admin: true })
  owner.jwt = (await signIn(owner.email, PW)).access_token
  ok(Boolean(owner.jwt), 'owner signs in')

  // ------------------------------------------------- workspace and team ----
  const wsRes = await as(owner.jwt, '/rest/v1/workspaces', 'POST', {
    name: 'Smoke Hackathon', slug: `smoke-${stamp}`, kind: 'hackathon',
    owner_id: owner.id, emoji: '', color: '#ef4444',
    join_code: `SMOKE${String(stamp).slice(-3)}`, join_code_enabled: true, join_role: 'member',
  })
  const ws = wsRes.json?.[0]
  ok(wsRes.status === 201 && Boolean(ws), 'create workspace (with RETURNING)', wsRes.text.slice(0, 120))
  if (!ws) throw new Error('cannot continue without a workspace')

  const seat = await as(owner.jwt, `/rest/v1/workspace_members?workspace_id=eq.${ws.id}&select=role`)
  ok(seat.json?.[0]?.role === 'owner', 'creator is seated as workspace owner')

  const teamRes = await as(owner.jwt, '/rest/v1/teams', 'POST',
    { workspace_id: ws.id, name: 'Smoke Team', created_by: owner.id, emoji: '', color: '#ef4444' })
  const team = teamRes.json?.[0]
  ok(teamRes.status === 201 && Boolean(team), 'create team (with RETURNING)', teamRes.text.slice(0, 120))

  const tm = await as(owner.jwt, `/rest/v1/team_members?team_id=eq.${team.id}&select=role`)
  ok(tm.json?.[0]?.role === 'lead', 'creator is seated as team lead')

  // --------------------------------------------------- project and tasks ----
  const projRes = await as(owner.jwt, '/rest/v1/projects', 'POST', {
    workspace_id: ws.id, team_id: team.id, user_id: owner.id, created_by: owner.id,
    name: 'Smoke project', color: '#ef4444', sort_order: 1000,
  })
  const proj = projRes.json?.[0]
  ok(projRes.status === 201 && Boolean(proj), 'create project (the bug that was reported)', projRes.text.slice(0, 140))
  if (!proj) throw new Error('cannot continue without a project')

  const taskRes = await as(owner.jwt, '/rest/v1/tasks', 'POST', {
    project_id: proj.id, user_id: owner.id, created_by: owner.id, assignee_id: owner.id,
    title: 'Smoke task', status: 'todo', priority: 'high', sort_order: 1000,
  })
  const task = taskRes.json?.[0]
  ok(taskRes.status === 201 && Boolean(task), 'create task (with RETURNING)', taskRes.text.slice(0, 140))

  const moved = await as(owner.jwt, `/rest/v1/tasks?id=eq.${task.id}`, 'PATCH',
    { status: 'blocked', blocked_reason: 'smoke test' })
  ok(moved.status === 200 && Boolean(moved.json?.[0]?.blocked_at), 'move task to blocked stamps blocked_at')
  ok(moved.json?.[0]?.blocked_notified_at === null, 'blocked task is armed for the alert')

  const done = await as(owner.jwt, `/rest/v1/tasks?id=eq.${task.id}`, 'PATCH', { status: 'done' })
  ok(Boolean(done.json?.[0]?.completed_at), 'moving to done stamps completed_at')
  ok(done.json?.[0]?.blocked_at === null, 'leaving blocked clears blocked_at')

  // ------------------------------------------- comments, mentions, links ----
  const cRes = await as(owner.jwt, '/rest/v1/comments', 'POST',
    { task_id: task.id, author_id: owner.id, body: 'Smoke comment mentioning someone' })
  const comment = cRes.json?.[0]
  ok(cRes.status === 201 && Boolean(comment), 'post a comment', cRes.text.slice(0, 120))

  const mRes = await as(owner.jwt, '/rest/v1/mentions', 'POST',
    { comment_id: comment.id, mentioned_user_id: owner.id })
  ok(mRes.status === 201, 'record an @mention', mRes.text.slice(0, 120))

  const aRes = await as(owner.jwt, '/rest/v1/attachments', 'POST',
    { task_id: task.id, label: 'Spec', url: 'https://example.com/spec', kind: 'doc', created_by: owner.id })
  ok(aRes.status === 201, 'attach a link', aRes.text.slice(0, 120))

  // ------------------------------------------------ milestones, meetings ----
  const msRes = await as(owner.jwt, '/rest/v1/milestones', 'POST', {
    workspace_id: ws.id, name: 'Demo day', kind: 'demo',
    due_at: new Date(Date.now() + 3 * 86400000).toISOString(), sort_order: 1000,
  })
  ok(msRes.status === 201, 'create a milestone', msRes.text.slice(0, 120))

  const mtRes = await as(owner.jwt, '/rest/v1/meetings', 'POST', {
    workspace_id: ws.id, team_id: team.id, title: 'Stand-up', created_by: owner.id,
    starts_at: new Date(Date.now() + 3600000).toISOString(),
    ends_at: new Date(Date.now() + 5400000).toISOString(),
    provider: 'teams', meeting_url: 'https://teams.microsoft.com/l/meetup-join/smoke',
  })
  const meeting = mtRes.json?.[0]
  ok(mtRes.status === 201 && Boolean(meeting), 'schedule a meeting', mtRes.text.slice(0, 120))

  const attRes = await as(owner.jwt, '/rest/v1/meeting_attendees', 'POST',
    { meeting_id: meeting.id, user_id: owner.id, response: 'accepted' })
  ok(attRes.status === 201, 'add a meeting attendee', attRes.text.slice(0, 120))

  // ------------------------------------------- trash and recoverable delete --
  const trashTask = await as(owner.jwt, `/rest/v1/tasks?id=eq.${task.id}`, 'PATCH',
    { deleted_at: new Date().toISOString() })
  ok(trashTask.status === 200, 'soft-delete a task', trashTask.text.slice(0, 120))

  const liveAfter = await as(owner.jwt, `/rest/v1/tasks?project_id=eq.${proj.id}&deleted_at=is.null&select=id`)
  ok(liveAfter.json?.length === 0, 'trashed task drops out of the live board')

  const restored = await as(owner.jwt, `/rest/v1/tasks?id=eq.${task.id}`, 'PATCH', { deleted_at: null })
  ok(restored.status === 200 && restored.json?.[0]?.deleted_at === null, 'restore brings the task back')

  // Trashing a project must carry its tasks down with it, by trigger.
  await as(owner.jwt, `/rest/v1/projects?id=eq.${proj.id}`, 'PATCH',
    { deleted_at: new Date().toISOString() })
  const cascaded = await as(owner.jwt, `/rest/v1/tasks?id=eq.${task.id}&select=deleted_at`)
  ok(Boolean(cascaded.json?.[0]?.deleted_at), 'trashing a project carries its tasks with it')

  await as(owner.jwt, `/rest/v1/projects?id=eq.${proj.id}`, 'PATCH', { deleted_at: null })
  const uncascaded = await as(owner.jwt, `/rest/v1/tasks?id=eq.${task.id}&select=deleted_at`)
  ok(uncascaded.json?.[0]?.deleted_at === null, 'restoring a project brings those tasks back')

  const healthLive = await as(owner.jwt, `/rest/v1/project_health?id=eq.${proj.id}&select=id`)
  ok(healthLive.json?.length === 1, 'project_health shows a restored project')

  // ------------------------------------------------------- invite links -----
  const inviteToken = 'smoketoken' + String(stamp).slice(-8)
  const linkRes = await as(owner.jwt, '/rest/v1/invite_links', 'POST', {
    workspace_id: ws.id, team_id: team.id, token: inviteToken,
    role: 'member', label: 'Smoke invite', max_uses: 1, created_by: owner.id,
  })
  ok(linkRes.status === 201, 'create an invite link', linkRes.text.slice(0, 120))

  // --------------------------------------------------- join code redeem ----
  const j = await signUp(joiner.email, PW, { full_name: 'Smoke Joiner' })
  joiner.id = j.user?.id ?? j.id; created.push(joiner.id)
  joiner.jwt = j.access_token ?? (await signIn(joiner.email, PW)).access_token

  const beforeJoin = await as(joiner.jwt, '/rest/v1/workspaces?select=id')
  ok(beforeJoin.json?.length === 0, 'pending joiner sees no workspaces')

  const redeem = await rpc(joiner.jwt, 'redeem_join_code', { code: `smoke${String(stamp).slice(-3)}` })
  ok(redeem.json?.ok === true, 'redeem join code (case-insensitive)', redeem.text.slice(0, 140))

  const afterJoin = await as(joiner.jwt, '/rest/v1/workspaces?select=id,name')
  ok(afterJoin.json?.length === 1 && afterJoin.json[0].id === ws.id,
    'joiner now sees exactly that one workspace', afterJoin.text.slice(0, 120))

  const joinerProjects = await as(joiner.jwt, '/rest/v1/projects?select=id')
  ok(joinerProjects.json?.length === 0,
    'joiner cannot see a team board they are not on', joinerProjects.text.slice(0, 120))

  // ------------------------------------------------- approval by the admin --
  const ap = await signUp(applicant.email, PW, {
    full_name: 'Smoke Applicant', organization: 'Ashesi', role_title: 'Designer', country: 'Ghana',
  })
  applicant.id = ap.user?.id ?? ap.id; created.push(applicant.id)
  applicant.jwt = ap.access_token ?? (await signIn(applicant.email, PW)).access_token

  const reqRow = await admin(`/rest/v1/access_requests?user_id=eq.${applicant.id}&select=id,status`)
  ok(reqRow[0]?.status === 'pending', 'applicant queued for review')

  const review = await rpc(owner.jwt, 'review_access_request', {
    request_id: reqRow[0].id, decision: 'approved', ws: ws.id, assign_role: 'admin', team: null, note: 'welcome',
  })
  ok(review.json?.ok === true, 'super admin approves the request', review.text.slice(0, 140))

  const applicantWs = await as(applicant.jwt, '/rest/v1/workspaces?select=id')
  ok(applicantWs.json?.length === 1, 'approved applicant can now see the workspace', applicantWs.text.slice(0, 120))

  const adminProjects = await as(applicant.jwt, '/rest/v1/projects?select=id')
  ok(adminProjects.json?.length === 1, 'an approved admin sees every project in the workspace',
    adminProjects.text.slice(0, 120))

  // The joiner is a plain member of a team they are not on — still nothing.
  const joinerRedeem = await as(joiner.jwt, '/rest/v1/projects?select=id')
  ok(joinerRedeem.json?.length === 0, "a plain member still cannot see another team's board")

  // Judging is removed: the tables must be gone, not merely unused.
  const goneScores = await as(owner.jwt, '/rest/v1/scores?select=id')
  ok(goneScores.status >= 400, 'judging tables are gone', `status ${goneScores.status}`)

  const linkRedeem = await rpc(joiner.jwt, 'redeem_invite_link', { link_token: inviteToken })
  ok(linkRedeem.json?.ok === true, 'redeem an invite link', linkRedeem.text.slice(0, 140))

  const reused = await rpc(applicant.jwt, 'redeem_invite_link', { link_token: inviteToken })
  ok(reused.json?.ok === false, 'a single-use invite refuses a second redemption', reused.text.slice(0, 140))

  // -------------------------------------------------- password recovery ----
  // The reset link is the only way back in for someone who forgets, and the app
  // has to complete it — signing them in without letting them set a new
  // password would leave the forgotten one in force.
  const resetEmail = `smoke.reset.${stamp}@example.com`
  const OLD_PW = 'OldPassword-123', NEW_PW = 'BrandNewPassword-456'
  const ru = await admin('/auth/v1/admin/users', 'POST',
    { email: resetEmail, password: OLD_PW, email_confirm: true })
  created.push(ru.id)

  const link = await admin('/auth/v1/admin/generate_link', 'POST',
    { type: 'recovery', email: resetEmail })
  const tokenHash = link.hashed_token ?? link.properties?.hashed_token
  ok(Boolean(tokenHash), 'recovery link generated')

  const verified = await (await fetch(`${base}/auth/v1/verify`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'recovery', token_hash: tokenHash }),
  })).json()
  ok(Boolean(verified.access_token), 'recovery link yields a session')

  if (verified.access_token) {
    const upd = await fetch(`${base}/auth/v1/user`, {
      method: 'PUT',
      headers: {
        apikey: ANON, Authorization: `Bearer ${verified.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ password: NEW_PW }),
    })
    ok(upd.ok, 'the new password is accepted', String(upd.status))
  }

  const newLogin = await signIn(resetEmail, NEW_PW)
  ok(Boolean(newLogin.access_token), 'can sign in with the new password')
  const oldLogin = await signIn(resetEmail, OLD_PW)
  ok(!oldLogin.access_token, 'the old password stops working')

  // ---------------------------------------------------------- rejection ----
  const rej = await rpc(owner.jwt, 'review_access_request', {
    request_id: reqRow[0].id, decision: 'rejected', ws: null, note: 'changed my mind',
  })
  ok(rej.json?.ok === true, 'super admin can reject a request', rej.text.slice(0, 120))
  const rejProfile = await admin(`/rest/v1/profiles?id=eq.${applicant.id}&select=status`)
  ok(rejProfile[0]?.status === 'rejected', 'rejection sets the account back to rejected')

  // ------------------------------------------------------------- audit ----
  const audit = await as(owner.jwt, `/rest/v1/audit_log?workspace_id=eq.${ws.id}&select=action`)
  ok((audit.json?.length ?? 0) >= 2, 'audit log recorded the workspace and the decisions',
    JSON.stringify(audit.json))
} catch (e) {
  fail.push(`threw: ${e.message}`)
} finally {
  console.log(`\nRemoving only the ${created.length} smoke accounts; their workspaces, teams,`)
  console.log('projects, tasks, meetings and scores cascade with them.')
  for (const id of created) {
    if (id) await fetch(`${base}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: svc })
  }
  const left = await admin('/rest/v1/profiles?select=email')
  const ws = await admin('/rest/v1/workspaces?select=name')
  console.log('accounts remaining:  ', JSON.stringify(left))
  console.log('workspaces remaining:', JSON.stringify(ws))

  console.log('\n--- results ---')
  for (const p of pass) console.log('  PASS  ' + p)
  for (const f of fail) console.log('  FAIL  ' + f)
  console.log(`\n${pass.length} passed, ${fail.length} failed`)
  process.exitCode = fail.length ? 1 : 0
}
