import { useMemo, useState } from 'react'
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor,
  closestCorners, useSensor, useSensors,
} from '@dnd-kit/core'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import type { Project, Task, TaskStatus } from '../lib/types'
import { COLUMNS } from '../lib/types'
import Column from './Column'
import { TaskBody } from './TaskCard'

export default function Board({ project, tasks, onOpenTask, onAdd, onMove }: {
  project: Project
  tasks: Task[]
  onOpenTask: (t: Task) => void
  onAdd: (status: TaskStatus) => void
  onMove: (id: string, status: TaskStatus, index: number) => void
}) {
  const [dragging, setDragging] = useState<Task | null>(null)

  const sensors = useSensors(
    // A small distance threshold keeps a click-to-open from registering as a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const columns = useMemo(() => {
    const map = new Map<TaskStatus, Task[]>(COLUMNS.map(c => [c.id, []]))
    for (const t of [...tasks].sort((a, b) => a.sort_order - b.sort_order)) {
      map.get(t.status)?.push(t)
    }
    return map
  }, [tasks])

  function handleStart(e: DragStartEvent) {
    setDragging(tasks.find(t => t.id === e.active.id) ?? null)
  }

  function handleEnd(e: DragEndEvent) {
    setDragging(null)
    const { active, over } = e
    if (!over) return

    const moving = tasks.find(t => t.id === active.id)
    if (!moving) return

    const overId = String(over.id)

    // Dropped on the column body (an empty column, or below the last card).
    if (overId.startsWith('col:')) {
      const status = overId.slice(4) as TaskStatus
      const column = columns.get(status) ?? []
      const index = column.filter(t => t.id !== moving.id).length
      if (status === moving.status && index === column.indexOf(moving)) return
      onMove(moving.id, status, index)
      return
    }

    // Dropped on another card — take that card's slot.
    const target = tasks.find(t => t.id === overId)
    if (!target || target.id === moving.id) return

    const column = (columns.get(target.status) ?? []).filter(t => t.id !== moving.id)
    const index = column.findIndex(t => t.id === target.id)
    onMove(moving.id, target.status, index < 0 ? column.length : index)
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleStart}
      onDragEnd={handleEnd}
      onDragCancel={() => setDragging(null)}
    >
      <div className="flex h-full gap-4 overflow-x-auto px-4 pb-4 sm:px-6" aria-label={`${project.name} board`}>
        {COLUMNS.map(col => (
          <Column
            key={col.id}
            status={col.id}
            tasks={columns.get(col.id) ?? []}
            onOpenTask={onOpenTask}
            onAdd={onAdd}
          />
        ))}
      </div>

      <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)' }}>
        {dragging && <div className="w-72 sm:w-80"><TaskBody task={dragging} dragging /></div>}
      </DragOverlay>
    </DndContext>
  )
}
