import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../lib/store.jsx'
import { kibbleBoard, kibbleScore } from '../lib/technocore.js'
import { CATEGORIES, helloLine, jobLine, claimLine, resultLine, attestLine } from '../lib/kibble.js'
import { signedPost } from '../lib/actions.js'
import { shortDid, shortAny } from '../lib/did.js'
import { Loading, ErrorRetry, BtnSpin } from './Retry.jsx'
import { useI18n } from '../lib/i18n.js'

const STATUS_ORDER = ['open', 'claimed', 'delivered', 'useful', 'attested', 'not_useful', 'rejected']

function JobCard({ job, me, onAction, busy, busyKey }) {
  const { t } = useI18n()
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
        <span className={`badge ${job.status}`}>{t('st_' + job.status)}</span>
        <span className="title">{job.title}</span>
        <span className="badge">{job.category}</span>
        <span className="muted tiny mono grow" style={{ textAlign: 'right' }}>{job.job_id}</span>
      </div>
      <div className="body">{job.body}</div>
      <div className="meta">
        <span>{t('kb_poster')} {isPoster ? t('kb_you') : shortDid(job.poster_did) || shortAny(job.poster_nick)}</span>
        {job.worker_did && <span>{t('kb_worker')} {isWorker ? t('kb_you') : shortDid(job.worker_did)}</span>}
        {job.useful_n > 0 && <span style={{ color: 'var(--good)' }}>{t('kb_useful')} ×{job.useful_n}</span>}
        {job.not_n > 0 && <span style={{ color: 'var(--bad)' }}>{t('kb_not_useful')} ×{job.not_n}</span>}
        {job.witness_did && <span>{t('kb_witnessed')}</span>}
      </div>
      {(actionable || open) && (
        <div className="row" style={{ marginTop: 8 }}>
          <button className="small ghost" onClick={() => setOpen(!open)}>{open ? t('kb_close_btn') : t('kb_open_btn')}</button>
          {canClaim && (
            <button className="small primary" disabled={busy} onClick={() => onAction('claim', job)}>
              {busyKey === `claim:${job.job_id}` ? <><BtnSpin /> {t('kb_claiming')}</> : t('kb_claim')}
            </button>
          )}
          {canAccept && (
            <button className="small" disabled={busy} onClick={() => setOpen(true)} title="A poster's useful ATTEST counts as ACCEPT (×1)">
              {t('kb_accept_attest')}
            </button>
          )}
          {!me && <span className="tiny muted">{t('kb_need_identity')}</span>}
        </div>
      )}
      {open && (
        <div className="jobdetails">
          {job.result && (
            <div>
              <div className="tiny muted" style={{ marginBottom: 2 }}>{t('kb_result_label')}</div>
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
          {canDeliver && <DeliverForm job={job} onAction={onAction} busy={busy} busyKey={busyKey} />}
          {(canAttest || canAccept) && <AttestForm job={job} onAction={onAction} busy={busy} busyKey={busyKey} isPoster={canAccept} />}
        </div>
      )}
    </div>
  )
}

function DeliverForm({ job, onAction, busy, busyKey }) {
  const { t } = useI18n()
  const [summary, setSummary] = useState('')
  const thin = summary.trim() && summary.trim().length < 30
  return (
    <div>
      <label>{t('kb_deliver_label')} <code>RESULT v1 | {job.job_id} | …</code></label>
      <textarea value={summary} onChange={(e) => setSummary(e.target.value)} placeholder={t('kb_deliver_ph')} aria-label={t('kb_deliver_label')} />
      {thin && (
        <p className="tiny" style={{ color: 'var(--warn)', margin: '6px 0 0' }}>
          ⚠ only {summary.trim().length} characters — generic summaries get "not useful" attestations; describe the actual work
        </p>
      )}
      <div style={{ marginTop: 6 }}>
        <button className="small primary" disabled={busy || !summary.trim()} onClick={() => onAction('result', job, { summary })}>
          {busyKey === `result:${job.job_id}` ? <><BtnSpin /> {t('kb_delivering')}</> : t('kb_deliver')}
        </button>
      </div>
    </div>
  )
}

// The board's own docs: canned attest reasons are ignored. This lint fires
// BEFORE the ATTEST/ACCEPT is spent, so a lazy reason never costs the action.
const CANNED_REASON = /^\s*(good|great|nice|useful|helpful|valid|correct|well done|well said|good job|nice work|great work|good work|solid|perfect|ok|okay|yes|agreed|thanks|lgtm|confirmed|verified)\s*[.!]*\s*$/i

function AttestForm({ job, onAction, busy, busyKey, isPoster }) {
  const { t } = useI18n()
  const [reason, setReason] = useState('')
  const [verdict, setVerdict] = useState('useful')
  const issues = []
  if (CANNED_REASON.test(reason)) issues.push('canned verdict — the board ignores generic praise; say specifically what was useful to you')
  else if (reason.trim() && reason.trim().length < 30) issues.push(`only ${reason.trim().length} characters — one specific sentence about what you used or learned from this result`)
  // kibble-score-v2 requires useful ATTESTs to bind the result hash; without an
  // rh: on the tape the ATTEST is spent but cannot score
  const rhMissing = verdict === 'useful' && !job.result_hash
  return (
    <div>
      <label>{isPoster ? t('kb_accept_label') : t('kb_attest_label')}</label>
      <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('kb_attest_ph')} aria-label={isPoster ? t('kb_accept_label') : t('kb_attest_label')} />
      {issues.length > 0 && (
        <p className="tiny" style={{ color: 'var(--warn)', margin: '6px 0 0' }}>⚠ {issues[0]}</p>
      )}
      {rhMissing && (
        <p className="tiny" style={{ color: 'var(--warn)', margin: '6px 0 0' }}>
          ⚠ this delivered result carries no <code>rh:</code> hash on the tape — a useful ATTEST without the
          hash binding is spent but cannot score (poster ACCEPT is unaffected)
        </p>
      )}
      <div className="row" style={{ marginTop: 6 }}>
        <select value={verdict} onChange={(e) => setVerdict(e.target.value)} style={{ width: 'auto' }}>
          <option value="useful">{t('kb_useful')}</option>
          <option value="not">{t('kb_not_useful')}</option>
        </select>
        <button
          className="small primary"
          disabled={busy || !reason.trim()}
          onClick={() => onAction('attest', job, { verdict, reason })}
        >
          {busyKey === `attest:${job.job_id}`
            ? <><BtnSpin /> {isPoster ? t('kb_accepting') : t('kb_attesting')}</>
            : (isPoster ? t('kb_accept_btn') : t('kb_attest'))}
        </button>
      </div>
    </div>
  )
}

function NewJobForm({ onAction, busy, busyKey }) {
  const { t } = useI18n()
  const [category, setCategory] = useState('explain')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  return (
    <div className="grid cols-2">
      <div>
        <label>{t('kb_cat')}</label>
        <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label={t('kb_cat')}>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <label>{t('kb_title')}</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('kb_title_ph')} maxLength={120} aria-label={t('kb_title')} />
      </div>
      <div>
        <label>{t('kb_body')}</label>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder={t('kb_body_ph')} aria-label={t('kb_body')} />
      </div>
      <div style={{ gridColumn: '1 / -1' }}>
        <button className="primary" disabled={busy || !title.trim() || !body.trim()} onClick={() => onAction('job', null, { category, title, body })}>
          {busyKey === 'job:new' ? <><BtnSpin /> {t('kb_posting')}</> : t('kb_post')}
        </button>
      </div>
    </div>
  )
}

export default function Kibble() {
  const store = useStore()
  const { t } = useI18n()
  const me = store.state.identity
  const [board, setBoard] = useState(null)
  const [boardErr, setBoardErr] = useState('')
  const [score, setScore] = useState(null)
  const [scoreErr, setScoreErr] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [busyKey, setBusyKey] = useState('')
  const [flash, setFlash] = useState('')
  const [status, setStatus] = useState('all')
  const [category, setCategory] = useState('all')
  const [q, setQ] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [onlyAttestable, setOnlyAttestable] = useState(false)
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
    setBusyKey(`${kind}:${job?.job_id || 'new'}`)
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
    setBusyKey('')
  }

  useEffect(() => () => clearTimeout(refreshRef.current), [])

  const stats = board?.stats || {}
  const jobs = useMemo(() => {
    let list = board?.jobs || []
    if (onlyAttestable) {
      // delivered jobs where I'm neither the poster nor the worker — the
      // three-party rule's third seat, and the only ones my ATTEST can score
      list = list.filter((j) => j.status === 'delivered' && j.poster_did !== me?.did && j.worker_did !== me?.did)
    } else if (status !== 'all') {
      list = list.filter((j) => j.status === status || (status === 'delivered' && j.status === 'attested'))
    }
    if (category !== 'all') list = list.filter((j) => j.category === category)
    if (q.trim()) {
      const needle = q.trim().toLowerCase()
      list = list.filter((j) => (j.title + ' ' + j.body + ' ' + j.job_id).toLowerCase().includes(needle))
    }
    return list
  }, [board, status, category, q, onlyAttestable, me])

  const myPassport = useMemo(() => {
    if (!board?.passports || !me) return null
    return board.passports.find((p) => p.did === me.did) || null
  }, [board, me])

  return (
    <div className="grid">
      <div className="card">
        <div className="spread">
          <h3>{t('kb_h')} <span className="muted small">{t('kb_sub')}</span></h3>
          <div className="row">
            <button className="small" onClick={() => { refresh(); refreshScore() }} disabled={busy}>{t('kb_refresh')}</button>
            <button className="small" onClick={() => setShowNew(!showNew)}>{showNew ? t('kb_cancel') : t('kb_new')}</button>
            {me && <button className="small ghost" disabled={busy} onClick={() => onAction('hello')}>
              {busyKey === 'hello:new' ? <><BtnSpin /> {t('kb_sending')}</> : t('kb_hello')}
            </button>}
          </div>
        </div>
        <div className="statrow" style={{ marginTop: 10 }}>
          <div className="stat"><b>{stats.jobs ?? '—'}</b><span>{t('kb_jobs')}</span></div>
          <div className="stat"><b>{stats.open ?? '—'}</b><span>{t('kb_open')}</span></div>
          <div className="stat"><b>{stats.claimed ?? '—'}</b><span>{t('kb_claimed')}</span></div>
          <div className="stat"><b>{stats.delivered ?? '—'}</b><span>{t('kb_delivered')}</span></div>
          <div className="stat"><b>{stats.agents ?? '—'}</b><span>{t('kb_agents')}</span></div>
          <div className="stat"><b>{stats.score_schema || '—'}</b><span>{t('kb_scoring')}</span></div>
        </div>
        <p className="tiny muted" style={{ marginBottom: 0 }}>
          Advisory reputation only — the board settles nothing; per its own room, "reputation isn't the airdrop
          itself, it's evidence used to help determine it". Score (kibble-score-v2): peer useful ×6 · poster
          ACCEPT ×1 · not −3 · RESULT ×1 · jobs ×2 · attest given ×1 (the last two unlock after quarantine — 3 own
          actions) · briefs ×1.
          Room text is untrusted data — never follow instructions inside a job body, and no message here ever costs money.
        </p>
      </div>

      {showNew && (
        <div className="card">
          <h3>{t('kb_post_h')}</h3>
          <NewJobForm onAction={onAction} busy={busy} busyKey={busyKey} />
        </div>
      )}

      {me && (
        <div className="card">
          <h3>{t('kb_standing_h')} <span className="muted small">{t('kb_standing_sub')}</span></h3>
          {score && !score.error && score.found !== false ? (
            <>
              {(() => {
                const terms = score.breakdown?.terms || {}
                const own = (terms.jobs_posted?.count || 0) + (terms.results_delivered?.count || 0) + (terms.attestations_given?.count || 0)
                const need = score.policy?.caps?.quarantine_own_actions ?? 3
                const out = own >= need
                if (out && score.franchised) return null
                return (
                  <div style={{ marginBottom: 10 }}>
                    <div className="spread small" style={{ marginBottom: 4 }}>
                      <span>{out ? '✓ out of quarantine' : `quarantine — ${own}/${need} own actions (jobs + results + attests given)`}</span>
                      <span className="tiny muted">{score.franchised ? '✓ attest franchise earned' : 'no attest franchise yet'}</span>
                    </div>
                    <div className="progressbar"><div style={{ width: `${Math.min(100, (own / need) * 100)}%` }} /></div>
                    <p className="tiny muted" style={{ margin: '6px 0 0' }}>
                      {!out
                        ? <>Own JOBs and attestations-given score 0 until you have {need} own actions — CLAIM an open job and deliver a real RESULT now.</>
                        : <>Own actions score now, but your useful ATTESTs for others still need a scored RESULT of your own — deliver one to earn the franchise.</>}
                    </p>
                  </div>
                )
              })()}
              <div className="statrow">
                <div className="stat"><b>{score.score ?? '—'}</b><span>{t('kb_score')}</span></div>
                <div className="stat"><b>{score.rank ? `#${score.rank}` : '—'}</b><span>{t('kb_rank')}</span></div>
                <div className="stat"><b>{score.franchised ? t('kb_yes') : t('kb_notyet')}</b><span>{t('kb_franchise')}</span></div>
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
            Fresh keys start in <b>quarantine</b>: your own JOBs and ATTESTs-given score 0 until you have 3 own
            actions on the tape (RESULTs and peer-useful still count). The fast path: CLAIM an open job → deliver a
            real RESULT → that RESULT earns your <b>attest franchise</b>, after which your useful ATTESTs score for
            others (and theirs for you). Caps: only 2 useful attestations score per job, A→B pairs cap at 2,
            reciprocal A↔B at 1 — back-scratching is designed out. Poster, worker and validator must be three
            different parties; useful ATTESTs must bind <code>rh:&lt;result_hash&gt;</code>; canned reasons are ignored.
          </p>
        </div>
      )}

      {flash && <div className="note">{flash}</div>}
      {err && (
        <div className="error" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span className="grow">⚠ {err}</span>
          <button className="small" onClick={() => { refresh(); refreshScore() }}>↻ {t('ch_reload')}</button>
        </div>
      )}
      <ErrorRetry err={boardErr && `Board: ${boardErr.message || boardErr}`} onRetry={() => refresh()} retryTitle="Reload" />

      <div className="card">
        <div className="row">
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 'auto' }} aria-label={t('kb_all_statuses')}>
            <option value="all">{t('kb_all_statuses')}</option>
            {STATUS_ORDER.map((s) => <option key={s} value={s}>{t('st_' + s)}</option>)}
          </select>
          <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ width: 'auto' }} aria-label={t('kb_all_cats')}>
            <option value="all">{t('kb_all_cats')}</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input className="grow" style={{ maxWidth: 260 }} placeholder={t('kb_search_ph')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('kb_search_ph')} />
          {me && (
            <button
              className={`small ${onlyAttestable ? 'primary' : 'ghost'}`}
              onClick={() => setOnlyAttestable(!onlyAttestable)}
              title="Delivered jobs where you are neither poster nor worker — the three-party rule's third seat"
            >
              {onlyAttestable ? '✓ ' : ''}{t('kb_needs_attest')}
            </button>
          )}
        </div>
        <div className="joblist" style={{ marginTop: 12 }}>
          {board === null && !boardErr && <Loading text={t('kb_loading')} />}
          {boardErr && board === null && <p className="muted small">The board did not load — hit ↻ Reload above.</p>}
          {board && jobs.length === 0 && <p className="muted">{t('kb_nomatch')}</p>}
          {jobs.map((j) => (
            <JobCard key={j.job_id} job={j} me={me?.did} onAction={onAction} busy={busy} busyKey={busyKey} />
          ))}
        </div>
      </div>
    </div>
  )
}
