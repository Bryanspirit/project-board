import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Spinner, cx } from '../ui'
import { diffDays, milestoneDay } from '../../hooks/useAnalytics'
import { todayISO } from '../../lib/dates'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import type { BurndownPoint } from '../../hooks/useAnalytics'
import type { Milestone } from '../../lib/types'

/* Hand-rolled SVG: no chart library, no date library. The palette is the
 * validated data-viz set — categorical slot 1 for the one data series, ink for
 * the ideal reference, fixed status red for the deadline flag. The two lines
 * are told apart by dash pattern and direct labels, never by colour alone. */

const VW = 760
const VH = 300
// A wide left pad keeps three-digit tick labels clear of the rotated axis title.
const PAD = { l: 56, r: 92, t: 26, b: 44 }
const PLOT_W = VW - PAD.l - PAD.r
const PLOT_H = VH - PAD.t - PAD.b

export interface BurndownChartProps {
  points: BurndownPoint[]
  /** The deadline to burn down to. Its `due_at` instant is resolved to the
   *  viewer's own calendar day by `milestoneDay`. */
  milestone?: Milestone | null
  /** Today, as 'YYYY-MM-DD'. The actual line stops here; the ideal runs on. */
  today?: string
  loading?: boolean
  className?: string
}

/** True while the viewer has asked the OS for less motion. */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReduced(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return reduced
}

/** A round axis maximum and a round step, so ticks read 0 / 10 / 20 / 30. */
function niceScale(max: number, targetTicks = 4): { max: number; step: number } {
  if (max <= 0) return { max: 1, step: 1 }
  const raw = max / targetTicks
  const mag = 10 ** Math.floor(Math.log10(raw))
  const norm = raw / mag
  const rounded = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10
  const step = Math.max(1, Math.round(rounded * mag))
  return { max: Math.max(step, Math.ceil(max / step) * step), step }
}

/** 'Sep 3' from a plain calendar day, formatted in UTC so the day never slips. */
function shortDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', timeZone: 'UTC',
  })
}

function longDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
  })
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n)
}

export default function BurndownChart({
  points, milestone, today = todayISO(), loading = false, className,
}: BurndownChartProps) {
  const titleId = useId()
  const [active, setActive] = useState<number | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const reduced = usePrefersReducedMotion()

  const geom = useMemo(() => {
    const n = points.length
    if (n === 0) return null
    const peak = points.reduce((m, p) => Math.max(m, p.remaining, p.ideal), 0)
    const scale = niceScale(peak)
    const x = (i: number) => PAD.l + (n <= 1 ? PLOT_W / 2 : (i / (n - 1)) * PLOT_W)
    const y = (v: number) => PAD.t + PLOT_H - (v / scale.max) * PLOT_H

    // The actual line is only honest up to today; beyond it nothing has been
    // completed yet, so a flat run to the deadline would read as "stalled".
    const first = points[0].date
    const lastDate = points[n - 1].date
    const cut = today < first ? 0 : today > lastDate ? n - 1 : diffDays(first, today)
    const todayIndex = Math.min(n - 1, Math.max(0, cut))

    const ticks: number[] = []
    for (let v = 0; v <= scale.max + 0.0001; v += scale.step) ticks.push(Math.round(v))

    const every = Math.max(1, Math.ceil(n / 7))
    const xTicks: number[] = []
    for (let i = 0; i < n; i += every) xTicks.push(i)
    if (xTicks[xTicks.length - 1] !== n - 1) {
      // Drop the penultimate tick if the last one would crowd it.
      if (n - 1 - xTicks[xTicks.length - 1] < every / 2) xTicks.pop()
      xTicks.push(n - 1)
    }

    const deadline = milestone ? milestoneDay(milestone.due_at) : null
    const deadlineIndex = deadline && deadline >= first && deadline <= lastDate
      ? diffDays(first, deadline)
      : null

    return { n, scale, x, y, todayIndex, ticks, xTicks, deadline, deadlineIndex, first, lastDate }
  }, [points, milestone, today])

  // Roving tabindex: the series is one tab stop and the arrow keys walk it, so
  // a 60-day window does not put 60 stops in the page's tab order.
  const onKeyDown = (e: ReactKeyboardEvent<SVGGElement>) => {
    if (!geom) return
    const at = active ?? 0
    let next: number | null = null
    if (e.key === 'ArrowRight') next = Math.min(geom.n - 1, at + 1)
    else if (e.key === 'ArrowLeft') next = Math.max(0, at - 1)
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = geom.n - 1
    else if (e.key === 'Escape') { setActive(null); return }
    if (next === null) return
    e.preventDefault()
    setActive(next)
    wrapRef.current?.querySelector<SVGRectElement>(`[data-pt="${next}"]`)?.focus()
  }

  const onPointerMove = (e: ReactPointerEvent<SVGRectElement>) => {
    if (!geom) return
    const box = e.currentTarget.getBoundingClientRect()
    if (box.width === 0) return
    const local = ((e.clientX - box.left) / box.width) * PLOT_W
    const i = geom.n <= 1 ? 0 : Math.round((local / PLOT_W) * (geom.n - 1))
    setActive(Math.min(geom.n - 1, Math.max(0, i)))
  }

  if (loading) {
    return (
      <div className={cx('flex h-64 items-center justify-center gap-2 text-sm text-slate-500 dark:text-slate-400', className)}>
        <Spinner className="h-4 w-4" />
        Loading burndown&hellip;
      </div>
    )
  }

  if (!geom || points.length < 2) {
    return (
      <div className={cx(
        'flex h-64 flex-col items-center justify-center gap-1 rounded-xl border border-dashed px-6 text-center',
        'border-slate-300 dark:border-slate-700', className,
      )}>
        <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Not enough history yet</p>
        <p className="max-w-sm text-xs text-slate-500 dark:text-slate-400">
          A burndown needs at least two days of task activity. Create and complete a few
          tasks and the line will start drawing itself.
        </p>
      </div>
    )
  }

  const { n, x, y, todayIndex, ticks, xTicks, deadline, deadlineIndex } = geom
  const actual = points.slice(0, todayIndex + 1)
  const actualPath = actual.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(p.remaining)}`).join(' ')
  const idealPath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(p.ideal)}`).join(' ')

  const point = active === null ? null : points[active]
  const activeOnActual = active !== null && active <= todayIndex

  // Direct labels sit in the right gutter; nudge them apart when the two lines
  // finish at nearly the same height rather than letting the text overlap.
  const endRemaining = points[todayIndex].remaining
  const endIdeal = points[n - 1].ideal
  let labelActualY = y(endRemaining)
  let labelIdealY = y(endIdeal) - 10
  if (Math.abs(labelActualY - labelIdealY) < 14) labelActualY = labelIdealY - 14

  const tipLeft = (x(active ?? 0) / VW) * 100
  const tipSide = tipLeft > 62 ? 'right' : tipLeft < 16 ? 'left' : 'center'

  return (
    <div
      ref={wrapRef}
      className={cx(
        'relative',
        '[--viz-line:#2a78d6] dark:[--viz-line:#3987e5]',
        '[--viz-ideal:#475569] dark:[--viz-ideal:#cbd5e1]',
        '[--viz-grid:#e2e8f0] dark:[--viz-grid:#1e293b]',
        '[--viz-axis:#cbd5e1] dark:[--viz-axis:#334155]',
        '[--viz-muted:#64748b] dark:[--viz-muted:#94a3b8]',
        '[--viz-surface:#ffffff] dark:[--viz-surface:#0f172a]',
        '[--viz-flag:#d03b3b]',
        className,
      )}
    >
      {/* Legend — two series, so identity never rests on colour alone. */}
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
        <span className="inline-flex items-center gap-1.5">
          <svg width="18" height="8" aria-hidden viewBox="0 0 18 8">
            <path d="M1,4 H17" stroke="var(--viz-line)" strokeWidth="2" strokeLinecap="round" />
          </svg>
          Remaining
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="18" height="8" aria-hidden viewBox="0 0 18 8">
            <path d="M1,4 H17" stroke="var(--viz-ideal)" strokeWidth="2" strokeDasharray="5 4" strokeLinecap="round" />
          </svg>
          Ideal
        </span>
        {deadline && (
          <span className="inline-flex items-center gap-1.5">
            <svg width="8" height="10" aria-hidden viewBox="0 0 8 10">
              <path d="M4,0 V10" stroke="var(--viz-flag)" strokeWidth="2" />
            </svg>
            Deadline {shortDay(deadline)}
          </span>
        )}
      </div>

      <div className="relative">
      <svg
        viewBox={`0 0 ${VW} ${VH}`}
        className="w-full"
        style={{ height: 'auto' }}
        role="group"
        aria-labelledby={titleId}
        preserveAspectRatio="xMidYMid meet"
      >
        <title id={titleId}>
          {`Burndown from ${longDay(points[0].date)} to ${longDay(points[n - 1].date)}: `
            + `${points[0].remaining} tasks of scope, ${endRemaining} still open today`
            + (deadline ? `, deadline ${longDay(deadline)}` : '') + '.'}
        </title>

        {/* Grid and y-axis ticks — solid hairlines, one step off the surface. */}
        {ticks.map(v => (
          <g key={`y${v}`}>
            <line x1={PAD.l} x2={PAD.l + PLOT_W} y1={y(v)} y2={y(v)}
              stroke="var(--viz-grid)" strokeWidth="1" />
            <text x={PAD.l - 8} y={y(v) + 4} textAnchor="end"
              fill="var(--viz-muted)" fontSize="11" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {v}
            </text>
          </g>
        ))}
        <text
          x={12} y={PAD.t + PLOT_H / 2} fill="var(--viz-muted)" fontSize="11"
          textAnchor="middle" transform={`rotate(-90 12 ${PAD.t + PLOT_H / 2})`}
        >
          Tasks open
        </text>

        <line x1={PAD.l} x2={PAD.l + PLOT_W} y1={y(0)} y2={y(0)} stroke="var(--viz-axis)" strokeWidth="1" />

        {xTicks.map(i => (
          <text key={`x${i}`} x={x(i)} y={VH - 22} textAnchor="middle"
            fill="var(--viz-muted)" fontSize="11">
            {shortDay(points[i].date)}
          </text>
        ))}

        {/* Deadline flag: a labelled annotation rule, not a gridline. */}
        {deadlineIndex !== null && deadline && (
          <g>
            <line x1={x(deadlineIndex)} x2={x(deadlineIndex)} y1={PAD.t - 6} y2={y(0)}
              stroke="var(--viz-flag)" strokeWidth="1.5" />
            <text
              x={deadlineIndex > (n - 1) * 0.7 ? x(deadlineIndex) - 5 : x(deadlineIndex) + 5}
              y={PAD.t - 10}
              textAnchor={deadlineIndex > (n - 1) * 0.7 ? 'end' : 'start'}
              fill="var(--viz-muted)" fontSize="11" fontWeight="600"
            >
              {milestone?.name ? `${milestone.name} · deadline` : 'Deadline'}
            </text>
          </g>
        )}

        {/* Ideal first, so the actual line reads on top of it. */}
        <path d={idealPath} fill="none" stroke="var(--viz-ideal)" strokeWidth="2"
          strokeDasharray="6 5" strokeLinecap="round" strokeLinejoin="round" opacity="0.85" />

        <path
          d={actualPath} fill="none" stroke="var(--viz-line)" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round"
          pathLength={reduced ? undefined : 1}
          strokeDasharray={reduced ? undefined : 1}
          strokeDashoffset={reduced ? undefined : 1}
        >
          {/* Draw-on only when motion is welcome. */}
          {!reduced && (
            <animate attributeName="stroke-dashoffset" from="1" to="0" dur="0.6s" fill="freeze" />
          )}
        </path>

        {/* End marker with the 2px surface ring, so it survives the crossing. */}
        <circle cx={x(todayIndex)} cy={y(endRemaining)} r="4.5"
          fill="var(--viz-line)" stroke="var(--viz-surface)" strokeWidth="2" />

        {/* Direct labels — text in ink, identity from the mark it sits beside. */}
        <text x={x(todayIndex) + 9} y={labelActualY + 4} fill="var(--viz-muted)" fontSize="11" fontWeight="600">
          Remaining
        </text>
        <text x={x(n - 1) + 9} y={labelIdealY + 4} fill="var(--viz-muted)" fontSize="11">
          Ideal
        </text>

        {/* Crosshair. */}
        {active !== null && point && (
          <g pointerEvents="none">
            <line x1={x(active)} x2={x(active)} y1={PAD.t} y2={y(0)}
              stroke="var(--viz-axis)" strokeWidth="1" />
            <circle cx={x(active)} cy={y(point.ideal)} r="4"
              fill="var(--viz-ideal)" stroke="var(--viz-surface)" strokeWidth="2" />
            {activeOnActual && (
              <circle cx={x(active)} cy={y(point.remaining)} r="4.5"
                fill="var(--viz-line)" stroke="var(--viz-surface)" strokeWidth="2" />
            )}
          </g>
        )}

        {/* Nearest-point layer: the reader aims at a date, not at a 2px line. */}
        <rect
          x={PAD.l} y={PAD.t} width={PLOT_W} height={PLOT_H} fill="transparent"
          onPointerMove={onPointerMove}
          onPointerLeave={() => setActive(null)}
        />

        {/* Keyboard twin of the hover layer. */}
        <g onKeyDown={onKeyDown} role="group" aria-label="Burndown data points">
          {points.map((p, i) => (
            <rect
              key={p.date}
              data-pt={i}
              x={x(i) - (n <= 1 ? PLOT_W / 2 : PLOT_W / (n - 1) / 2)}
              y={PAD.t}
              width={n <= 1 ? PLOT_W : PLOT_W / (n - 1)}
              height={PLOT_H}
              fill="transparent"
              tabIndex={i === (active ?? 0) ? 0 : -1}
              role="img"
              aria-label={`${longDay(p.date)}: ${p.remaining} open, ideal ${Math.round(p.ideal)}, `
                + `${signed(p.remaining - Math.round(p.ideal))} against plan`}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(a => (a === i ? null : a))}
            />
          ))}
        </g>
      </svg>

      {/* Tooltip. Values lead, labels follow. Hidden from AT: the focused
          point already carries the same numbers in its aria-label. */}
      {active !== null && point && (
        <div
          aria-hidden
          className={cx(
            'pointer-events-none absolute z-10 min-w-40 rounded-lg px-3 py-2 text-xs shadow-lg ring-1',
            'bg-white text-slate-900 ring-slate-200 dark:bg-slate-800 dark:text-slate-50 dark:ring-slate-700',
          )}
          style={{
            left: `${tipLeft}%`,
            top: '4px',
            transform: tipSide === 'right'
              ? 'translateX(calc(-100% - 10px))'
              : tipSide === 'left' ? 'translateX(10px)' : 'translateX(-50%)',
          }}
        >
          <p className="mb-1 font-medium text-slate-500 dark:text-slate-400">{longDay(point.date)}</p>
          <p className="flex items-center gap-1.5">
            <svg width="12" height="6" aria-hidden viewBox="0 0 12 6">
              <path d="M1,3 H11" stroke="var(--viz-line)" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <strong className="tabular-nums">{point.remaining}</strong>
            <span className="text-slate-500 dark:text-slate-400">remaining</span>
          </p>
          <p className="flex items-center gap-1.5">
            <svg width="12" height="6" aria-hidden viewBox="0 0 12 6">
              <path d="M1,3 H11" stroke="var(--viz-ideal)" strokeWidth="2" strokeDasharray="3 3" strokeLinecap="round" />
            </svg>
            <strong className="tabular-nums">{Math.round(point.ideal)}</strong>
            <span className="text-slate-500 dark:text-slate-400">ideal</span>
          </p>
          <p className="mt-1 border-t border-slate-200 pt-1 text-slate-600 tabular-nums dark:border-slate-700 dark:text-slate-300">
            {signed(point.remaining - Math.round(point.ideal))} against plan
          </p>
        </div>
      )}
      </div>

      {/* The numbers, ungated by hover. */}
      <div className="sr-only">
        <table>
          <caption>Burndown: tasks open per day against the ideal line</caption>
          <thead>
            <tr><th scope="col">Date</th><th scope="col">Remaining</th><th scope="col">Ideal</th></tr>
          </thead>
          <tbody>
            {points.map(p => (
              <tr key={p.date}>
                <th scope="row">{longDay(p.date)}</th>
                <td>{p.remaining}</td>
                <td>{Math.round(p.ideal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
