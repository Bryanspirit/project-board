// ============================================================================
// notify-admin — mails the super admin the instant someone requests access.
//
// Wired to a Supabase database webhook on INSERT into public.access_requests,
// so the admin hears about a new applicant in seconds rather than waiting for
// the next scheduled sweep.
//
// This function deliberately writes nothing back to the database. The `access`
// mode of scripts/send-alerts.mjs is the safety net: it re-sends anything still
// carrying admin_notified_at IS NULL and stamps it. If both fire, the admin
// gets a duplicate — which is the right failure mode for an approval queue.
//
// Deploy:
//   supabase functions deploy notify-admin --no-verify-jwt
//   supabase secrets set SMTP_HOST=... SMTP_PORT=465 SMTP_USER=... \
//                        SMTP_PASS=... MAIL_FROM=... APP_URL=... \
//                        ADMIN_EMAIL=... WEBHOOK_SECRET=...
//
// Then add the webhook (Database -> Webhooks) pointing at this function with a
// header `x-webhook-secret: <the same WEBHOOK_SECRET>`.
// ============================================================================

import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const env = (key: string, fallback = ""): string => Deno.env.get(key) ?? fallback;

const SMTP_HOST = env("SMTP_HOST", "smtp.gmail.com");
const SMTP_PORT = Number(env("SMTP_PORT", "465"));
const SMTP_USER = env("SMTP_USER");
const SMTP_PASS = env("SMTP_PASS");
const MAIL_FROM = env("MAIL_FROM") || SMTP_USER;
const APP_URL = env("APP_URL");
const ADMIN_EMAIL = env("ADMIN_EMAIL");
const WEBHOOK_SECRET = env("WEBHOOK_SECRET");

const JSON_HEADERS = { "content-type": "application/json" };

interface WebhookPayload {
  type?: string;
  table?: string;
  schema?: string;
  record?: Record<string, unknown> | null;
  old_record?: Record<string, unknown> | null;
}

// ------------------------------------------------------------------ utils --

/** Applicant text is hostile until escaped. Every interpolation goes through this. */
function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!),
  );
}

/** Length-independent-ish comparison so the secret cannot be probed byte by byte. */
function secretMatches(supplied: string | null): boolean {
  if (!WEBHOOK_SECRET) return false;
  const a = new TextEncoder().encode(supplied ?? "");
  const b = new TextEncoder().encode(WEBHOOK_SECRET);
  let diff = a.length ^ b.length;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/** A URL is only safe in an href when we know its scheme. */
function safeUrl(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  return /^https?:\/\//i.test(raw) ? raw : null;
}

function prettyLabel(key: string): string {
  return key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

// -------------------------------------------------------------- templating --

// Ordered first because an admin reads top-down; anything the schema gains
// later still shows up, just below these, via the catch-all in fieldRows().
const KNOWN_FIELDS: [string, string][] = [
  ["full_name", "Name"],
  ["email", "Email"],
  ["gender", "Gender"],
  ["phone", "Phone"],
  ["organization", "Organization"],
  ["role_title", "Role"],
  ["country", "Country"],
  ["github_url", "GitHub"],
  ["linkedin_url", "LinkedIn"],
  ["motivation", "Why they want in"],
  ["requested_workspace_id", "Requested workspace"],
  ["status", "Status"],
  ["created_at", "Submitted"],
  ["user_id", "Account id"],
];

const HIDDEN_FIELDS = new Set([
  "id",
  "reviewed_by",
  "reviewed_at",
  "decision_note",
  "admin_notified_at",
  "user_notified_at",
]);

function fieldRows(record: Record<string, unknown>): string {
  const seen = new Set<string>();
  const pairs: [string, unknown][] = [];

  for (const [key, label] of KNOWN_FIELDS) {
    seen.add(key);
    if (record[key] !== undefined && record[key] !== null && record[key] !== "") {
      pairs.push([label, record[key]]);
    }
  }
  // Anything the migration adds later still reaches the admin's inbox.
  for (const [key, value] of Object.entries(record)) {
    if (seen.has(key) || HIDDEN_FIELDS.has(key)) continue;
    if (value === null || value === undefined || value === "") continue;
    pairs.push([prettyLabel(key), value]);
  }

  return pairs
    .map(([label, value]) => {
      const text = typeof value === "object" ? JSON.stringify(value) : String(value);
      const link = safeUrl(text);
      const cell = link
        ? `<a href="${escapeHtml(link)}" style="color:#4f46e5;word-break:break-all">${escapeHtml(text)}</a>`
        : escapeHtml(text).replace(/\n/g, "<br>");
      return `
      <tr>
        <td style="padding:8px 12px 8px 0;vertical-align:top;width:150px;
                   font-size:12px;color:#94a3b8;white-space:nowrap">${escapeHtml(label)}</td>
        <td style="padding:8px 0;vertical-align:top;font-size:14px;color:#0f172a;
                   border-bottom:1px solid #f1f5f9">${cell}</td>
      </tr>`;
    })
    .join("");
}

/** Same table-based shell the scheduled alerts use, so the two look like one app. */
function layout({ title, intro, body }: { title: string; intro: string; body: string }): string {
  const adminLink = APP_URL ? `${APP_URL.replace(/\/+$/, "")}#admin` : "";
  const cta = adminLink
    ? `<tr><td style="padding:8px 28px 32px">
         <a href="${escapeHtml(adminLink)}"
            style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;
                   font-size:14px;font-weight:600;padding:11px 20px;border-radius:8px">
           Review in the approval queue
         </a>
       </td></tr>`
    : "";

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
      Sent the moment the request landed, by the notify-admin edge function.
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

// --------------------------------------------------------------------- mail --

async function sendMail(to: string, subject: string, html: string): Promise<void> {
  const client = new SMTPClient({
    connection: {
      hostname: SMTP_HOST,
      port: SMTP_PORT,
      // 465 is implicit TLS; 587 negotiates STARTTLS from a plain socket.
      tls: SMTP_PORT === 465,
      auth: { username: SMTP_USER, password: SMTP_PASS },
    },
  });

  try {
    await client.send({ from: MAIL_FROM, to, subject, html, content: "auto" });
  } finally {
    // Always hand the socket back, even when the send threw. close() is typed
    // as returning a promise but resolves to undefined in some denomailer
    // builds, so awaiting it directly is the only safe form — calling .catch()
    // on the result throws and masks the real error.
    try {
      await client.close();
    } catch {
      // A failed teardown must never turn a delivered email into a 500.
    }
  }
}

// ------------------------------------------------------------------ handler --

/**
 * Records that the admin has been told, so the 15-minute `access` sweep in
 * scripts/send-alerts.mjs does not mail the same request a second time.
 *
 * Called only after the send succeeds. If this stamp fails the sweep still
 * picks the request up, which is the right way round: a duplicate notice is a
 * far smaller problem than a signup nobody hears about.
 */
async function markNotified(id: string): Promise<void> {
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    console.warn("notify-admin: no service role key, leaving the sweep to stamp this one");
    return;
  }
  const res = await fetch(
    `${url.replace(/\/+$/, "")}/rest/v1/access_requests?id=eq.${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ admin_notified_at: new Date().toISOString() }),
    },
  );
  if (!res.ok) {
    console.warn(`notify-admin: could not stamp ${id} (${res.status}); the sweep will resend`);
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  try {
    if (req.method !== "POST") {
      return json({ ok: false, error: "method not allowed" }, 405);
    }

    if (!secretMatches(req.headers.get("x-webhook-secret"))) {
      console.warn("notify-admin: rejected a request with a bad or missing x-webhook-secret");
      return json({ ok: false, error: "unauthorized" }, 401);
    }

    let payload: WebhookPayload;
    try {
      payload = (await req.json()) as WebhookPayload;
    } catch {
      return json({ ok: false, error: "invalid json" }, 400);
    }

    const { type, table, record } = payload ?? {};

    if (table && table !== "access_requests") {
      console.log(`notify-admin: ignoring ${type ?? "?"} on ${table}`);
      return json({ ok: true, skipped: "wrong table" });
    }
    if (type && type !== "INSERT") {
      console.log(`notify-admin: ignoring ${type} — only INSERT is interesting here`);
      return json({ ok: true, skipped: "not an insert" });
    }
    if (!record || typeof record !== "object") {
      return json({ ok: false, error: "no record in payload" }, 400);
    }

    if (!ADMIN_EMAIL) {
      // Not an error the webhook can fix by retrying — the sweep will cover it.
      console.error("notify-admin: ADMIN_EMAIL is not set; nothing sent");
      return json({ ok: false, error: "ADMIN_EMAIL not configured" }, 500);
    }
    if (!SMTP_USER || !SMTP_PASS) {
      console.error("notify-admin: SMTP credentials missing; nothing sent");
      return json({ ok: false, error: "SMTP not configured" }, 500);
    }

    const name = String(record.full_name ?? record.email ?? "Someone");
    const org = record.organization ? ` from ${String(record.organization)}` : "";

    const html = layout({
      title: "New access request",
      intro:
        `<strong>${escapeHtml(name)}</strong>${escapeHtml(org)} just asked to join the board. ` +
        `Here is everything they submitted.`,
      body: `
      <div style="margin:18px 0 6px;font-size:12px;font-weight:700;letter-spacing:.05em;
                  text-transform:uppercase;color:#4f46e5">The application</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${fieldRows(
        record as Record<string, unknown>,
      )}</table>`,
    });

    await sendMail(
      ADMIN_EMAIL,
      `[Board] Access request — ${name}`,
      html,
    );

    if (typeof record.id === "string") await markNotified(record.id);

    console.log(`notify-admin: mailed ${ADMIN_EMAIL} about ${String(record.email ?? "unknown")}`);
    return json({ ok: true, notified: ADMIN_EMAIL });
  } catch (err) {
    // Nothing escapes: an unhandled rejection here would take the isolate down
    // and the webhook would see an opaque failure instead of a logged one.
    const message = err instanceof Error ? err.message : String(err);
    console.error("notify-admin failed:", message);
    return json({ ok: false, error: message }, 500);
  }
});
