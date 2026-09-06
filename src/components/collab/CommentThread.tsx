import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { Profile } from '../../lib/types'
import { useAuth } from '../../lib/auth'
import { useCollab, relativeTime } from '../../hooks/useCollab'
import type { CommentRow } from '../../hooks/useCollab'
import { MentionInput, displayName } from './MentionInput'
import { Button, Spinner, cx } from '../ui'

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Split a comment body into plain text and mention chips. Names are matched
 * longest-first so "@Ann" cannot swallow half of "@Anna Smith". The pieces are
 * returned as React nodes, never as HTML, so a body containing markup is shown
 * verbatim instead of being rendered.
 */
function renderBody(body: string, people: Profile[]): ReactNode[] {
  const names = [...people]
    .map(displayName)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
  if (names.length === 0) return [body]

  const re = new RegExp('@(?:' + names.join('|') + ')', 'g')
  const out: ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) {
    if (m.index > last) out.push(body.slice(last, m.index))
    out.push(
      <span
        key={`${m.index}-${m[0]}`}
        className="rounded px-1 font-medium text-indigo-700 ring-1 ring-indigo-200 dark:text-indigo-300 dark:ring-indigo-900"
      >
        {m[0]}
      </span>,
    )
    last = m.index + m[0].length
  }
  if (last < body.length) out.push(body.slice(last))
  return out
}

function Avatar({ name }: { name: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-200"
    >
      {name.charAt(0).toUpperCase()}
    </span>
  )
}

export interface CommentThreadProps {
  taskId: string
  /** Everyone who can be @mentioned on this task. */
  people: Profile[]
}

export function CommentThread({ taskId, people }: CommentThreadProps) {
  const { user } = useAuth()
  const { loading, error, loadComments, addComment, deleteComment } = useCollab()
  const [rows, setRows] = useState<CommentRow[]>([])
  const [ready, setReady] = useState(false)
  const [body, setBody] = useState('')
  const [mentions, setMentions] = useState<string[]>([])
  const [posting, setPosting] = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setReady(false)
    void loadComments(taskId).then(list => {
      if (!alive) return
      setRows(list)
      setReady(true)
    })
    return () => { alive = false }
  }, [taskId, loadComments])

  const nameOf = useMemo(() => {
    const map = new Map(people.map(p => [p.id, displayName(p)]))
    return (row: CommentRow) =>
      (row.author ? displayName(row.author) : map.get(row.author_id)) ?? 'Someone'
  }, [people])

  const submit = async () => {
    if (!body.trim() || posting) return
    setPosting(true)
    const row = await addComment(taskId, body, mentions)
    setPosting(false)
    if (!row) return
    setRows(prev => [...prev, row])
    setBody('')
    setMentions([])
  }

  const remove = async (id: string) => {
    setConfirmId(null)
    const ok = await deleteComment(id)
    if (ok) setRows(prev => prev.filter(r => r.id !== id))
  }

  return (
    <section className="space-y-3" aria-label="Comments">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Comments{rows.length > 0 && <span className="ml-1 font-normal text-slate-400">{rows.length}</span>}
      </h3>

      {!ready ? (
        <div className="flex items-center gap-2 py-4 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Loading the thread…
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
          No comments yet. Ask a question, or @mention a teammate to pull them in.
        </p>
      ) : (
        <ol className="space-y-3">
          {rows.map(row => {
            const author = nameOf(row)
            const mine = row.author_id === user?.id
            return (
              <li key={row.id} className="flex gap-2.5">
                <Avatar name={author} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{author}</span>
                    <time
                      dateTime={row.created_at}
                      title={new Date(row.created_at).toLocaleString()}
                      className="text-xs text-slate-400"
                    >
                      {relativeTime(row.created_at)}
                    </time>
                    {mine && (
                      confirmId === row.id ? (
                        <span className="ml-auto flex items-center gap-1.5 text-xs text-slate-500">
                          Delete this comment?
                          <button
                            type="button"
                            onClick={() => void remove(row.id)}
                            className="font-medium text-rose-600 hover:underline dark:text-rose-400"
                          >
                            Yes
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmId(null)}
                            className="hover:underline"
                          >
                            No
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmId(row.id)}
                          className="ml-auto text-xs text-slate-400 transition hover:text-rose-600 dark:hover:text-rose-400"
                        >
                          Delete
                        </button>
                      )
                    )}
                  </div>
                  <p className="whitespace-pre-wrap break-words text-sm text-slate-700 dark:text-slate-200">
                    {renderBody(row.body, people)}
                  </p>
                </div>
              </li>
            )
          })}
        </ol>
      )}

      <div className="space-y-2">
        <MentionInput
          id={`comment-${taskId}`}
          value={body}
          people={people}
          onChange={(text, ids) => { setBody(text); setMentions(ids) }}
          onSubmit={() => void submit()}
          aria-label="Write a comment"
        />
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => void submit()} disabled={!body.trim() || posting}>
            {posting && <Spinner className="h-3.5 w-3.5" />}
            Comment
          </Button>
          <span className="text-xs text-slate-400">
            {mentions.length > 0
              ? `${mentions.length} ${mentions.length === 1 ? 'person gets' : 'people get'} an email`
              : 'Ctrl/⌘ + Enter to post'}
          </span>
          {loading && !posting && <Spinner className="ml-auto h-3.5 w-3.5 text-slate-400" />}
        </div>
        {error && (
          <p className={cx('text-xs text-rose-600 dark:text-rose-400')} role="alert">{error}</p>
        )}
      </div>
    </section>
  )
}

export default CommentThread
