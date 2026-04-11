import { useState, useEffect, useRef } from 'react'
import { supabase } from './supabase'
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
  const [view, setView] = useState('board')
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState({ name:'', proj:'', description:'', date:'', start_time:'', end_time:'', estimated_minutes:'' })
  const [loading, setLoading] = useState(true)
  const [dragId, setDragId] = useState(null)
  const [activeTimers, setActiveTimers] = useState({})
  const [tick, setTick] = useState(0)
  const intervalRef = useRef(null)

  useEffect(() => { fetchTasks() }, [])

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

  const weekStats = () => {
    const now = new Date()
    const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay()); weekStart.setHours(0,0,0,0)
    const weekTasks = tasks.filter(t => {
      if (!t.date) return false
      const d = new Date(t.date)
      return d >= weekStart && d <= now
    })
    const done = weekTasks.filter(t => t.status === 'done')
    const withResult = done.filter(t => t.time_result)
    const onTime = withResult.filter(t => t.time_result === 'on_time').length
    const early = withResult.filter(t => t.time_result === 'early').length
    const late = withResult.filter(t => t.time_result === 'late').length
    const plannedMins = weekTasks.reduce((s, t) => s + (t.estimated_minutes || 0), 0)
    const actualMins = done.reduce((s, t) => s + (t.actual_minutes || 0), 0)
    const total = withResult.length || 1
    return { onTime, early, late, plannedMins, actualMins, total, doneCount: done.length, totalCount: weekTasks.length }
  }

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
          <button className="add-btn" onClick={() => {
            setForm({ name:'', proj:'', description:'', date: new Date().toISOString().split('T')[0], start_time:'', end_time:'', estimated_minutes:'' })
            setModal(true)
          }}>+ Add task</button>
        </div>

        {loading ? <div className="loading">Loading tasks...</div>
          : view === 'board' ? <BoardView byStatus={byStatus} dragId={dragId} setDragId={setDragId} updateStatus={updateStatus} removeTask={removeTask} activeTimers={activeTimers} startTimer={startTimer} stopTimer={stopTimer} getElapsed={getElapsed} tick={tick} />
          : view === 'list' ? <ListView byStatus={byStatus} toggleDone={toggleDone} removeTask={removeTask} activeTimers={activeTimers} startTimer={startTimer} stopTimer={stopTimer} getElapsed={getElapsed} tick={tick} />
          : <DashboardView stats={weekStats()} tasks={tasks} />
        }
      </div>

      {modal && (
        <div className="modal-bg" onClick={e => e.target.className==='modal-bg' && setModal(false)}>
          <div className="modal">
            <h3>New task</h3>
            <div className="field"><label>Task name</label><input type="text" placeholder="What needs to be done?" value={form.name} onChange={e => setForm(f=>({...f,name:e.target.value}))} autoFocus /></div>
            <div className="field"><label>Project</label><input type="text" placeholder="e.g. KFC Sénégal" value={form.proj} onChange={e => setForm(f=>({...f,proj:e.target.value}))} /></div>
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

function DashboardView({ stats, tasks }) {
  const pct = (n) => Math.round((n / stats.total) * 100)
  const donePct = Math.round((stats.doneCount / (stats.totalCount || 1)) * 100)

  const recentDone = tasks.filter(t => t.status === 'done' && t.time_result).slice(-10).reverse()

  return (
    <div className="dashboard">
      <div className="dash-section-title">This week</div>
      <div className="dash-cards">
        <div className="dash-card">
          <div className="dash-label">Tasks completed</div>
          <div className="dash-value">{stats.doneCount}<span className="dash-sub">/ {stats.totalCount}</span></div>
          <div className="dash-bar-wrap"><div className="dash-bar-fill" style={{ width: `${donePct}%`, background: '#1D9E75' }} /></div>
          <div className="dash-pct">{donePct}%</div>
        </div>
        <div className="dash-card">
          <div className="dash-label">On time</div>
          <div className="dash-value" style={{ color: '#085041' }}>{stats.onTime}<span className="dash-sub"> tasks</span></div>
          <div className="dash-bar-wrap"><div className="dash-bar-fill" style={{ width: `${pct(stats.onTime)}%`, background: '#1D9E75' }} /></div>
          <div className="dash-pct">{pct(stats.onTime)}%</div>
        </div>
        <div className="dash-card">
          <div className="dash-label">Early</div>
          <div className="dash-value" style={{ color: '#185FA5' }}>{stats.early}<span className="dash-sub"> tasks</span></div>
          <div className="dash-bar-wrap"><div className="dash-bar-fill" style={{ width: `${pct(stats.early)}%`, background: '#378ADD' }} /></div>
          <div className="dash-pct">{pct(stats.early)}%</div>
        </div>
        <div className="dash-card">
          <div className="dash-label">Late</div>
          <div className="dash-value" style={{ color: '#A32D2D' }}>{stats.late}<span className="dash-sub"> tasks</span></div>
          <div className="dash-bar-wrap"><div className="dash-bar-fill" style={{ width: `${pct(stats.late)}%`, background: '#E24B4A' }} /></div>
          <div className="dash-pct">{pct(stats.late)}%</div>
        </div>
        <div className="dash-card">
          <div className="dash-label">Hours planned</div>
          <div className="dash-value">{Math.round(stats.plannedMins / 60 * 10) / 10}<span className="dash-sub">h</span></div>
        </div>
        <div className="dash-card">
          <div className="dash-label">Hours actual</div>
          <div className="dash-value">{Math.round(stats.actualMins / 60 * 10) / 10}<span className="dash-sub">h</span></div>
          {stats.plannedMins > 0 && <div className="dash-pct" style={{ color: stats.actualMins > stats.plannedMins ? '#A32D2D' : '#085041' }}>
            {stats.actualMins > stats.plannedMins ? '+' : ''}{Math.round((stats.actualMins - stats.plannedMins) / 60 * 10) / 10}h vs plan
          </div>}
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
                {t.time_result && <span className="result-badge" style={{ background: RESULT_STYLE[t.time_result].bg, color: RESULT_STYLE[t.time_result].color }}>{RESULT_STYLE[t.time_result].label}</span>}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
