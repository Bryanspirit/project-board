/**
 * Greets a new account the moment it exists, and tells the administrator.
 *
 * Before this, signing up was silent from the applicant's side: the only mail
 * went to the admin, so the person who had just filled in a form had no
 * confirmation that anything had happened. Someone arriving through a join code
 * or an invite link never reached the approval queue at all, so neither of them
 * heard anything.
 *
 * Fired by a trigger on `profiles`, which is the one row every signup produces
 * whichever door it came through. `welcome_sent_at` is stamped only after the
 * send, so a failure here is retried by the `access` sweep rather than lost.
 */

import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'

const env = (key: string, fallback = ''): string => Deno.env.get(key) ?? fallback

const SUPABASE_URL = env('SUPABASE_URL')
const SERVICE_KEY = env('SUPABASE_SERVICE_ROLE_KEY')
const WEBHOOK_SECRET = env('WEBHOOK_SECRET')
const APP_URL = env('APP_URL')
const SMTP_HOST = env('SMTP_HOST', 'smtp.gmail.com')
const SMTP_PORT = Number(env('SMTP_PORT', '465'))
const SMTP_USER = env('SMTP_USER')
const SMTP_PASS = env('SMTP_PASS')
const MAIL_FROM = env('MAIL_FROM', SMTP_USER)
const ADMIN_EMAIL = env('ADMIN_EMAIL')

const JSON_HEADERS = { 'Content-Type': 'application/json' }
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })

const rest = `${SUPABASE_URL.replace(/\/+$/, '')}/rest/v1`
const headers = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
}

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}

/** The same table-based shell the scheduled sender uses, so both look alike. */
function layout(opts: { title: string; intro: string; body: string; cta?: string }): string {
  const cta = opts.cta && APP_URL
    ? `<tr><td style="padding:8px 28px 32px">
         <a href="${escapeHtml(APP_URL)}"
            style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;
                   font-size:14px;font-weight:600;padding:11px 20px;border-radius:8px">
           ${escapeHtml(opts.cta)}
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
      <div style="color:#ffffff;font-size:21px;font-weight:700;margin-top:4px">${escapeHtml(opts.title)}</div>
    </td></tr>
    <tr><td style="padding:24px 28px 4px;color:#475569;font-size:14px;line-height:1.6">${opts.intro}</td></tr>
    <tr><td style="padding:8px 28px">${opts.body}</td></tr>
    ${cta}
    <tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:16px 28px;
                   color:#94a3b8;font-size:11px;line-height:1.6">
      You are receiving this because an account was created with this address.
    </td></tr>
  </table>
</td></tr></table>
</body></html>`
}

async function sendMail(to: string, subject: string, html: string): Promise<void> {
  const client = new SMTPClient({
    connection: {
      hostname: SMTP_HOST,
      port: SMTP_PORT,
      tls: SMTP_PORT === 465,
      auth: { username: SMTP_USER, password: SMTP_PASS },
    },
  })
  try {
    await client.send({ from: MAIL_FROM, to, subject, html, content: 'auto' })
  } finally {
    // close() is typed as returning a promise but resolves to undefined in some
    // denomailer builds, so awaiting it directly is the only safe form.
    try { await client.close() } catch { /* a failed teardown is not a failure */ }
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  try {
    if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405)
    if (!WEBHOOK_SECRET || req.headers.get('x-webhook-secret') !== WEBHOOK_SECRET) {
      return json({ ok: false, error: 'unauthorised' }, 401)
    }
    if (!SMTP_USER || !SMTP_PASS) return json({ ok: false, error: 'SMTP not configured' }, 500)

    const record = (await req.json().catch(() => null))?.record
    if (!record?.id || !record?.email) return json({ ok: false, error: 'no profile in payload' }, 400)
    if (record.welcome_sent_at) return json({ ok: true, skipped: 'already welcomed' })

    const name = String(record.full_name ?? '').trim() || String(record.email).split('@')[0]
    // The very first account is the instance owner and set up its own access;
    // an "await approval" note would be nonsense.
    const needsApproval = record.status === 'pending'

    await sendMail(
      record.email,
      needsApproval ? '[Board] We have your request' : '[Board] Welcome to the board',
      layout({
        title: needsApproval ? 'Request received' : 'Welcome aboard',
        intro: `Hello ${escapeHtml(name)} — thank you for signing up.`,
        body: needsApproval
          ? `<div style="font-size:14px;color:#334155;line-height:1.7">
               Your details are with an administrator now. Once they approve you, a second
               email will tell you which workspace you have joined and what you can do there.
             </div>
             <div style="font-size:13px;color:#94a3b8;line-height:1.7;margin-top:10px">
               Signing in before then will show a holding screen — nothing is wrong, the
               approval simply has not happened yet.
             </div>`
          : `<div style="font-size:14px;color:#334155;line-height:1.7">
               Your account is active and you can sign in straight away.
             </div>`,
        cta: needsApproval ? undefined : 'Open the board',
      }),
    )

    // Keep the administrator in the loop for every signup, including the ones
    // that come through a join code and never reach the approval queue.
    if (ADMIN_EMAIL) {
      const detail = [
        ['Name', record.full_name],
        ['Email', record.email],
        ['Organisation', record.organization],
        ['Role they play', record.role_title],
        ['Country', record.country],
        ['Status', record.status],
      ].filter(([, v]) => v)
        .map(([k, v]) => `
          <tr>
            <td style="padding:6px 0;font-size:12px;color:#94a3b8;width:130px">${escapeHtml(k)}</td>
            <td style="padding:6px 0;font-size:14px;color:#0f172a">${escapeHtml(v)}</td>
          </tr>`).join('')

      await sendMail(
        ADMIN_EMAIL,
        `[Board] New signup — ${name}`,
        layout({
          title: 'Someone signed up',
          intro: needsApproval
            ? `<strong>${escapeHtml(name)}</strong> created an account and is waiting for your approval.`
            : `<strong>${escapeHtml(name)}</strong> joined and is already active.`,
          body: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${detail}</table>`,
          cta: 'Open the board',
        }),
      )
    }

    // Stamped last: a send that failed above should be retried by the sweep.
    await fetch(`${rest}/profiles?id=eq.${record.id}`, {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({ welcome_sent_at: new Date().toISOString() }),
    }).catch(() => {})

    console.log(`notify-welcome: greeted ${record.email}`)
    return json({ ok: true, welcomed: record.email })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('notify-welcome failed:', message)
    return json({ ok: false, error: message }, 500)
  }
})
