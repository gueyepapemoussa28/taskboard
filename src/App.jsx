import { useState, useEffect, useRef } from 'react'
import { supabase } from './supabase'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import * as XLSX from 'xlsx'
import './App.css'

const STATUSES = ['overdue', 'today', 'upcoming', 'done']
const STATUS_LABELS = { overdue: 'Overdue', today: 'Today', upcoming: 'Upcoming', done: 'Done' }
const STRIPE = { overdue: '#E24B4A', today: '#BA7517', upcoming: '#1D9E75', done: '#888780' }
const BADGE = {
  overdue: { bg: '#FCEBEB', color: '#A32D2D' },
  today:   { bg: '#FAEEDA', color: '#633806' },
  upcoming:{ bg: '#E1F5EE', color: '#085041' },
  done:    { bg: '#F1EFE8', color: '#444441' },
}
const RESULT_STYLE = {
  on_time: { bg: '#E1F5EE', color: '#085041', label: 'On time' },
  early:   { bg: '#E6F1FB', color: '#185FA5', label: 'Early' },
  late:    { bg: '#FCEBEB', color: '#A32D2D', label: 'Late' },
}

function getAutoStatus(dateStr) {
  if (!dateStr) return 'upcoming'
  const today = new Date(); today.setHours(0,0,0,0)
  const d = new Date(dateStr); d.setHours(0,0,0,0)
  if (d < today) return 'overdue'
  if (d.getTime() === today.getTime()) return 'today'
  return 'upcoming'
}

function formatDate(dateStr) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
}

function formatMins(mins) {
  if (!mins && mins !== 0) return '—'
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h === 0) return `${m}min`
  if (m === 0) return `${h}h`
  return `${h}h${m}min`
}

function formatTimer(secs) {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
}

export default function App() {
  const [tasks, setTasks] = useState([])
  const [projects, setProjects] = useState([])
  const [view, setView] = useState('board')
  const [modal, setModal] = useState(false)
  const [projModal, setProjModal] = useState(false)
  const [form, setForm] = useState({ name:'', proj:'', description:'', date:'', start_time:'', end_time:'', estimated_minutes:'' })
  const [newProjInput, setNewProjInput] = useState('')
  const [addingProj, setAddingProj] = useState(false)
  const [loading, setLoading] = useState(true)
  const [dragId, setDragId] = useState(null)
  const [activeTimers, setActiveTimers] = useState({})
  const [tick, setTick] = useState(0)
  const intervalRef = useRef(null)

  useEffect(() => { fetchTasks(); fetchProjects() }, [])

  useEffect(() => {
    const hasActive = Object.keys(activeTimers).length > 0
    if (hasActive && !intervalRef.current) {
      intervalRef.current = setInterval(() => setTick(t => t + 1), 1000)
    } else if (!hasActive && intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    return () => {}
  }, [activeTimers])

  async function fetchTasks() {
    setLoading(true)
    const { data } = await supabase.from('tasks').select('*').order('created_at', { ascending: true })
    if (data) {
      setTasks(data)
      const timers = {}
      data.forEach(t => { if (t.timer_started_at) timers[t.id] = new Date(t.timer_started_at) })
      setActiveTimers(timers)
    }
    setLoading(false)
  }

  async function fetchProjects() {
    const { data } = await supabase.from('projects').select('*').order('name', { ascending: true })
    if (data) setProjects(data)
  }

  async function createProject() {
    const name = newProjInput.trim()
    if (!name) return
    const { data, error } = await supabase.from('projects').insert([{ name }]).select()
    if (error) { alert(`Failed to create project: ${error.message}`); return }
    if (data) {
      setProjects(p => [...p, ...data].sort((a,b) => a.name.localeCompare(b.name)))
      setForm(f => ({ ...f, proj: name }))
      setNewProjInput('')
      setAddingProj(false)
    }
  }

  async function deleteProject(id) {
    await supabase.from('projects').delete().eq('id', id)
    setProjects(p => p.filter(x => x.id !== id))
  }

  async function saveTask() {
    if (!form.name.trim()) return
    const status = getAutoStatus(form.date)
    const payload = {
      name: form.name.trim(),
      proj: form.proj.trim(),
      description: form.description.trim(),
      date: form.date || null,
      status,
      start_time: form.start_time || null,
      end_time: form.end_time || null,
      estimated_minutes: form.estimated_minutes ? parseInt(form.estimated_minutes) : null,
    }
    const { data, error } = await supabase.from('tasks').insert([payload]).select()
    if (error) { console.error('Insert failed:', error); alert(`Failed to add task: ${error.message}`); return }
    if (data) setTasks(t => [...t, ...data])
    setModal(false)
    setForm({ name:'', proj:'', description:'', date:'', start_time:'', end_time:'', estimated_minutes:'' })
  }

  async function updateStatus(id, status) {
    await supabase.from('tasks').update({ status }).eq('id', id)
    setTasks(t => t.map(x => x.id === id ? { ...x, status } : x))
  }

  async function removeTask(id) {
    await supabase.from('tasks').delete().eq('id', id)
    setTasks(t => t.filter(x => x.id !== id))
    setActiveTimers(a => { const n = {...a}; delete n[id]; return n })
  }

  async function startTimer(task) {
    const now = new Date()
    await supabase.from('tasks').update({ timer_started_at: now.toISOString() }).eq('id', task.id)
    setTasks(t => t.map(x => x.id === task.id ? { ...x, timer_started_at: now.toISOString() } : x))
    setActiveTimers(a => ({ ...a, [task.id]: now }))
  }

  async function stopTimer(task) {
    const startedAt = activeTimers[task.id]
    if (!startedAt) return
    const actual_minutes = Math.round((Date.now() - startedAt.getTime()) / 60000)
    const estimated = task.estimated_minutes
    let time_result = null
    if (estimated) {
      const diff = actual_minutes - estimated
      if (diff <= 2) time_result = 'early'
      else if (diff <= estimated * 0.15) time_result = 'on_time'
      else time_result = 'late'
    }
    const updates = { timer_started_at: null, actual_minutes, time_result, status: 'done' }
    await supabase.from('tasks').update(updates).eq('id', task.id)
    setTasks(t => t.map(x => x.id === task.id ? { ...x, ...updates } : x))
    setActiveTimers(a => { const n = {...a}; delete n[task.id]; return n })
  }

  function getElapsed(taskId) {
    const start = activeTimers[taskId]
    if (!start) return 0
    return Math.floor((Date.now() - start.getTime()) / 1000)
  }

  function toggleDone(task) {
    const newStatus = task.status === 'done' ? getAutoStatus(task.date) : 'done'
    updateStatus(task.id, newStatus)
  }

  const byStatus = (s) => tasks.filter(t => t.status === s)

  return (
    <div className="app">
      <div className="board">
        <div className="topbar">
          <div className="topbar-left">
            <span className="board-title">My tasks</span>
            <div className="view-toggle">
              <button className={`view-btn${view==='board'?' active':''}`} onClick={() => setView('board')}>Board</button>
              <button className={`view-btn${view==='list'?' active':''}`} onClick={() => setView('list')}>List</button>
              <button className={`view-btn${view==='dashboard'?' active':''}`} onClick={() => setView('dashboard')}>Dashboard</button>
            </div>
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <button className="add-btn" onClick={() => setProjModal(true)}>Projects</button>
            <button className="add-btn" style={{ background:'#378ADD', color:'#fff', borderColor:'#378ADD' }} onClick={() => {
              setForm({ name:'', proj:'', description:'', date: new Date().toISOString().split('T')[0], start_time:'', end_time:'', estimated_minutes:'' })
              setAddingProj(false); setNewProjInput('')
              setModal(true)
            }}>+ Add task</button>
          </div>
        </div>

        {loading ? <div className="loading">Loading tasks...</div>
          : view === 'board' ? <BoardView byStatus={byStatus} dragId={dragId} setDragId={setDragId} updateStatus={updateStatus} removeTask={removeTask} activeTimers={activeTimers} startTimer={startTimer} stopTimer={stopTimer} getElapsed={getElapsed} tick={tick} />
          : view === 'list' ? <ListView byStatus={byStatus} toggleDone={toggleDone} removeTask={removeTask} activeTimers={activeTimers} startTimer={startTimer} stopTimer={stopTimer} getElapsed={getElapsed} tick={tick} />
          : <DashboardView tasks={tasks} />
        }
      </div>

      {projModal && (
        <div className="modal-bg" onClick={e => e.target.className==='modal-bg' && setProjModal(false)}>
          <div className="modal">
            <h3>Projects</h3>
            <div className="proj-list">
              {projects.length === 0 && <div className="proj-empty">No projects yet</div>}
              {projects.map(p => (
                <div key={p.id} className="proj-row">
                  <span className="proj-row-name">{p.name}</span>
                  <button className="del-btn" style={{ position:'static' }} onClick={() => deleteProject(p.id)}>✕</button>
                </div>
              ))}
            </div>
            <div className="new-proj-row" style={{ marginTop:12 }}>
              <input type="text" placeholder="New project name" value={newProjInput} onChange={e => setNewProjInput(e.target.value)} onKeyDown={e => e.key==='Enter' && (supabase.from('projects').insert([{name:newProjInput.trim()}]).select().then(({data})=>{ if(data){ setProjects(p=>[...p,...data].sort((a,b)=>a.name.localeCompare(b.name))); setNewProjInput('') }}))} />
              <button className="btn-save" onClick={async () => {
                const name = newProjInput.trim(); if(!name) return
                const { data } = await supabase.from('projects').insert([{name}]).select()
                if(data){ setProjects(p=>[...p,...data].sort((a,b)=>a.name.localeCompare(b.name))); setNewProjInput('') }
              }}>Add</button>
            </div>
            <div className="modal-actions"><button className="btn-cancel" onClick={() => setProjModal(false)}>Close</button></div>
          </div>
        </div>
      )}

      {modal && (
        <div className="modal-bg" onClick={e => e.target.className==='modal-bg' && setModal(false)}>
          <div className="modal">
            <h3>New task</h3>
            <div className="field"><label>Task name</label><input type="text" placeholder="What needs to be done?" value={form.name} onChange={e => setForm(f=>({...f,name:e.target.value}))} autoFocus /></div>
            <div className="field">
              <label>Project</label>
              {addingProj ? (
                <div className="new-proj-row">
                  <input type="text" placeholder="Project name" value={newProjInput} onChange={e => setNewProjInput(e.target.value)} onKeyDown={e => e.key==='Enter' && createProject()} autoFocus />
                  <button className="btn-save" onClick={createProject}>Add</button>
                  <button className="btn-cancel" onClick={() => { setAddingProj(false); setNewProjInput('') }}>✕</button>
                </div>
              ) : (
                <div className="proj-select-row">
                  <select value={form.proj} onChange={e => setForm(f=>({...f,proj:e.target.value}))}>
                    <option value="">No project</option>
                    {projects.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
                  </select>
                  <button className="btn-new-proj" onClick={() => setAddingProj(true)} title="Create new project">＋</button>
                </div>
              )}
            </div>
            <div className="field"><label>Description (optional)</label><textarea placeholder="A few words..." value={form.description} onChange={e => setForm(f=>({...f,description:e.target.value}))} /></div>
            <div className="field"><label>Deadline</label><input type="date" value={form.date} onChange={e => setForm(f=>({...f,date:e.target.value}))} /></div>
            <div className="field-row">
              <div className="field"><label>Start time</label><input type="time" value={form.start_time} onChange={e => setForm(f=>({...f,start_time:e.target.value}))} /></div>
              <div className="field"><label>End time</label><input type="time" value={form.end_time} onChange={e => setForm(f=>({...f,end_time:e.target.value}))} /></div>
            </div>
            <div className="field"><label>Estimated duration (minutes)</label><input type="number" placeholder="e.g. 90" value={form.estimated_minutes} onChange={e => setForm(f=>({...f,estimated_minutes:e.target.value}))} /></div>
            <div className="modal-actions">
              <button className="btn-cancel" onClick={() => setModal(false)}>Cancel</button>
              <button className="btn-save" onClick={saveTask}>Add task</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function TaskCard({ t, s, removeTask, updateStatus, startTimer, stopTimer, getElapsed, tick, isRunning }) {
  const elapsed = isRunning ? getElapsed(t.id) : 0
  return (
    <div className="task-card" draggable onDragStart={e => e.dataTransfer.setData('id', t.id)}>
      <div className="stripe" style={{ background: STRIPE[s] }} />
      <button className="del-btn" onClick={() => removeTask(t.id)}>✕</button>
      <div className="task-proj">{t.proj || '—'}</div>
      <div className={`task-name${s==='done'?' done-name':''}`}>{t.name}</div>
      {t.description && <div className="task-desc">{t.description}</div>}
      <div className="task-meta">
        {t.date && <span className="task-date">{formatDate(t.date)}</span>}
        {t.start_time && <span className="task-slot">{t.start_time.slice(0,5)}{t.end_time ? ` → ${t.end_time.slice(0,5)}` : ''}</span>}
        {t.estimated_minutes && <span className="task-est">~{formatMins(t.estimated_minutes)}</span>}
      </div>
      {t.time_result && <span className="result-badge" style={{ background: RESULT_STYLE[t.time_result].bg, color: RESULT_STYLE[t.time_result].color }}>{RESULT_STYLE[t.time_result].label}{t.actual_minutes ? ` · ${formatMins(t.actual_minutes)}` : ''}</span>}
      {s !== 'done' && (
        <div className="timer-row">
          {isRunning ? (
            <>
              <span className="timer-display running">{formatTimer(elapsed)}</span>
              <button className="timer-btn stop" onClick={() => stopTimer(t)}>Stop</button>
            </>
          ) : (
            <>
              {t.actual_minutes ? <span className="timer-display">{formatMins(t.actual_minutes)} logged</span> : null}
              <button className="timer-btn start" onClick={() => startTimer(t)}>▶ Start timer</button>
              <button className="mark-btn" onClick={() => updateStatus(t.id,'done')}>Done</button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function BoardView({ byStatus, dragId, setDragId, updateStatus, removeTask, activeTimers, startTimer, stopTimer, getElapsed, tick }) {
  const [dragOver, setDragOver] = useState(null)
  return (
    <div className="columns">
      {STATUSES.map(s => (
        <div key={s} className={`col${dragOver===s?' drag-over':''}`}
          onDragOver={e => { e.preventDefault(); setDragOver(s) }}
          onDragLeave={() => setDragOver(null)}
          onDrop={e => { e.preventDefault(); const id = e.dataTransfer.getData('id'); if(id) updateStatus(id, s); setDragOver(null) }}>
          <div className="col-header">
            <span className="col-title"><span className="dot" style={{ background: STRIPE[s] }} />{STATUS_LABELS[s]}</span>
            <span className="col-count" style={{ background: BADGE[s].bg, color: BADGE[s].color }}>{byStatus(s).length}</span>
          </div>
          {byStatus(s).length === 0
            ? <div className="empty">Drop tasks here</div>
            : byStatus(s).map(t => <TaskCard key={t.id} t={t} s={s} removeTask={removeTask} updateStatus={updateStatus} startTimer={startTimer} stopTimer={stopTimer} getElapsed={getElapsed} tick={tick} isRunning={!!activeTimers[t.id]} />)
          }
        </div>
      ))}
    </div>
  )
}

function ListView({ byStatus, toggleDone, removeTask, activeTimers, startTimer, stopTimer, getElapsed, tick }) {
  return (
    <div className="list-view">
      {STATUSES.map(s => (
        <div key={s}>
          <div className="list-section-header">
            <span className="dot" style={{ background: STRIPE[s] }} />
            <span className="list-section-label">{STATUS_LABELS[s]}</span>
            <span className="list-section-count">({byStatus(s).length})</span>
          </div>
          {byStatus(s).length === 0
            ? <div className="list-empty">No tasks</div>
            : byStatus(s).map(t => {
              const isRunning = !!activeTimers[t.id]
              const elapsed = isRunning ? getElapsed(t.id) : 0
              return (
                <div key={t.id} className="list-row">
                  <div className={`check${t.status==='done'?' checked':''}`} onClick={() => toggleDone(t)}>
                    {t.status==='done' && <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><polyline points="1,4 3,6 7,2" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                  </div>
                  <div className="list-task-info">
                    <span className={`list-name${t.status==='done'?' done-name':''}`}>{t.name}</span>
                    {t.proj && <span className="list-proj">{t.proj}</span>}
                  </div>
                  <span className="list-date">{t.start_time ? t.start_time.slice(0,5) : formatDate(t.date)}</span>
                  <span className="list-date">{t.estimated_minutes ? `~${formatMins(t.estimated_minutes)}` : '—'}</span>
                  {t.time_result
                    ? <span className="list-badge" style={{ background: RESULT_STYLE[t.time_result].bg, color: RESULT_STYLE[t.time_result].color }}>{RESULT_STYLE[t.time_result].label}</span>
                    : <span className="list-badge" style={{ background: BADGE[s].bg, color: BADGE[s].color }}>{STATUS_LABELS[s]}</span>
                  }
                  {s !== 'done' && (
                    isRunning
                      ? <button className="timer-btn stop" onClick={() => stopTimer(t)}>{formatTimer(elapsed)} Stop</button>
                      : <button className="timer-btn start" onClick={() => startTimer(t)}>▶</button>
                  )}
                  <button className="list-del" onClick={() => removeTask(t.id)}>✕</button>
                </div>
              )
            })
          }
        </div>
      ))}
    </div>
  )
}

const PERIODS = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
  { value: 'all', label: 'All time' },
  { value: 'custom', label: 'Custom' },
]

function getDateRange(period, customFrom, customTo) {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  switch (period) {
    case 'today': return { from: today, to: now }
    case 'week': {
      const from = new Date(today)
      const day = today.getDay()
      from.setDate(today.getDate() - (day === 0 ? 6 : day - 1))
      return { from, to: now }
    }
    case 'month': return { from: new Date(today.getFullYear(), today.getMonth(), 1), to: now }
    case 'year': return { from: new Date(today.getFullYear(), 0, 1), to: now }
    case 'all': return { from: new Date(0), to: now }
    case 'custom': return {
      from: customFrom ? new Date(customFrom) : new Date(0),
      to: customTo ? new Date(customTo + 'T23:59:59') : now,
    }
    default: return { from: new Date(0), to: now }
  }
}

function getPeriodLabel(period, customFrom, customTo) {
  switch (period) {
    case 'today': return 'Today'
    case 'week': return 'This Week'
    case 'month': return 'This Month'
    case 'year': return 'This Year'
    case 'all': return 'All Time'
    case 'custom': return `${customFrom ? formatDate(customFrom) : '…'} – ${customTo ? formatDate(customTo) : '…'}`
    default: return ''
  }
}

function getStats(tasks, period, customFrom, customTo) {
  const { from, to } = getDateRange(period, customFrom, customTo)
  const periodTasks = tasks.filter(t => {
    if (!t.date) return period === 'all'
    const d = new Date(t.date)
    return d >= from && d <= to
  })
  const done = periodTasks.filter(t => t.status === 'done')
  const withResult = done.filter(t => t.time_result)
  const onTime = withResult.filter(t => t.time_result === 'on_time').length
  const early = withResult.filter(t => t.time_result === 'early').length
  const late = withResult.filter(t => t.time_result === 'late').length
  const plannedMins = periodTasks.reduce((s, t) => s + (t.estimated_minutes || 0), 0)
  const actualMins = done.reduce((s, t) => s + (t.actual_minutes || 0), 0)
  const total = withResult.length || 1
  return { onTime, early, late, plannedMins, actualMins, total, doneCount: done.length, totalCount: periodTasks.length, periodTasks }
}

function DonutChart({ segments, size = 120, strokeWidth = 13, children }) {
  const r = (size - strokeWidth) / 2
  const circ = 2 * Math.PI * r
  const cx = size / 2, cy = size / 2
  const total = segments.reduce((s, seg) => s + seg.value, 0)
  let cumAngle = -90
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#f0f0f0" strokeWidth={strokeWidth} />
        {total > 0 && segments.filter(s => s.value > 0).map((seg, i) => {
          const frac = seg.value / total
          const dash = frac * circ
          const angle = cumAngle
          cumAngle += frac * 360
          return (
            <circle key={i} cx={cx} cy={cy} r={r} fill="none"
              stroke={seg.color} strokeWidth={strokeWidth}
              strokeDasharray={`${dash} ${circ - dash}`}
              transform={`rotate(${angle} ${cx} ${cy})`}
            />
          )
        })}
      </svg>
      {children && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          {children}
        </div>
      )}
    </div>
  )
}

function exportPDF(stats, periodLabel) {
  const doc = new jsPDF()
  const generated = new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' })
  const donePct = Math.round((stats.doneCount / (stats.totalCount || 1)) * 100)
  const okPct = Math.round(((stats.onTime + stats.early) / (stats.total || 1)) * 100)
  const latePct = Math.round((stats.late / (stats.total || 1)) * 100)
  const plannedH = Math.round(stats.plannedMins / 60 * 10) / 10
  const actualH = Math.round(stats.actualMins / 60 * 10) / 10
  const deltaH = Math.round((actualH - plannedH) * 10) / 10
  const SC = { done:[16,140,100], overdue:[185,28,28], today:[161,81,15], upcoming:[30,100,150] }
  const RC = { 'On time':[16,140,100], 'Early':[37,99,195], 'Late':[185,28,28] }

  // ── 1. Header ─────────────────────────────────────────────────
  autoTable(doc, {
    startY: 0,
    body: [
      [{ content: 'TASK REPORT', styles: { fontSize: 18, fontStyle: 'bold', textColor: [255,255,255] } },
       { content: periodLabel, styles: { fontSize: 10, textColor: [148,163,184], halign: 'right', valign: 'bottom' } }],
      [{ content: `Generated on ${generated}`, colSpan: 2, styles: { fontSize: 8, textColor: [100,130,160] } }],
    ],
    theme: 'plain',
    styles: { fillColor: [30,41,59], cellPadding: { top:5, bottom:4, left:12, right:12 } },
    margin: { left:0, right:0 },
    tableWidth: 'auto',
  })

  // ── 2. KPI cards ──────────────────────────────────────────────
  autoTable(doc, {
    startY: doc.lastAutoTable.finalY + 8,
    head: [['COMPLETED','ON TIME + EARLY','LATE','HOURS']],
    body: [[
      { content: `${stats.doneCount} / ${stats.totalCount}\n${donePct}%`, styles: { textColor: [16,140,100] } },
      { content: `${stats.onTime + stats.early} tasks\n${okPct}% of timed`, styles: { textColor: [37,99,195] } },
      { content: `${stats.late} tasks\n${latePct}% of timed`, styles: { textColor: [185,28,28] } },
      { content: `${actualH}h actual\n${plannedH}h planned  (${deltaH >= 0 ? '+' : ''}${deltaH}h)`, styles: { textColor: [109,76,185] } },
    ]],
    theme: 'grid',
    headStyles: { fillColor: [51,65,85], textColor: [255,255,255], fontSize: 7.5, fontStyle: 'bold', halign: 'center', cellPadding: 4 },
    bodyStyles: { fontSize: 9.5, fontStyle: 'bold', halign: 'center', cellPadding: 6, minCellHeight: 16 },
    margin: { left:14, right:14 },
  })

  // ── 3. Performance breakdown ───────────────────────────────────
  autoTable(doc, {
    startY: doc.lastAutoTable.finalY + 8,
    head: [['TIME PERFORMANCE', '', '']],
    body: [[
      { content: `Early\n${stats.early} tasks`, styles: { textColor: [37,99,195], fontStyle: 'bold' } },
      { content: `On time\n${stats.onTime} tasks`, styles: { textColor: [16,140,100], fontStyle: 'bold' } },
      { content: `Late\n${stats.late} tasks`, styles: { textColor: [185,28,28], fontStyle: 'bold' } },
    ]],
    theme: 'grid',
    headStyles: { fillColor: [51,65,85], textColor: [255,255,255], fontSize: 7.5, fontStyle: 'bold', colSpan: 3, halign: 'left', cellPadding: 4 },
    bodyStyles: { fontSize: 9, halign: 'center', cellPadding: 5, minCellHeight: 12 },
    margin: { left:14, right:14 },
  })

  // ── 4. Task list ───────────────────────────────────────────────
  autoTable(doc, {
    startY: doc.lastAutoTable.finalY + 8,
    head: [['Task', 'Project', 'Status', 'Date', 'Est.', 'Actual', 'Result']],
    body: stats.periodTasks.map(t => [
      t.name,
      t.proj || '—',
      t.status,
      t.date ? formatDate(t.date) : '—',
      t.estimated_minutes ? formatMins(t.estimated_minutes) : '—',
      t.actual_minutes ? formatMins(t.actual_minutes) : '—',
      t.time_result ? RESULT_STYLE[t.time_result].label : '—',
    ]),
    theme: 'striped',
    headStyles: { fillColor: [30,41,59], textColor: [255,255,255], fontSize: 8, fontStyle: 'bold' },
    bodyStyles: { fontSize: 8, textColor: [30,41,59] },
    alternateRowStyles: { fillColor: [246,248,252] },
    columnStyles: { 2: { cellWidth: 22 }, 3: { cellWidth: 18 }, 4: { cellWidth: 16 }, 5: { cellWidth: 16 }, 6: { cellWidth: 20 } },
    didParseCell: data => {
      if (data.section !== 'body') return
      if (data.column.index === 2 && SC[data.cell.raw]) { data.cell.styles.textColor = SC[data.cell.raw]; data.cell.styles.fontStyle = 'bold' }
      if (data.column.index === 6 && RC[data.cell.raw]) { data.cell.styles.textColor = RC[data.cell.raw]; data.cell.styles.fontStyle = 'bold' }
    },
    margin: { left:14, right:14 },
  })

  doc.save(`task-report-${periodLabel.replace(/[^a-z0-9]/gi,'-').toLowerCase()}.pdf`)
}

function exportExcel(stats, periodLabel) {
  const wb = XLSX.utils.book_new()
  const generated = new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' })
  const donePct = Math.round((stats.doneCount / (stats.totalCount || 1)) * 100)
  const okPct = Math.round(((stats.onTime + stats.early) / (stats.total || 1)) * 100)
  const latePct = Math.round((stats.late / (stats.total || 1)) * 100)
  const plannedH = Math.round(stats.plannedMins / 60 * 10) / 10
  const actualH = Math.round(stats.actualMins / 60 * 10) / 10
  const deltaH = actualH - plannedH

  // ── Sheet 1: Summary ──────────────────────────────────
  const summaryData = [
    ['TASK REPORT — ' + periodLabel, ''],
    ['Generated on', generated],
    ['', ''],
    ['── COMPLETION ──────────────────', ''],
    ['Total tasks in period', stats.totalCount],
    ['Completed', stats.doneCount],
    ['Remaining', stats.totalCount - stats.doneCount],
    ['Completion rate', `${donePct}%`],
    ['', ''],
    ['── TIME PERFORMANCE ────────────', ''],
    ['Early', stats.early],
    ['On time', stats.onTime],
    ['Late', stats.late],
    ['On time or early', `${okPct}%`],
    ['Late rate', `${latePct}%`],
    ['', ''],
    ['── HOURS ───────────────────────', ''],
    ['Planned', plannedH],
    ['Actual', actualH],
    ['Delta (actual - planned)', `${deltaH >= 0 ? '+' : ''}${Math.round(deltaH * 10) / 10}h`],
  ]
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryData)
  wsSummary['!cols'] = [{ wch: 34 }, { wch: 18 }]
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary')

  // ── Sheet 2: Tasks ────────────────────────────────────
  const header = ['Task', 'Project', 'Status', 'Date', 'Start', 'End', 'Estimated (min)', 'Actual (min)', 'Result']
  const rows = stats.periodTasks.map(t => [
    t.name,
    t.proj || '',
    t.status,
    t.date || '',
    t.start_time ? t.start_time.slice(0, 5) : '',
    t.end_time ? t.end_time.slice(0, 5) : '',
    t.estimated_minutes != null ? t.estimated_minutes : '',
    t.actual_minutes != null ? t.actual_minutes : '',
    t.time_result ? RESULT_STYLE[t.time_result].label : '',
  ])
  const wsTasks = XLSX.utils.aoa_to_sheet([header, ...rows])
  wsTasks['!cols'] = [{ wch: 38 }, { wch: 22 }, { wch: 12 }, { wch: 13 }, { wch: 8 }, { wch: 8 }, { wch: 16 }, { wch: 14 }, { wch: 12 }]
  wsTasks['!autofilter'] = { ref: `A1:I1` }
  XLSX.utils.book_append_sheet(wb, wsTasks, 'Tasks')

  XLSX.writeFile(wb, `task-report-${periodLabel.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.xlsx`)
}

function DashboardView({ tasks }) {
  const [period, setPeriod] = useState('week')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')

  const stats = getStats(tasks, period, customFrom, customTo)
  const periodLabel = getPeriodLabel(period, customFrom, customTo)
  const donePct = Math.round((stats.doneCount / (stats.totalCount || 1)) * 100)
  const pct = (n) => Math.round((n / (stats.total || 1)) * 100)
  const overPct = stats.plannedMins > 0 ? Math.round((stats.actualMins - stats.plannedMins) / stats.plannedMins * 100) : 0
  const recentDone = stats.periodTasks.filter(t => t.status === 'done' && t.time_result).slice(-10).reverse()

  return (
    <div className="dashboard">
      <div className="dash-header">
        <div className="period-tabs">
          {PERIODS.map(p => (
            <button key={p.value} className={`period-tab${period === p.value ? ' active' : ''}`} onClick={() => setPeriod(p.value)}>{p.label}</button>
          ))}
        </div>
        <div className="dash-export-btns">
          <button className="export-btn" onClick={() => exportPDF(stats, periodLabel)}>↓ PDF</button>
          <button className="export-btn excel" onClick={() => exportExcel(stats, periodLabel)}>↓ Excel</button>
        </div>
      </div>

      {period === 'custom' && (
        <div className="custom-range">
          <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} />
          <span style={{ color:'#aaa' }}>—</span>
          <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} />
        </div>
      )}

      <div className="dash-rings">
        <div className="dash-ring-card">
          <DonutChart segments={[
            { value: stats.doneCount, color: '#1D9E75' },
            { value: Math.max(stats.totalCount - stats.doneCount, 0), color: '#e5e5e5' },
          ]}>
            <span className="ring-big">{donePct}%</span>
            <span className="ring-small">done</span>
          </DonutChart>
          <div className="ring-info">
            <div className="ring-title">Completed</div>
            <div className="ring-num">{stats.doneCount}<span className="ring-of"> / {stats.totalCount}</span></div>
            <div className="ring-legend-row">
              <span className="legend-dot" style={{ background: '#1D9E75' }} />Done
              <span className="legend-dot" style={{ background: '#e5e5e5', marginLeft: 8 }} />Remaining
            </div>
          </div>
        </div>

        <div className="dash-ring-card">
          <DonutChart segments={[
            { value: stats.early, color: '#378ADD' },
            { value: stats.onTime, color: '#1D9E75' },
            { value: stats.late, color: '#E24B4A' },
          ]}>
            <span className="ring-big">{pct(stats.onTime + stats.early)}%</span>
            <span className="ring-small">ok</span>
          </DonutChart>
          <div className="ring-info">
            <div className="ring-title">Time performance</div>
            <div className="ring-legend-col">
              <div><span className="legend-dot" style={{ background: '#378ADD' }} /><span>Early — {stats.early}</span></div>
              <div><span className="legend-dot" style={{ background: '#1D9E75' }} /><span>On time — {stats.onTime}</span></div>
              <div><span className="legend-dot" style={{ background: '#E24B4A' }} /><span>Late — {stats.late}</span></div>
            </div>
          </div>
        </div>

        <div className="dash-ring-card">
          <DonutChart segments={[
            { value: Math.min(stats.actualMins, stats.plannedMins), color: '#1D9E75' },
            { value: Math.max(stats.actualMins - stats.plannedMins, 0), color: '#E24B4A' },
            { value: Math.max(stats.plannedMins - stats.actualMins, 0), color: '#e5e5e5' },
          ]}>
            <span className="ring-big">{Math.round(stats.actualMins / 60 * 10) / 10}h</span>
            <span className="ring-small">actual</span>
          </DonutChart>
          <div className="ring-info">
            <div className="ring-title">Hours</div>
            <div className="ring-num">{Math.round(stats.plannedMins / 60 * 10) / 10}h<span className="ring-of"> planned</span></div>
            {stats.plannedMins > 0 && (
              <div className="ring-diff" style={{ color: stats.actualMins > stats.plannedMins ? '#A32D2D' : '#085041' }}>
                {stats.actualMins > stats.plannedMins ? `+${overPct}%` : `${overPct}%`} vs plan
              </div>
            )}
          </div>
        </div>
      </div>

      {recentDone.length > 0 && (
        <>
          <div className="dash-section-title" style={{ marginTop: '1.5rem' }}>Recent completions</div>
          <div className="dash-log">
            {recentDone.map(t => (
              <div key={t.id} className="dash-log-row">
                <span className="dash-log-name">{t.name}</span>
                {t.proj && <span className="dash-log-proj">{t.proj}</span>}
                <span className="dash-log-times">
                  {t.estimated_minutes ? `planned ${formatMins(t.estimated_minutes)}` : ''}
                  {t.actual_minutes ? ` · actual ${formatMins(t.actual_minutes)}` : ''}
                </span>
                <span className="result-badge" style={{ background: RESULT_STYLE[t.time_result].bg, color: RESULT_STYLE[t.time_result].color }}>{RESULT_STYLE[t.time_result].label}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
