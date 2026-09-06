/**
 * A tiny RFC 5545 (iCalendar) writer — no dependencies.
 *
 * Just enough of the spec to put a real, acceptable meeting invite in an email:
 * one VEVENT inside a VCALENDAR, METHOD:REQUEST so mail clients offer
 * Accept / Decline, and STATUS:CANCELLED (with METHOD:CANCEL) when a meeting
 * is called off.
 *
 *   import { buildIcs } from './lib/ics.mjs'
 *
 *   const ics = buildIcs({
 *     uid: 'meeting-123@project-board',
 *     title: 'Sprint review',
 *     startsAt: '2026-09-08T14:00:00Z',
 *     endsAt:   '2026-09-08T15:00:00Z',
 *     organizerEmail: 'board@example.com',
 *     attendeeEmails: ['ama@example.com'],
 *   })
 *
 * The three rules that actually bite in practice, and which this file gets
 * right: content lines fold at 75 octets (not characters), text values escape
 * backslash, semicolon, comma and newlines, and every timestamp is UTC in the
 * basic format YYYYMMDDTHHMMSSZ.
 */

const CRLF = '\r\n'
const PRODID = '-//Project Board//Email Alerts//EN'

const encoder = new TextEncoder()

/** Octet length of a string once encoded as UTF-8 — folding counts bytes. */
function octets(value) {
  return encoder.encode(value).length
}

/**
 * Escapes a TEXT value. Order matters: backslashes first, or the escapes we
 * add below would themselves get escaped.
 */
export function escapeIcsText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n')
}

/**
 * Folds one content line to 75 octets. Continuation lines start with a single
 * space, and that space counts toward the 75, so they carry 74 octets of
 * payload. We walk code points (not UTF-16 units) so a multi-byte character is
 * never split across a fold.
 */
export function foldLine(line) {
  const parts = []
  let current = ''
  let used = 0
  let budget = 75

  for (const ch of String(line)) {
    const size = octets(ch)
    if (used + size > budget) {
      parts.push(current)
      current = ''
      used = 0
      budget = 74 // the leading space of a continuation line eats one octet
    }
    current += ch
    used += size
  }
  parts.push(current)
  return parts.join(`${CRLF} `)
}

/** UTC timestamp in iCalendar basic format: 20260908T140000Z. */
export function icsStamp(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`buildIcs: not a usable date: ${String(value)}`)
  }
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

/** Addresses go into a CAL-ADDRESS, so strip anything that could break the line. */
function mailAddress(value) {
  return String(value ?? '').trim().replace(/[\s,;:<>"\\]/g, '')
}

/** A parameter value is quoted here, so the one thing it cannot hold is a quote. */
function paramValue(value) {
  return String(value ?? '').replace(/[\r\n"]/g, ' ').trim()
}

function nameFromEmail(email) {
  const local = String(email ?? '').split('@')[0] ?? ''
  return local.replace(/[._-]+/g, ' ').trim() || String(email ?? '')
}

/**
 * Builds a complete VCALENDAR string.
 *
 * @param {object}      options
 * @param {string}      options.uid             Stable per meeting — updates and
 *                                              cancellations must reuse it.
 * @param {string}      options.title           SUMMARY.
 * @param {string}     [options.description]    DESCRIPTION (newlines are fine).
 * @param {string}     [options.location]       LOCATION.
 * @param {string}     [options.url]            URL — the join link.
 * @param {string|Date} options.startsAt        DTSTART, converted to UTC.
 * @param {string|Date} options.endsAt          DTEND, converted to UTC.
 * @param {string}     [options.organizerEmail]
 * @param {string[]}   [options.attendeeEmails]
 * @param {number}     [options.sequence=0]     Bump on every revision.
 * @param {string}     [options.status]         CONFIRMED | TENTATIVE | CANCELLED.
 * @returns {string} CRLF-delimited iCalendar text.
 */
export function buildIcs({
  uid,
  title,
  description = '',
  location = '',
  url = '',
  startsAt,
  endsAt,
  organizerEmail = '',
  attendeeEmails = [],
  sequence = 0,
  status = 'CONFIRMED',
} = {}) {
  if (!uid) throw new TypeError('buildIcs: uid is required')
  if (!startsAt) throw new TypeError('buildIcs: startsAt is required')

  const state = String(status).toUpperCase()
  const cancelled = state === 'CANCELLED'

  // A cancellation is METHOD:CANCEL — the same event, withdrawn. Everything
  // else is a REQUEST, which is what makes clients render RSVP buttons.
  const method = cancelled ? 'CANCEL' : 'REQUEST'

  const start = icsStamp(startsAt)
  const end = icsStamp(endsAt ?? new Date(new Date(startsAt).getTime() + 3_600_000))

  const seq = Number.isFinite(Number(sequence)) ? Math.max(0, Math.trunc(Number(sequence))) : 0

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${escapeIcsText(PRODID)}`,
    'CALSCALE:GREGORIAN',
    `METHOD:${method}`,
    'BEGIN:VEVENT',
    `UID:${escapeIcsText(uid)}`,
    `DTSTAMP:${icsStamp(new Date())}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SEQUENCE:${seq}`,
    `STATUS:${cancelled ? 'CANCELLED' : state || 'CONFIRMED'}`,
    `SUMMARY:${escapeIcsText(title || 'Meeting')}`,
  ]

  if (description) lines.push(`DESCRIPTION:${escapeIcsText(description)}`)
  if (location) lines.push(`LOCATION:${escapeIcsText(location)}`)
  if (url) lines.push(`URL:${escapeIcsText(url)}`)

  const organizer = mailAddress(organizerEmail)
  if (organizer) {
    lines.push(`ORGANIZER;CN="${paramValue(nameFromEmail(organizerEmail))}":mailto:${organizer}`)
  }

  const seen = new Set()
  for (const raw of attendeeEmails ?? []) {
    const address = mailAddress(raw)
    if (!address || seen.has(address.toLowerCase())) continue
    seen.add(address.toLowerCase())
    lines.push(
      `ATTENDEE;CN="${paramValue(nameFromEmail(raw))}";ROLE=REQ-PARTICIPANT` +
      `;PARTSTAT=NEEDS-ACTION;RSVP=${cancelled ? 'FALSE' : 'TRUE'}:mailto:${address}`,
    )
  }

  lines.push('END:VEVENT', 'END:VCALENDAR')

  return lines.map(foldLine).join(CRLF) + CRLF
}

export default buildIcs
