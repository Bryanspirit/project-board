import { useId, useMemo, useState } from 'react'
import { Spinner, cx } from '../ui'
import { addDays } from '../../hooks/useAnalytics'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { VelocityWeek } from '../../hooks/useAnalytics'

/* Grouped columns, hand-rolled. Categorical slots 1 (created) and 2 (completed)
 * from the validated palette — that adjacent pair clears the CVD and
 * normal-vision floors in both modes. Identity is still carried by the legend,
 * the direct labels in the right gutter, and the table twin below. */

const VW = 760
const VH = 290
// A wide left pad keeps three-digit tick labels clear of the rotated axis title.
const PAD = { l: 56, r: 96, t: 24, b: 48 }
const PLOT_W = VW - PAD.l - PAD.r
const PLOT_H = VH - PAD.t - PAD.b
/** Cap the mark; the leftover band width is deliberate air. */
const MAX_BAR = 24
/** The surface gap that separates the two touching bars in a group. */
const GAP = 2

export interface VelocityChartProps {
  weeks: VelocityWeek[]
  loading?: boolean
  className?: string
}

function niceScale(max: number, targetTicks = 4): { max: number; step: number } {
  if (max <= 0) return { max: 1, step: 1 }
  const raw = max / targetTicks
  const mag = 10 ** Math.floor(Math.log10(raw))
  const norm = raw / mag
  const rounded = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10
  const step = Math.max(1, Math.round(rounded * mag))
  return { max: Math.max(step, Math.ceil(max / step) * step), step }
}

/** 'Sep 1' — formatted in UTC so a plain calendar day never slips a day. */
function shortDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', timeZone: 'UTC',
  })
}

function weekLabel(weekStart: string): string {
  return `${shortDay(weekStart)} – ${shortDay(addDays(weekStart, 6))}`
}

/** A column with a 4px rounded cap and a square foot on the baseline. */
function columnPath(x: number, y: number, w: number, h: number): string {
  if (h <= 0) return ''
  const r = Math.min(4, w / 2, h)
  return `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} `
    + `L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z`
}

export default function VelocityChart({ weeks, loading = false, className }: VelocityChartProps) {
  const titleId = useId()
  const [active, setActive] = useState<number | null>(null)

  const geom = useMemo(() => {
    const n = weeks.length
    if (n === 0) return null
    const peak = weeks.reduce((m, w) => Math.max(m, w.created, w.completed), 0)
    const scale = niceScale(peak)
    const band = PLOT_W / n
    const barW = Math.min(MAX_BAR, Math.max(4, (band - GAP) / 2 - 6))
    const groupW = barW * 2 + GAP
    const groupX = (i: number) => PAD.l + i * band + (band - groupW) / 2
    const y = (v: number) => PAD.t + PLOT_H - (v / scale.max) * PLOT_H

    const ticks: number[] = []
    for (let v = 0; v <= scale.max + 0.0001; v += scale.step) ticks.push(Math.round(v))

    const meanCompleted = weeks.reduce((s, w) => s + w.completed, 0) / n
    // A dense axis of week labels wraps into mush; thin it instead.
    const labelEvery = band < 56 ? 2 : 1

    return { n, scale, band, barW, groupW, groupX, y, ticks, meanCompleted, labelEvery }
  }, [weeks])

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
    e.currentTarget.querySelector<SVGRectElement>(`[data-week="${next}"]`)?.focus()
  }

  if (loading) {
    return (
      <div className={cx('flex h-64 items-center justify-center gap-2 text-sm text-slate-500 dark:text-slate-400', className)}>
        <Spinner className="h-4 w-4" />
        Loading velocity&hellip;
      </div>
    )
  }

  if (!geom || weeks.every(w => w.created === 0 && w.completed === 0)) {
    return (
      <div className={cx(
        'flex h-64 flex-col items-center justify-center gap-1 rounded-xl border border-dashed px-6 text-center',
        'border-slate-300 dark:border-slate-700', className,
      )}>
        <p className="text-sm font-medium text-slate-700 dark:text-slate-200">No velocity yet</p>
        <p className="max-w-sm text-xs text-slate-500 dark:text-slate-400">
          Nothing was created or completed in this window.
        </p>
      </div>
    )
  }

  const { n, band, barW, groupW, groupX, y, ticks, meanCompleted, labelEvery } = geom
  const last = weeks[n - 1]
  const lastX = groupX(n - 1)

  // Direct labels in the right gutter, pinned to the final group's two caps and
  // nudged apart when the week's two counts land at nearly the same height.
  let createdLabelY = y(last.created)
  let completedLabelY = y(last.completed)
  if (Math.abs(createdLabelY - completedLabelY) < 14) {
    if (createdLabelY <= completedLabelY) createdLabelY = completedLabelY - 14
    else completedLabelY = createdLabelY - 14
  }

  const week = active === null ? null : weeks[active]
  const tipLeft = ((groupX(active ?? 0) + groupW / 2) / VW) * 100
  const tipSide = tipLeft > 62 ? 'right' : tipLeft < 16 ? 'left' : 'center'

  return (
    <div
      className={cx(
        'relative',
        '[--viz-created:#2a78d6] dark:[--viz-created:#3987e5]',
        '[--viz-completed:#eb6834] dark:[--viz-completed:#d95926]',
        '[--viz-grid:#e2e8f0] dark:[--viz-grid:#1e293b]',
        '[--viz-axis:#cbd5e1] dark:[--viz-axis:#334155]',
        '[--viz-muted:#64748b] dark:[--viz-muted:#94a3b8]',
        '[--viz-surface:#ffffff] dark:[--viz-surface:#0f172a]',
        '[--viz-mean:#475569] dark:[--viz-mean:#cbd5e1]',
        className,
      )}
    >
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: 'var(--viz-created)' }} aria-hidden />
          Created
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: 'var(--viz-completed)' }} aria-hidden />
          Completed
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="18" height="8" aria-hidden viewBox="0 0 18 8">
            <path d="M1,4 H17" stroke="var(--viz-mean)" strokeWidth="2" strokeDasharray="5 4" strokeLinecap="round" />
          </svg>
          Mean completed
        </span>
      </div>

      <div className="relative">
      <svg
        viewBox={`0 0 ${VW} ${VH}`}
        className="w-full"
        role="group"
        aria-labelledby={titleId}
        preserveAspectRatio="xMidYMid meet"
      >
        <title id={titleId}>
          {`Weekly velocity over ${n} week${n === 1 ? '' : 's'}: `
            + `${weeks.reduce((s, w) => s + w.created, 0)} created, `
            + `${weeks.reduce((s, w) => s + w.completed, 0)} completed, `
            + `mean ${meanCompleted.toFixed(1)} completed per week.`}
        </title>

        {ticks.map(v => (
          <g key={`y${v}`}>
            <line x1={PAD.l} x2={PAD.l + PLOT_W} y1={y(v)} y2={y(v)} stroke="var(--viz-grid)" strokeWidth="1" />
            <text x={PAD.l - 8} y={y(v) + 4} textAnchor="end" fill="var(--viz-muted)" fontSize="11"
              style={{ fontVariantNumeric: 'tabular-nums' }}>
              {v}
            </text>
          </g>
        ))}
        <text x={12} y={PAD.t + PLOT_H / 2} fill="var(--viz-muted)" fontSize="11"
          textAnchor="middle" transform={`rotate(-90 12 ${PAD.t + PLOT_H / 2})`}>
          Tasks
        </text>

        <line x1={PAD.l} x2={PAD.l + PLOT_W} y1={y(0)} y2={y(0)} stroke="var(--viz-axis)" strokeWidth="1" />

        {/* Bars. The 2px gap between the pair is surface, not a stroke. */}
        {weeks.map((w, i) => {
          const gx = groupX(i)
          const createdH = PAD.t + PLOT_H - y(w.created)
          const completedH = PAD.t + PLOT_H - y(w.completed)
          const lifted = active === i
          return (
            <g key={w.weekStart} opacity={active === null || lifted ? 1 : 0.55}>
              <path d={columnPath(gx, y(w.created), barW, createdH)} fill="var(--viz-created)" />
              <path d={columnPath(gx + barW + GAP, y(w.completed), barW, completedH)} fill="var(--viz-completed)" />
            </g>
          )
        })}

        {/* Mean-completed reference line — a threshold, hence the dash. */}
        <line
          x1={PAD.l} x2={PAD.l + PLOT_W} y1={y(meanCompleted)} y2={y(meanCompleted)}
          stroke="var(--viz-mean)" strokeWidth="2" strokeDasharray="6 5" strokeLinecap="round"
        />
        {/* The reference line labels itself at its left end, inside the plot —
            the right gutter belongs to the two series labels. A surface halo
            keeps it legible where it passes over a column. */}
        <text
          x={PAD.l + 4}
          y={Math.max(PAD.t + 10, y(meanCompleted) - 6)}
          fill="var(--viz-muted)" fontSize="11"
          stroke="var(--viz-surface)" strokeWidth="3" paintOrder="stroke" strokeLinejoin="round"
        >
          {`mean ${meanCompleted.toFixed(1)} completed`}
        </text>

        {/* Direct labels on the most recent group. */}
        <text x={lastX + groupW + 8} y={createdLabelY + 4} fill="var(--viz-muted)" fontSize="11">
          Created
        </text>
        <text x={lastX + groupW + 8} y={completedLabelY + 4} fill="var(--viz-muted)" fontSize="11" fontWeight="600">
          Completed
        </text>

        {/* X axis: week starts. */}
        {weeks.map((w, i) => (
          i % labelEvery === 0 || i === n - 1 ? (
            <text key={`x${w.weekStart}`} x={groupX(i) + groupW / 2} y={VH - 26} textAnchor="middle"
              fill="var(--viz-muted)" fontSize="11">
              {shortDay(w.weekStart)}
            </text>
          ) : null
        ))}
        <text x={PAD.l + PLOT_W / 2} y={VH - 8} textAnchor="middle" fill="var(--viz-muted)" fontSize="11">
          Week beginning
        </text>

        {/* Hit targets: the whole band, so nobody has to land on a thin column.
            One tab stop, arrow keys walk the weeks. */}
        <g onKeyDown={onKeyDown} role="group" aria-label="Weekly velocity data points">
          {weeks.map((w, i) => (
            <rect
              key={`hit-${w.weekStart}`}
              data-week={i}
              x={PAD.l + i * band}
              y={PAD.t}
              width={band}
              height={PLOT_H}
              fill="transparent"
              tabIndex={i === (active ?? 0) ? 0 : -1}
              role="img"
              aria-label={`Week of ${weekLabel(w.weekStart)}: ${w.created} created, ${w.completed} completed`}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(a => (a === i ? null : a))}
              onPointerEnter={() => setActive(i)}
              onPointerLeave={() => setActive(a => (a === i ? null : a))}
            >
              <title>
                {`Week of ${weekLabel(w.weekStart)} — ${w.created} created, ${w.completed} completed`}
              </title>
            </rect>
          ))}
        </g>
      </svg>

      {/* One tooltip, every series. Values lead, labels follow. */}
      {active !== null && week && (
        <div
          aria-hidden
          className={cx(
            'pointer-events-none absolute z-10 min-w-44 rounded-lg px-3 py-2 text-xs shadow-lg ring-1',
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
          <p className="mb-1 font-medium text-slate-500 dark:text-slate-400">
            Week of {weekLabel(week.weekStart)}
          </p>
          <p className="flex items-center gap-1.5">
            <span className="h-2 w-2 shrink-0 rounded-[2px]" style={{ background: 'var(--viz-created)' }} aria-hidden />
            <strong className="tabular-nums">{week.created}</strong>
            <span className="text-slate-500 dark:text-slate-400">created</span>
          </p>
          <p className="flex items-center gap-1.5">
            <span className="h-2 w-2 shrink-0 rounded-[2px]" style={{ background: 'var(--viz-completed)' }} aria-hidden />
            <strong className="tabular-nums">{week.completed}</strong>
            <span className="text-slate-500 dark:text-slate-400">completed</span>
          </p>
          <p className="mt-1 border-t border-slate-200 pt-1 text-slate-600 tabular-nums dark:border-slate-700 dark:text-slate-300">
            {week.completed - meanCompleted >= 0 ? '+' : ''}
            {(week.completed - meanCompleted).toFixed(1)} vs mean
          </p>
        </div>
      )}
      </div>

      {/* Table twin: every number, no hover required. */}
      <div className="sr-only">
        <table>
          <caption>Weekly velocity: tasks created and completed per ISO week</caption>
          <thead>
            <tr>
              <th scope="col">Week beginning</th>
              <th scope="col">Created</th>
              <th scope="col">Completed</th>
            </tr>
          </thead>
          <tbody>
            {weeks.map(w => (
              <tr key={w.weekStart}>
                <th scope="row">{weekLabel(w.weekStart)}</th>
                <td>{w.created}</td>
                <td>{w.completed}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Mean completed per week</th>
              <td />
              <td>{meanCompleted.toFixed(1)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
