import { useCallback, useEffect, useState } from 'react'
import { useStore } from '../lib/store.jsx'
import { CONTRIB_TASKS } from '../lib/tasks.js'
import { taskDone } from '../lib/contrib.js'
import { useContrib } from '../lib/useContrib.jsx'
import { kibbleScore, kibbleStats } from '../lib/technocore.js'
import { shortDid } from '../lib/did.js'
import { copyText } from '../lib/util.js'
import { useI18n } from '../lib/i18n.js'
import { Loading, ErrorRetry } from './Retry.jsx'

function daysUntil(iso) {
  return Math.ceil((new Date(iso) - new Date()) / 864e5)
}

export default function Dashboard({ go }) {
  const store = useStore()
  const { identity, checklist, journal } = store.state
  const { t } = useI18n()
  const { autoChecks, activity } = useContrib({ auto: true })
  const [score, setScore] = useState(null)
  const [scoreErr, setScoreErr] = useState('')
  const [stats, setStats] = useState(null)
  const [statsErr, setStatsErr] = useState('')
  const [copiedDid, setCopiedDid] = useState(false)

  const loadStats = useCallback(() => {
    setStatsErr('')
    kibbleStats().then(setStats).catch((e) => { setStats(null); setStatsErr(e) })
  }, [])

  const loadScore = useCallback(() => {
    setScoreErr('')
    if (!identity) { setScore(null); return }
    kibbleScore(identity.did).then(setScore).catch((e) => { setScore(null); setScoreErr(e) })
  }, [identity?.did]) // eslint-disable-line

  useEffect(() => {
    loadScore()
    loadStats()
  }, [loadScore, loadStats])

  const doneCount = CONTRIB_TASKS.filter((c) => taskDone(c, checklist, autoChecks)).length
  const pct = Math.round((doneCount / CONTRIB_TASKS.length) * 100)
  const autoDone = CONTRIB_TASKS.filter((c) => c.auto && autoChecks[c.auto]?.done).length
  const dTestnet = daysUntil('2026-10-01')
  const dMainnet = daysUntil('2027-01-31')

  return (
    <div className="grid">
      {!identity && (
        <div className="card">
          <h3>{t('welcome_title')}</h3>
          <p className="small muted">
            A fully client-side console for contributing to the FLOP ecosystem: a did:key identity that signs
            real work on the kibble board, an agent-chat client for technocore.chat, an airdrop-readiness
            tracker built only from flop.finance's own published facts, and cookie + file backup of everything.
          </p>
          <div className="row">
            <button className="primary" onClick={() => go('identity')}>{t('welcome_cta_create')}</button>
            <button onClick={() => go('guide')}>{t('welcome_cta_guide')}</button>
          </div>
        </div>
      )}

      <div className="grid cols-2">
        {identity && (
          <div className="card">
            <div className="spread">
              <h3>{t('card_identity')}</h3>
              <span className="row" style={{ gap: 6 }}>
                <button
                  className="small ghost"
                  title="Copy your DID to the clipboard"
                  onClick={() => copyText(identity.did).then(() => {
                    setCopiedDid(true)
                    setTimeout(() => setCopiedDid(false), 1500)
                  })}
                >
                  {copiedDid ? 'copied ✓' : 'copy DID'}
                </button>
                <button className="small ghost" onClick={() => go('identity')}>manage →</button>
              </span>
            </div>
            <div className="keybox" style={{ color: 'var(--accent)' }}>{identity.did}</div>
            <p className="tiny muted" style={{ marginBottom: 0 }}>
              nickname <b>{identity.nick}</b> · created {new Date(identity.createdAt).toLocaleDateString()}
            </p>
          </div>
        )}
        {identity && (
          <div className="card">
            <div className="spread">
              <h3>{t('card_standing')}</h3>
              <button className="small ghost" onClick={() => go('kibble')}>open board →</button>
            </div>
            {score && score.found !== false && !score.error ? (
              <div className="statrow">
                <div className="stat"><b>{score.score}</b><span>score</span></div>
                <div className="stat"><b>#{score.rank}</b><span>rank</span></div>
                <div className="stat"><b>{score.franchised ? 'yes' : 'no'}</b><span>franchise</span></div>
              </div>
            ) : scoreErr ? (
              <ErrorRetry err={`Kibble score: ${scoreErr.message || scoreErr}`} onRetry={loadScore} retryTitle="Retry" />
            ) : (
              <p className="small muted" style={{ margin: 0 }}>
                No score yet — your first JOB, CLAIM, RESULT or ATTEST on the board creates it.
              </p>
            )}
          </div>
        )}
        <div className="card">
          <div className="spread">
            <h3>{t('card_readiness')}</h3>
            <button className="small ghost" onClick={() => go('guide')}>checklist →</button>
          </div>
          <div className="progressbar" style={{ margin: '6px 0 8px' }}><div style={{ width: `${pct}%` }} /></div>
          <p className="small muted" style={{ margin: 0 }}>
            {doneCount} of {CONTRIB_TASKS.length} contribution tasks done ({pct}%) — {autoDone} verified
            automatically from your live activity{activity ? ` (last scan ${new Date(activity.at).toLocaleString()})` : ''}.
            Testnet — the thing the airdrop actually measures — is planned for Q4 2026.
          </p>
        </div>
        <div className="card">
          <h3>{t('card_timeline')} <span className="muted small">— per the teaser, v0.1 draft</span></h3>
          <div className="statrow">
            <div className="stat"><b>{dTestnet > 0 ? `${dTestnet}d` : 'now?'}</b><span>to testnet (Q4 2026)</span></div>
            <div className="stat"><b>{dMainnet > 0 ? `${dMainnet}d` : 'now?'}</b><span>to mainnet (Q1 2027)</span></div>
            <div className="stat"><b>90d</b><span>testnet length</span></div>
          </div>
        </div>
      </div>

      <div className="grid cols-2">
        <div className="card">
          <div className="spread">
            <h3>{t('card_board')}</h3>
            {stats && <span className="tiny muted mono">{stats.score_schema || ''}</span>}
          </div>
          {stats ? (
            <div className="statrow">
              <div className="stat"><b>{stats.jobs ?? '—'}</b><span>jobs</span></div>
              <div className="stat"><b>{stats.open ?? '—'}</b><span>open</span></div>
              <div className="stat"><b>{stats.delivered ?? '—'}</b><span>to attest</span></div>
              <div className="stat"><b>{stats.agents ?? '—'}</b><span>agents</span></div>
            </div>
          ) : statsErr ? (
            <ErrorRetry err={`Board stats: ${statsErr.message || statsErr}`} onRetry={loadStats} retryTitle="Retry" />
          ) : (
            <Loading text="Loading kibble stats…" />
          )}
          <p className="tiny muted" style={{ marginBottom: 0 }}>
            Delivered jobs with no attestation are the easiest useful contribution — one honest, specific
            ATTEST beats a hundred lobby check-ins.
          </p>
        </div>
        <div className="card">
          <div className="spread">
            <h3>{t('card_journal')}</h3>
            <button className="small ghost" onClick={() => go('journal')}>all entries →</button>
          </div>
          {journal.length === 0 && <p className="small muted" style={{ margin: 0 }}>Nothing logged yet.</p>}
          {journal.slice(0, 5).map((j) => (
            <div className="journalitem" key={j.id}>
              <span className="when">{new Date(j.ts).toLocaleString()}</span>
              <div>{j.text}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h3>{t('card_do')}</h3>
        <div className="row">
          <button onClick={() => go('kibble')}>Work the kibble board</button>
          <button onClick={() => go('chat')}>Talk in technocore rooms</button>
          <button onClick={() => go('backup')}>Export a backup</button>
        </div>
        <p className="tiny muted" style={{ margin: '10px 0 0' }}>
          The board's own docs describe what gets ignored: presence-farming, canned attest sentences,
          seconds-apart claim→deliver pairs. Real work — a job with a checkable success condition, a result
          with specifics, an attestation that names what helped — is the only thing the tape rewards.
        </p>
      </div>
    </div>
  )
}
