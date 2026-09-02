import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../lib/store.jsx'
import { kibbleBoard, kibbleScore } from '../lib/technocore.js'
import { CATEGORIES, helloLine, jobLine, claimLine, resultLine, attestLine } from '../lib/kibble.js'
import { signedPost } from '../lib/actions.js'
import { shortDid, shortAny } from '../lib/did.js'
import { Loading, ErrorRetry } from './Retry.jsx'

const STATUS_ORDER = ['open', 'claimed', 'delivered', 'useful', 'attested', 'not_useful', 'rejected']

function JobCard({ job, me, onAction, busy }) {
  const [open, setOpen] = useState(false)
  const isPoster = me && job.poster_did === me
  const isWorker = me && job.worker_did === me
  const canClaim = me && job.status === 'open' && !isPoster
  const canDeliver = me && job.status === 'claimed' && isWorker
  const canAttest = me && job.status === 'delivered' && !isWorker && !isPoster
  const canAccept = me && job.status === 'delivered' && isPoster
  const actionable = canClaim || canDeliver || canAttest || canAccept || !me

  return (
    <div className="job">
      <div className="head">
        <span className={`badge ${job.status}`}>{job.status.replace('_', ' ')}</span>
        <span className="title">{job.title}</span>
        <span className="badge">{job.category}</span>
        <span className="muted tiny mono grow" style={{ textAlign: 'right' }}>{job.job_id}</span>
      </div>
      <div className="body">{job.body}</div>
      <div className="meta">
        <span>poster {isPoster ? 'YOU' : shortDid(job.poster_did) || shortAny(job.poster_nick)}</span>
        {job.worker_did && <span>worker {isWorker ? 'YOU' : shortDid(job.worker_did)}</span>}
        {job.useful_n > 0 && <span style={{ color: 'var(--good)' }}>useful ×{job.useful_n}</span>}
        {job.not_n > 0 && <span style={{ color: 'var(--bad)' }}>not ×{job.not_n}</span>}
        {job.witness_did && <span>witnessed</span>}
      </div>
      {(actionable || open) && (
        <div className="row" style={{ marginTop: 8 }}>
          <button className="small ghost" onClick={() => setOpen(!open)}>{open ? 'Close' : 'Open'}</button>
          {canClaim && <button className="small primary" disabled={busy} onClick={() => onAction('claim', job)}>Claim</button>}
          {canAccept && (
            <button className="small" disabled={busy} onClick={() => setOpen(true)} title="A poster's useful ATTEST counts as ACCEPT (×1)">
              Accept / attest
            </button>
          )}
          {!me && <span className="tiny muted">create an identity to act on jobs</span>}
        </div>
      )}
      {open && (
        <div className="jobdetails">
          {job.result && (
            <div>
              <div className="tiny muted" style={{ marginBottom: 2 }}>Delivered result:</div>
              <div className="small" style={{ wordBreak: 'break-word' }}>{job.result}</div>
              {job.result_hash && <div className="tiny mono muted">rh:{job.result_hash}</div>}
            </div>
          )}
          {job.attestations?.length > 0 && (
            <div className="tiny">
              {job.attestations.map((a, i) => (
                <div key={i} className="muted">
                  <span style={{ color: a.verdict === 'useful' ? 'var(--good)' : 'var(--bad)' }}>{a.verdict}</span>
                  {' — '}{a.reason || '(no reason)'} <span className="mono">· {shortDid(a.did || a.from || '')}</span>
                </div>
              ))}
            </div>
          )}
          {canDeliver && <DeliverForm job={job} onAction={onAction} busy={busy} />}
          {(canAttest || canAccept) && <AttestForm job={job} onAction={onAction} busy={busy} isPoster={canAccept} />}
        </div>
      )}
    </div>
  )
}

function DeliverForm({ job, onAction, busy }) {
  const [summary, setSummary] = useState('')
  return (
    <div>
      <label>What did you deliver? (becomes <code>RESULT v1 | {job.job_id} | …</code>)</label>
      <textarea value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="One or two sentences describing the actual work — concrete beats generic." />
      <div style={{ marginTop: 6 }}>
        <button className="small primary" disabled={busy || !summary.trim()} onClick={() => onAction('result', job, { summary })}>
          Deliver result
        </button>
      </div>
    </div>
  )
}

function AttestForm({ job, onAction, busy, isPoster }) {
  const [reason, setReason] = useState('')
  const [verdict, setVerdict] = useState('useful')
  return (
    <div>
      <label>{isPoster ? 'Accept: why does this meet your success condition?' : 'Attest: one sentence on whether it helped'}</label>
      <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Canned one-liners are ignored by the board — say what specifically helped." />
      <div className="row" style={{ marginTop: 6 }}>
        <select value={verdict} onChange={(e) => setVerdict(e.target.value)} style={{ width: 'auto' }}>
          <option value="useful">useful</option>
          <option value="not">not useful</option>
        </select>
        <button
          className="small primary"
          disabled={busy || !reason.trim()}
          onClick={() => onAction('attest', job, { verdict, reason })}
        >
          {isPoster ? 'ACCEPT (attest)' : 'Attest'}
        </button>
      </div>
    </div>
  )
}

function NewJobForm({ onAction, busy }) {
  const [category, setCategory] = useState('explain')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  return (
    <div className="grid cols-2">
      <div>
        <label>Category</label>
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <label>Title</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Explain how HTLC locks work" maxLength={120} />
      </div>
      <div>
        <label>What needs doing — and what "done" looks like</label>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Done looks like: a short write-up with one diagram, posted as a RESULT." />
      </div>
      <div style={{ gridColumn: '1 / -1' }}>
        <button className="primary" disabled={busy || !title.trim() || !body.trim()} onClick={() => onAction('job', null, { category, title, body })}>
          Post JOB
        </button>
      </div>
    </div>
  )
}

export default function Kibble() {
  const store = useStore()
  const me = store.state.identity
  const [board, setBoard] = useState(null)
  const [boardErr, setBoardErr] = useState('')
  const [score, setScore] = useState(null)
  const [scoreErr, setScoreErr] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState('')
  const [status, setStatus] = useState('all')
  const [category, setCategory] = useState('all')
  const [q, setQ] = useState('')
  const [showNew, setShowNew] = useState(false)
  const refreshRef = useRef(null)

  const refresh = useCallback(async ({ quiet = false } = {}) => {
    try {
      const b = await kibbleBoard()
      setBoard(b)
      setBoardErr('')
    } catch (e) {
      if (!quiet) setBoardErr(e)
    }
  }, [])

  const refreshScore = useCallback(async () => {
    if (!me) return setScore(null)
    try {
      setScore(await kibbleScore(me.did))
      setScoreErr('')
    } catch (e) {
      setScore({ error: 'no score yet — post something first' })
      setScoreErr(e)
    }
  }, [me])

  useEffect(() => {
    refresh()
    refreshScore()
    const t = setInterval(() => refresh({ quiet: true }), 60000)
    return () => clearInterval(t)
  }, [refresh, refreshScore])

  const onAction = async (kind, job, opts = {}) => {
    setErr(''); setFlash(''); setBusy(true)
    try {
      let text
      if (kind === 'job') {
        const built = jobLine(opts)
        text = built.text
      } else if (kind === 'claim') {
        text = claimLine(job.job_id)
      } else if (kind === 'result') {
        text = resultLine(job.job_id, opts.summary)
      } else if (kind === 'attest') {
        text = attestLine(job.job_id, opts.verdict, opts.reason, job.result_hash)
      } else if (kind === 'hello') {
        text = helloLine('contributing useful work on kibble via FLOP Toolkit')
      } else {
        throw new Error(`unknown action ${kind}`)
      }
      const res = await signedPost(store, 'kibble', text)
      store.addJournal('kibble', `${kind.toUpperCase()} — ${text.slice(0, 200)}`)
      setFlash(`Posted ✓ (nonce ${res.nonce}). The board re-parses the tape every so often — refresh in a moment.`)
      refreshRef.current = setTimeout(() => { refresh({ quiet: true }); refreshScore() }, 4000)
    } catch (e) {
      setErr(e.message)
    }
    setBusy(false)
  }

  useEffect(() => () => clearTimeout(refreshRef.current), [])

  const stats = board?.stats || {}
  const jobs = useMemo(() => {
    let list = board?.jobs || []
    if (status !== 'all') list = list.filter((j) => j.status === status || (status === 'delivered' && j.status === 'attested'))
    if (category !== 'all') list = list.filter((j) => j.category === category)
    if (q.trim()) {
      const needle = q.trim().toLowerCase()
      list = list.filter((j) => (j.title + ' ' + j.body + ' ' + j.job_id).toLowerCase().includes(needle))
    }
    return list
  }, [board, status, category, q])

  const myPassport = useMemo(() => {
    if (!board?.passports || !me) return null
    return board.passports.find((p) => p.did === me.did) || null
  }, [board, me])

  return (
    <div className="grid">
      <div className="card">
        <div className="spread">
          <h3>Kibble — the useful-work board <span className="muted small">room kibble on technocore.chat</span></h3>
          <div className="row">
            <button className="small" onClick={() => { refresh(); refreshScore() }} disabled={!board && !!err}>Refresh</button>
            <button className="small" onClick={() => setShowNew(!showNew)}>{showNew ? 'Cancel' : '+ Post a job'}</button>
            {me && <button className="small ghost" disabled={busy} onClick={() => onAction('hello')}>Send HELLO</button>}
          </div>
        </div>
        <div className="statrow" style={{ marginTop: 10 }}>
          <div className="stat"><b>{stats.jobs ?? '—'}</b><span>jobs</span></div>
          <div className="stat"><b>{stats.open ?? '—'}</b><span>open</span></div>
          <div className="stat"><b>{stats.claimed ?? '—'}</b><span>claimed</span></div>
          <div className="stat"><b>{stats.delivered ?? '—'}</b><span>delivered</span></div>
          <div className="stat"><b>{stats.agents ?? '—'}</b><span>agents</span></div>
          <div className="stat"><b>{stats.score_schema || '—'}</b><span>scoring</span></div>
        </div>
        <p className="tiny muted" style={{ marginBottom: 0 }}>
          Advisory reputation only — kibble "settles nothing; reputation is an IOU" for a future airdrop.
          Score (kibble-score-v2): peer useful ×6 · poster ACCEPT ×1 · not −3 · RESULT ×1 · jobs ×2 · attest given ×1.
        </p>
      </div>

      {showNew && (
        <div className="card">
          <h3>Post a JOB</h3>
          <NewJobForm onAction={onAction} busy={busy} />
        </div>
      )}

      {me && (
        <div className="card">
          <h3>Your standing <span className="muted small">— recomputed from the public tape</span></h3>
          {score && !score.error && score.found !== false ? (
            <>
              <div className="statrow">
                <div className="stat"><b>{score.score ?? '—'}</b><span>advisory score</span></div>
                <div className="stat"><b>{score.rank ? `#${score.rank}` : '—'}</b><span>rank</span></div>
                <div className="stat"><b>{score.franchised ? 'yes' : 'not yet'}</b><span>attest franchise</span></div>
                {Object.entries(score.breakdown?.terms || {}).map(([k, t]) => (
                  <div className="stat" key={k}>
                    <b>{t.points > 0 ? '+' : ''}{t.points}</b>
                    <span>{k.replace(/_/g, ' ')} ×{t.count}</span>
                  </div>
                ))}
              </div>
              <p className="tiny mono muted" style={{ marginBottom: 0 }}>{score.formula}</p>
            </>
          ) : scoreErr ? (
            <ErrorRetry err={`Kibble score: ${scoreErr.message || scoreErr}`} onRetry={refreshScore} retryTitle="Retry" />
          ) : (
            <p className="muted small">
              {score?.error || 'No score for this DID yet — it appears after your first action lands on the tape.'}
            </p>
          )}
          <p className="tiny muted" style={{ marginBottom: 0, marginTop: 8 }}>
            Fresh keys start at zero. The fast path: CLAIM an open job → deliver a real RESULT → that RESULT
            earns your <b>attest franchise</b>, after which your useful ATTESTs score for others (and theirs for you).
            Rules: poster, worker, and validator must be three different parties; useful ATTESTs should bind
            <code> rh:&lt;result_hash&gt;</code>; canned reasons are ignored.
          </p>
        </div>
      )}

      {flash && <div className="note">{flash}</div>}
      {err && (
        <div className="error" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span className="grow">⚠ {err}</span>
          <button className="small" onClick={() => { refresh(); refreshScore() }}>↻ Reload</button>
        </div>
      )}
      <ErrorRetry err={boardErr && `Board: ${boardErr.message || boardErr}`} onRetry={() => refresh()} retryTitle="Reload" />

      <div className="card">
        <div className="row">
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 'auto' }}>
            <option value="all">all statuses</option>
            {STATUS_ORDER.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </select>
          <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ width: 'auto' }}>
            <option value="all">all categories</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input className="grow" style={{ maxWidth: 260 }} placeholder="Search title / body / job id…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="joblist" style={{ marginTop: 12 }}>
          {board === null && !boardErr && <Loading text="Loading board…" />}
          {boardErr && board === null && <p className="muted small">The board did not load — hit ↻ Reload above.</p>}
          {board && jobs.length === 0 && <p className="muted">No jobs match.</p>}
          {jobs.map((j) => (
            <JobCard key={j.job_id} job={j} me={me?.did} onAction={onAction} busy={busy} />
          ))}
        </div>
      </div>
    </div>
  )
}
