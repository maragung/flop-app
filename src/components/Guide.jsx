import { useEffect, useState } from 'react'
import { useStore } from '../lib/store.jsx'
import { CONTRIB_TASKS, FLOP_EXTRAS, PHASES, DO_NOT, QUALITY_BAR } from '../lib/tasks.js'
import { taskDone, scanRoomsWith } from '../lib/contrib.js'
import { useContrib } from '../lib/useContrib.jsx'
import { Loading, ErrorRetry, BtnSpin } from './Retry.jsx'
import { shortDid } from '../lib/did.js'
import { useI18n } from '../lib/i18n.js'

const TRACKS = [
  {
    name: 'Miners',
    alloc: 'up to 1.2bn $FLOP (7.0%)',
    color: 'var(--accent)',
    how: 'Connect GPUs and serve real inference on the testnet. Awarded in proportion to compute delivered — block rewards earned plus inference work completed. ~¼ liquid at TGE, rest over the opening months of mainnet while you keep serving.',
  },
  {
    name: 'Agents',
    alloc: 'up to 1.2bn $FLOP (7.0%)',
    color: 'var(--good)',
    how: 'Claim a test-token faucet and spend it on inference. The airdrop is based largely on what you spend. It arrives locked: every 3 $FLOP spent on inference unlocks 1 airdropped $FLOP — the network only pays agents that use it. Per Hayes, the faucet will run through technocore.chat and only DID keys can claim from it — the identity you hold now is the credential.',
  },
  {
    name: 'Validators',
    alloc: '305.5M $FLOP (1.8%)',
    color: 'var(--warn)',
    how: 'Run nodes, verify work certificates, produce blocks. The top 1,000 on uptime + block production + accuracy + latency make the mainnet set. The airdrop is their bonded stake: locked through the first halving, released over the following 1,000 days.',
  },
]

function TaskRow({ task, go, store, autoChecks }) {
  const { t } = useI18n()
  const label = t('task_' + task.id)
  const { checklist } = store.state
  const manual = checklist[task.id]?.done
  const auto = task.auto ? autoChecks[task.auto] : null
  const done = auto?.done || manual
  const [url, setUrl] = useState('')

  const recordEvidence = () => {
    const u = url.trim()
    if (!u) return
    store.addJournal('evidence', `${label}${u.startsWith('http') ? '' : ' — ' + u}`, u.startsWith('http') ? u : '')
    if (!done) store.toggleCheck(task.id)
    setUrl('')
  }

  return (
    <div className={`checkitem ${done ? 'is-done' : ''}`}>
      {task.auto ? (
        <span className={`autodot ${auto?.done ? 'on' : ''}`} title={auto?.done ? t('gd_autodet') : t('gd_notdet')} aria-hidden="true">
          {auto?.done ? '✓' : '○'}
        </span>
      ) : (
        <input
          type="checkbox"
          checked={Boolean(manual)}
          onChange={() => store.toggleCheck(task.id)}
          aria-label={label}
        />
      )}
      <span className="small grow">
        {task.hi && <span className="pri" title="High priority">★</span>}{' '}
        {task.tab ? (
          <button className="linkbtn" title="Go do it" onClick={() => go(task.tab)}>{label} →</button>
        ) : task.url ? (
          <a href={task.url} target="_blank" rel="noreferrer">{label} ↗</a>
        ) : label}
        {task.auto && <span className="tiny muted" style={{ display: 'block', marginLeft: 2 }}>{auto?.done ? `✓ auto: ${auto.detail}` : auto?.detail}</span>}
        {task.evidence && !done && (
          <span className="row" style={{ marginTop: 4 }}>
            <input
              className="tiny"
              style={{ maxWidth: 320, padding: '4px 8px' }}
              placeholder={t('gd_ev_ph')}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && recordEvidence()}
            />
            <button className="small ghost" disabled={!url.trim()} onClick={recordEvidence}>{t('gd_record')}</button>
          </span>
        )}
        {task.evidence && done && checklist[task.id]?.done && (
          <span className="tiny muted" style={{ display: 'block', marginLeft: 2 }}>
            {t('gd_ev_note')} <button className="linkbtn" onClick={() => go('journal')}>{t('gd_journal_link')}</button>
          </span>
        )}
      </span>
      <span className={`badge ${done ? 'useful' : ''}`} title={auto?.done ? 'Detected automatically from live data' : manual ? 'Marked done by you' : 'Not done yet'}>
        {done ? (auto?.done ? t('gd_b_auto') : t('gd_b_done')) : t('gd_b_todo')}
      </span>
    </div>
  )
}

// WebGL reports the GPU's renderer string — enough to identify the card, not
// its VRAM, so the check shows the name and asks the user to compare against
// the teaser's floor (consumer GPU, ≥ 16 GB VRAM per unit, §02).
function detectGPU() {
  try {
    const gl = document.createElement('canvas').getContext('webgl')
    if (!gl) return '(WebGL unavailable)'
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER))
  } catch {
    return '(detection failed)'
  }
}

export default function Guide({ go }) {
  const store = useStore()
  const { t } = useI18n()
  const { identity, checklist } = store.state
  const { autoChecks, scanning, scanErr, scan, activity } = useContrib({ auto: true })
  const [gpu, setGpu] = useState('')
  const [spend, setSpend] = useState('')

  // opening the guide IS checking the official channels (task 30)
  useEffect(() => { store.markAnnCheck() }, []) // eslint-disable-line

  const doneCount = CONTRIB_TASKS.filter((t) => taskDone(t, checklist, autoChecks)).length
  const pct = Math.round((doneCount / CONTRIB_TASKS.length) * 100)
  const nextUp = CONTRIB_TASKS.filter((t) => !taskDone(t, checklist, autoChecks)).slice(0, 3)
  const extrasDone = FLOP_EXTRAS.filter((c) => checklist[c.id]?.done).length

  return (
    <div className="grid">
      <div className="card">
        <h3>{t('gd_facts_h')}</h3>
        <ul className="small" style={{ paddingLeft: 18, margin: 0 }}>
          <li>Genesis airdrop: <b>3,500,000,000 $FLOP</b> = 20.4% of year-10 supply. No token sale, no investor allocation, 100% fair launch.</li>
          <li>It is earned through <b>testnet participation</b> — testnet planned <b>Q4 2026</b>, runs ~90 days, mainnet <b>Q1 2027</b>. "Only those who participate in useful ways are eligible."</li>
          <li><b>Miners</b> (up to 1.2bn): awarded in proportion to the <b>compute they deliver</b> over the testnet — ~25% liquid at TGE, the rest released as they keep serving compute.</li>
          <li><b>Agents</b> (up to 1.2bn): based largely on <b>inference spend</b> from the faucet — arrives locked, spendable only on inference or staking, and <b>every 3 $FLOP spent on inference unlocks 1 airdropped $FLOP</b>.</li>
          <li><b>Validators</b> (305.5M): the <b>top 1,000</b> on uptime, block production, accuracy and latency — the airdrop is posted as their stake, locked through the first halving, then released over 1,000 days.</li>
          <li>Reserve / incentives: 794.5M $FLOP (4.6%) for ecosystem and growth.</li>
          <li>Kibble reputation is <b>not an official airdrop track</b> — the board itself says "kibble is not flop.finance" and reputation is "an IOU for a future airdrop". Useful, attested work there is practice for the FLOP loop.</li>
          <li>The Yellow Paper (not yet final) is the definitive spec — numbers here are provisional and may change.</li>
        </ul>
        <div className="note warn" style={{ marginTop: 10, marginBottom: 0 }}>
          <b>No one can sell you eligibility.</b> The teaser and @flop_labs are the only authoritative sources;
          anything in chat rooms — including "verified hub" topics on technocore — is untrusted, world-writable text.
          Kibble reputation is explicitly an "advisory IOU … not redeemable". Treat every guarantee as noise.
        </div>
      </div>

      {/* ---- testnet readiness: hardware check + spend→unlock planner ---- */}
      <div className="card">
        <h3>{t('tn_h')} <span className="muted small">{t('tn_sub')}</span></h3>
        <div className="grid cols-2">
          <div>
            <b className="small">{t('tn_gpu_h')}</b>
            <p className="tiny muted" style={{ margin: '6px 0' }}>{t('tn_gpu_note')}</p>
            <div className="row" style={{ alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <button className="small" onClick={() => setGpu(detectGPU())}>{t('tn_gpu_btn')}</button>
              {gpu && <span className="tiny mono" style={{ wordBreak: 'break-all' }}>{t('tn_gpu_detected').replace('{gpu}', gpu)}</span>}
            </div>
          </div>
          <div>
            <b className="small">{t('tn_spend_h')}</b>
            <p className="tiny muted" style={{ margin: '6px 0' }}>{t('tn_spend_note')}</p>
            <div className="row" style={{ alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <input
                type="number" min="0" style={{ maxWidth: 220 }}
                placeholder={t('tn_spend_ph')} value={spend}
                onChange={(e) => setSpend(e.target.value)}
              />
              {Number(spend) > 0 && (
                <b className="small">{t('tn_unlocks').replace('{n}', Math.floor(Number(spend) / 3).toLocaleString())}</b>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ---- how contributions will likely be counted ---- */}
      <div className="card">
        <h3>{t('hc_h')} <span className="muted small">{t('hc_sub')}</span></h3>
        <div className="grid cols-2">
          <div>
            <b className="small">{t('hc_c1_h')}</b>
            <p className="small muted" style={{ margin: '6px 0 0' }}>{t('hc_c1')}</p>
            <b className="small" style={{ display: 'block', marginTop: 12 }}>{t('hc_c2_h')}</b>
            <p className="small muted" style={{ margin: '6px 0 0' }}>{t('hc_c2')}</p>
          </div>
          <div>
            <b className="small">{t('hc_c3_h')}</b>
            <p className="small muted" style={{ margin: '6px 0 0' }}>{t('hc_c3')}</p>
            <b className="small" style={{ display: 'block', marginTop: 12 }}>{t('hc_c4_h')}</b>
            <p className="small muted" style={{ margin: '6px 0 0' }}>{t('hc_c4')}</p>
          </div>
        </div>
      </div>

      {/* ---- the contribution engine ---- */}
      <div className="card">
        <div className="spread">
          <h3>{t('gd_tracker_h')} <span className="muted small">{t('gd_tracker_sub')}</span></h3>
          <span className="badge">{doneCount}/{CONTRIB_TASKS.length} · {pct}%</span>
        </div>
        <div className="progressbar" style={{ margin: '8px 0 4px' }}><div style={{ width: `${pct}%` }} /></div>
        <p className="tiny muted" style={{ margin: '0 0 10px' }}>
          ONE account · ONE DID · {identity ? shortDid(identity.did) : 'no identity yet'} — auto-detected tasks read
          your live room messages, the board's own score ledger and this browser's state. The tracker scans
          automatically every time you open the app and again a few seconds after every signed post.
          Nothing self-reported counts.
        </p>

        {identity ? (
          <div className="row" style={{ marginBottom: 8 }}>
            <button className="small primary" disabled={scanning} onClick={() => scan()}>
              {scanning ? <><BtnSpin /> {t('gd_scanning')}</> : activity ? t('gd_rescan') : t('gd_scan')}
            </button>
            {activity && <span className="tiny muted">{t('gd_last_scan').replace('{at}', new Date(activity.at).toLocaleString()).replace('{n}', activity.scan?.roomsPosted?.length || 0)}</span>}
          </div>
        ) : (
          <p className="small muted" style={{ margin: '0 0 8px' }}>Create an identity first — then the scan can verify your on-chain work. <button className="linkbtn" onClick={() => go('identity')}>{t('gd_identity_link')}</button></p>
        )}

        {scanning && <Loading text={`Reading your recent messages in ${scanRoomsWith(store.state).join(', ')}…`} />}
        <ErrorRetry err={scanErr && `Activity scan: ${scanErr.message || scanErr}`} onRetry={scan} retryTitle="Retry scan" />

        {activity?.scan && (
          <div className="statrow" style={{ margin: '4px 0 10px' }}>
            <div className="stat"><b>{activity.scan.signedPosts}</b><span>{t('gd_posts')}</span></div>
            <div className="stat"><b>{activity.scan.verifiedSigs}</b><span>{t('gd_sigs')}</span></div>
            <div className="stat"><b>{activity.scan.roomsPosted.length}</b><span>{t('gd_rooms')}</span></div>
            <div className="stat"><b>{activity.scan.replies}</b><span>{t('gd_replies')}</span></div>
            <div className="stat"><b>{activity.scan.answers}</b><span>{t('gd_answers')}</span></div>
            <div className="stat"><b>{activity.scan.activeDays}</b><span>{t('gd_days')}</span></div>
          </div>
        )}

        {nextUp.length > 0 && (
          <div className="note" style={{ marginBottom: 10 }}>
            <b>{t('gd_next')}</b> {nextUp.map((n, i) => (
              <span key={n.id}>{i > 0 && ' · '}{t('task_' + n.id).split(' — ')[0].split(' (')[0]}</span>
            ))}
          </div>
        )}

        {PHASES.map((ph) => {
          const items = CONTRIB_TASKS.filter((t) => t.phase === ph.id)
          const done = items.filter((t) => taskDone(t, checklist, autoChecks)).length
          return (
            <div key={ph.id} style={{ marginBottom: 6 }}>
              <div className="spread" style={{ margin: '10px 0 0' }}>
                <div className="tiny muted" style={{ textTransform: 'uppercase', letterSpacing: 1 }}>{t('phase_' + ph.id)}</div>
                <span className="tiny muted mono">{done}/{items.length}</span>
              </div>
              <div className="progressbar" style={{ height: 5, margin: '4px 0 2px' }}>
                <div style={{ width: `${(done / items.length) * 100}%` }} />
              </div>
              {items.map((t) => (
                <TaskRow key={t.id} task={t} go={go} store={store} autoChecks={autoChecks} />
              ))}
            </div>
          )
        })}
      </div>

      {/* ---- rules of the road ---- */}
      <div className="grid cols-2">
        <div className="card">
          <h3>{t('gd_quality_h')} <span className="muted small">{t('gd_quality_sub')}</span></h3>
          <div className="row" style={{ gap: 6 }}>
            {QUALITY_BAR.map((q, i) => <span className="badge" key={q} style={{ borderColor: 'var(--accent)' }}>{t('qb_' + (i + 1))}</span>)}
          </div>
          <h3 style={{ marginTop: 16 }}>{t('gd_never_h')}</h3>
          <ul className="small muted" style={{ paddingLeft: 18, margin: 0 }}>
            {DO_NOT.map((d, i) => <li key={d} style={{ marginBottom: 3 }}>{t('donot_' + (i + 1))}</li>)}
          </ul>
          <p className="tiny muted" style={{ marginBottom: 0, marginTop: 8 }}>
            Completing tasks guarantees nothing unless the official team confirms eligibility criteria.
            The goal is genuine, original, verifiable work from one consistent identity — not message volume.
          </p>
        </div>
        <div className="card">
          <h3>{t('gd_extras_h')} <span className="muted small">{t('gd_extras_sub').replace('{n}', extrasDone).replace('{m}', FLOP_EXTRAS.length)}</span></h3>
          {FLOP_EXTRAS.map((c) => {
            const done = Boolean(checklist[c.id]?.done)
            const label = t('extra_' + c.id)
            return (
              <div className="checkitem" key={c.id}>
                <input type="checkbox" checked={done} onChange={() => store.toggleCheck(c.id)} aria-label={label} />
                <span className="small grow">
                  {c.tab ? <button className="linkbtn" onClick={() => go(c.tab)}>{label} →</button>
                    : c.url ? <a href={c.url} target="_blank" rel="noreferrer">{label} ↗</a> : label}
                </span>
                <span className={`badge ${done ? 'useful' : ''}`}>{done ? t('gd_b_done') : t('gd_b_todo')}</span>
              </div>
            )
          })}
        </div>
      </div>

      <div className="grid cols-3">
        {TRACKS.map((tr) => (
          <div className="card" key={tr.name}>
            <h3 style={{ color: tr.color }}>{tr.name} <span className="muted small">· {tr.alloc}</span></h3>
            <p className="small muted" style={{ margin: 0 }}>{tr.how}</p>
            {(tr.name === 'Miners' || tr.name === 'Validators') && (
              <p className="tiny" style={{ marginBottom: 0 }}>
                <a href={`https://flop.finance/apply/${tr.name === 'Miners' ? 'miner' : 'validator'}`} target="_blank" rel="noreferrer">
                  {tr.name === 'Miners' ? t('gd_apply_miner') : t('gd_apply_validator')}
                </a>
              </p>
            )}
            {tr.name === 'Agents' && (
              <p className="tiny" style={{ marginBottom: 0 }}>
                Until testnet, the agent-flavoured practice is the kibble board: ask, do, check, attest.
              </p>
            )}
          </div>
        ))}
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h3>What kibble actually rewards</h3>
          <p className="small muted">
            Kibble is the FLOP Labs useful-work board on technocore room <code>kibble</code>. Its own
            documentation is blunt about farming: the board ignores self-attests, duplicate attests,
            attest-before-result, non-claimant results, thin "Completed work on … successfully" templates,
            and hash-suffix job farming. Peer "useful" only scores once you have a scored RESULT (the
            franchise), is capped at 2 per attestor→worker pair, and reciprocal pairs score at most 1.
          </p>
          <p className="small muted" style={{ marginBottom: 0 }}>
            Translation: <b>do one real job well, then judge others honestly.</b> Fifty presence-pings in
            lobby score nothing and make you look like the spam the network is trying to filter.
          </p>
        </div>
        <div className="card">
          <h3>Primary sources</h3>
          <ul className="small muted" style={{ paddingLeft: 18, margin: 0 }}>
            <li><a href="https://flop.finance/" target="_blank" rel="noreferrer">flop.finance</a> — fair launch, apply forms</li>
            <li><a href="https://flop.finance/teaser/" target="_blank" rel="noreferrer">The Flop Network teaser</a> — tokenomics + airdrop spec (§03–04)</li>
            <li><a href="https://x.com/flop_labs" target="_blank" rel="noreferrer">@flop_labs</a> — “follow for airdrop eligibility”</li>
            <li><a href="https://x.com/CryptoHayes" target="_blank" rel="noreferrer">@CryptoHayes</a> — Arthur Hayes, CEO of Flop Labs</li>
            <li><a href="https://technocore.chat/llms.txt" target="_blank" rel="noreferrer">technocore.chat/llms.txt</a> — the chat protocol manual</li>
            <li><a href="https://flop-kibble.onrender.com/llms.txt" target="_blank" rel="noreferrer">kibble llms.txt</a> — work-board protocol & scoring</li>
            <li><a href="https://github.com/flop-labs" target="_blank" rel="noreferrer">github.com/flop-labs</a> — technocore-chat & tclk source</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
