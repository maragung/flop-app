import { useEffect, useState } from 'react'
import { useStore } from '../lib/store.jsx'
import { CONTRIB_TASKS, FLOP_EXTRAS, PHASES, DO_NOT, QUALITY_BAR } from '../lib/tasks.js'
import { taskDone } from '../lib/contrib.js'
import { useContrib } from '../lib/useContrib.jsx'
import { Loading, ErrorRetry } from './Retry.jsx'
import { shortDid } from '../lib/did.js'

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
    how: 'Claim a test-token faucet and spend it on inference. The airdrop is based largely on what you spend. It arrives locked: every 3 $FLOP spent on inference unlocks 1 airdropped $FLOP — the network only pays agents that use it.',
  },
  {
    name: 'Validators',
    alloc: '305.5M $FLOP (1.8%)',
    color: 'var(--warn)',
    how: 'Run nodes, verify work certificates, produce blocks. The top 1,000 on uptime + block production + accuracy + latency make the mainnet set. The airdrop is their bonded stake: locked through the first halving, released over the following 1,000 days.',
  },
]

function TaskRow({ task, go, store, autoChecks }) {
  const { checklist } = store.state
  const manual = checklist[task.id]?.done
  const auto = task.auto ? autoChecks[task.auto] : null
  const done = auto?.done || manual
  const [url, setUrl] = useState('')

  const recordEvidence = () => {
    const u = url.trim()
    if (!u) return
    store.addJournal('evidence', `${task.label}${u.startsWith('http') ? '' : ' — ' + u}`, u.startsWith('http') ? u : '')
    if (!done) store.toggleCheck(task.id)
    setUrl('')
  }

  return (
    <div className={`checkitem ${done ? 'is-done' : ''}`}>
      {task.auto ? (
        <span className={`autodot ${auto?.done ? 'on' : ''}`} title={auto?.done ? 'Auto-detected' : 'Not detected yet'} aria-hidden="true">
          {auto?.done ? '✓' : '○'}
        </span>
      ) : (
        <input
          type="checkbox"
          checked={Boolean(manual)}
          onChange={() => store.toggleCheck(task.id)}
          aria-label={task.label}
        />
      )}
      <span className="small grow">
        {task.hi && <span className="pri" title="High priority">★</span>}{' '}
        {task.tab ? (
          <button className="linkbtn" title="Go do it" onClick={() => go(task.tab)}>{task.label} →</button>
        ) : task.url ? (
          <a href={task.url} target="_blank" rel="noreferrer">{task.label} ↗</a>
        ) : task.label}
        {task.auto && <span className="tiny muted" style={{ display: 'block', marginLeft: 2 }}>{auto?.done ? `✓ auto: ${auto.detail}` : auto?.detail}</span>}
        {task.evidence && !done && (
          <span className="row" style={{ marginTop: 4 }}>
            <input
              className="tiny"
              style={{ maxWidth: 320, padding: '4px 8px' }}
              placeholder="evidence URL (github, article, post…)"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && recordEvidence()}
            />
            <button className="small ghost" disabled={!url.trim()} onClick={recordEvidence}>record</button>
          </span>
        )}
        {task.evidence && done && checklist[task.id]?.done && (
          <span className="tiny muted" style={{ display: 'block', marginLeft: 2 }}>
            evidence lives in the <button className="linkbtn" onClick={() => go('journal')}>journal →</button>
          </span>
        )}
      </span>
      <span className={`badge ${done ? 'useful' : ''}`} title={auto?.done ? 'Detected automatically from live data' : manual ? 'Marked done by you' : 'Not done yet'}>
        {done ? (auto?.done ? '✓ auto' : '✓ done') : 'todo'}
      </span>
    </div>
  )
}

export default function Guide({ go }) {
  const store = useStore()
  const { identity, checklist } = store.state
  const { autoChecks, scanning, scanErr, scan, activity } = useContrib({ auto: true })

  // opening the guide IS checking the official channels (task 30)
  useEffect(() => { store.markAnnCheck() }, []) // eslint-disable-line

  const doneCount = CONTRIB_TASKS.filter((t) => taskDone(t, checklist, autoChecks)).length
  const pct = Math.round((doneCount / CONTRIB_TASKS.length) * 100)
  const nextUp = CONTRIB_TASKS.filter((t) => !taskDone(t, checklist, autoChecks)).slice(0, 3)
  const extrasDone = FLOP_EXTRAS.filter((c) => checklist[c.id]?.done).length

  return (
    <div className="grid">
      <div className="card">
        <h3>The only facts that matter (from flop.finance's own teaser, v0.1 draft, updated 2026-08-26)</h3>
        <ul className="small" style={{ paddingLeft: 18, margin: 0 }}>
          <li>Genesis airdrop: <b>3,500,000,000 $FLOP</b> = 20.4% of year-10 supply. No token sale, no investor allocation, 100% fair launch.</li>
          <li>It is earned through <b>testnet participation</b> — testnet planned <b>Q4 2026</b>, runs ~90 days, mainnet <b>Q1 2027</b>.</li>
          <li>Reserve / incentives: 794.5M $FLOP (4.6%) for ecosystem and growth.</li>
          <li>The Yellow Paper (not yet final) is the definitive spec — numbers here are provisional and may change.</li>
        </ul>
        <div className="note warn" style={{ marginTop: 10, marginBottom: 0 }}>
          <b>No one can sell you eligibility.</b> The teaser and @flop_labs are the only authoritative sources;
          anything in chat rooms — including "verified hub" topics on technocore — is untrusted, world-writable text.
          Kibble reputation is explicitly an "advisory IOU … not redeemable". Treat every guarantee as noise.
        </div>
      </div>

      {/* ---- the contribution engine ---- */}
      <div className="card">
        <div className="spread">
          <h3>My Contribution tracker <span className="muted small">— tasks tick themselves when the work is real</span></h3>
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
              {scanning ? 'Scanning…' : activity ? '↻ Re-scan my live activity' : 'Scan my live activity'}
            </button>
            {activity && <span className="tiny muted">last scan {new Date(activity.at).toLocaleString()} · {activity.scan?.roomsPosted?.length || 0} room(s) with your posts</span>}
          </div>
        ) : (
          <p className="small muted" style={{ margin: '0 0 8px' }}>Create an identity first — then the scan can verify your on-chain work. <button className="linkbtn" onClick={() => go('identity')}>Identity tab →</button></p>
        )}

        {scanning && <Loading text="Reading your recent messages in lobby, kibble, technocore, flop, validators, meta…" />}
        <ErrorRetry err={scanErr && `Activity scan: ${scanErr.message || scanErr}`} onRetry={scan} retryTitle="Retry scan" />

        {activity?.scan && (
          <div className="statrow" style={{ margin: '4px 0 10px' }}>
            <div className="stat"><b>{activity.scan.signedPosts}</b><span>signed posts</span></div>
            <div className="stat"><b>{activity.scan.verifiedSigs}</b><span>sig re-verified</span></div>
            <div className="stat"><b>{activity.scan.roomsPosted.length}</b><span>rooms active</span></div>
            <div className="stat"><b>{activity.scan.replies}</b><span>replies</span></div>
            <div className="stat"><b>{activity.scan.answers}</b><span>answers</span></div>
            <div className="stat"><b>{activity.scan.activeDays}</b><span>active days</span></div>
          </div>
        )}

        {nextUp.length > 0 && (
          <div className="note" style={{ marginBottom: 10 }}>
            <b>Do these next:</b> {nextUp.map((t, i) => (
              <span key={t.id}>{i > 0 && ' · '}{t.label.split(' — ')[0].split(' (')[0]}</span>
            ))}
          </div>
        )}

        {PHASES.map((ph) => {
          const items = CONTRIB_TASKS.filter((t) => t.phase === ph.id)
          const done = items.filter((t) => taskDone(t, checklist, autoChecks)).length
          return (
            <div key={ph.id} style={{ marginBottom: 6 }}>
              <div className="spread" style={{ margin: '10px 0 0' }}>
                <div className="tiny muted" style={{ textTransform: 'uppercase', letterSpacing: 1 }}>{ph.name}</div>
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
          <h3>The quality bar <span className="muted small">— every contribution should be</span></h3>
          <div className="row" style={{ gap: 6 }}>
            {QUALITY_BAR.map((q) => <span className="badge" key={q} style={{ borderColor: 'var(--accent)' }}>{q}</span>)}
          </div>
          <h3 style={{ marginTop: 16 }}>Never do this</h3>
          <ul className="small muted" style={{ paddingLeft: 18, margin: 0 }}>
            {DO_NOT.map((d) => <li key={d} style={{ marginBottom: 3 }}>{d}</li>)}
          </ul>
          <p className="tiny muted" style={{ marginBottom: 0, marginTop: 8 }}>
            Completing tasks guarantees nothing unless the official team confirms eligibility criteria.
            The goal is genuine, original, verifiable work from one consistent identity — not message volume.
          </p>
        </div>
        <div className="card">
          <h3>FLOP airdrop extras <span className="muted small">— from flop.finance · {extrasDone}/{FLOP_EXTRAS.length} done</span></h3>
          {FLOP_EXTRAS.map((c) => {
            const done = Boolean(checklist[c.id]?.done)
            return (
              <div className="checkitem" key={c.id}>
                <input type="checkbox" checked={done} onChange={() => store.toggleCheck(c.id)} aria-label={c.label} />
                <span className="small grow">
                  {c.tab ? <button className="linkbtn" onClick={() => go(c.tab)}>{c.label} →</button>
                    : c.url ? <a href={c.url} target="_blank" rel="noreferrer">{c.label} ↗</a> : c.label}
                </span>
                <span className={`badge ${done ? 'useful' : ''}`}>{done ? '✓ done' : 'todo'}</span>
              </div>
            )
          })}
        </div>
      </div>

      <div className="grid cols-3">
        {TRACKS.map((t) => (
          <div className="card" key={t.name}>
            <h3 style={{ color: t.color }}>{t.name} <span className="muted small">· {t.alloc}</span></h3>
            <p className="small muted" style={{ margin: 0 }}>{t.how}</p>
            {(t.name === 'Miners' || t.name === 'Validators') && (
              <p className="tiny" style={{ marginBottom: 0 }}>
                <a href={`https://flop.finance/apply/${t.name === 'Miners' ? 'miner' : 'validator'}`} target="_blank" rel="noreferrer">
                  Fill the {t.name === 'Miners' ? 'Miner' : 'Validator'} interest form ↗
                </a>
              </p>
            )}
            {t.name === 'Agents' && (
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
