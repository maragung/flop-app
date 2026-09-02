import { useState } from 'react'
import { useStore } from '../lib/store.jsx'

const TYPE_COLORS = {
  identity: 'var(--accent)',
  kibble: 'var(--good)',
  chat: 'var(--dim)',
  manual: 'var(--warn)',
  evidence: 'var(--good)',
}

// contribution types that count as publishable evidence for the checklist
const CONTRIB_TYPES = [
  ['tutorial', 'Tutorial'],
  ['tool', 'Tool / utility'],
  ['research', 'Research / analysis'],
  ['docs', 'Documentation'],
  ['integration', 'Integration'],
  ['bug', 'Bug report'],
  ['experiment', 'Experiment'],
  ['translation', 'Translation'],
  ['educational', 'Educational content'],
  ['manual', 'Other note'],
]

export default function Journal() {
  const store = useStore()
  const { journal } = store.state
  const [text, setText] = useState('')
  const [url, setUrl] = useState('')
  const [type, setType] = useState('manual')
  const [filter, setFilter] = useState('all')

  const add = () => {
    const t = text.trim()
    if (!t) return
    store.addJournal(type, t, url.trim() || undefined)
    setText('')
    setUrl('')
  }

  const types = ['all', ...new Set(journal.map((j) => j.type))]
  const shown = filter === 'all' ? journal : journal.filter((j) => j.type === filter)
  const evidenceCount = journal.filter((j) => j.url).length

  return (
    <div className="grid">
      <div className="card">
        <h3>Contribution journal <span className="muted small">— every action you take in this app is logged here, plus your evidence</span></h3>
        <div className="row">
          <select value={type} onChange={(e) => setType(e.target.value)} style={{ width: 'auto' }} aria-label="Entry type">
            {CONTRIB_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <input
            className="grow"
            placeholder="Title — e.g. 'Tutorial: connect an agent to technocore', 'Bug: nonce reuse on …'"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && text.trim() && !url.trim()) add() }}
          />
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <input
            className="grow"
            style={{ maxWidth: 480 }}
            placeholder="Public evidence URL (optional — github repo, article, post link…)"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && text.trim()) add() }}
          />
          <button disabled={!text.trim()} onClick={add}>Add entry</button>
        </div>
        <p className="tiny muted" style={{ margin: '8px 0 0' }}>
          Evidence entries (title + public URL, attributed to your DID) are what the checklist's Phase 5
          tasks look for — the record is the contribution history the airdrop playbook asks you to keep.
          Currently <b>{evidenceCount}</b> evidence entr{evidenceCount === 1 ? 'y' : 'ies'} with a URL.
        </p>
        <div className="row" style={{ marginTop: 10 }}>
          {types.map((t) => (
            <button key={t} className={`small ${filter === t ? 'primary' : 'ghost'}`} onClick={() => setFilter(t)}>{t}</button>
          ))}
          <span className="grow" />
          {journal.length > 0 && (
            <button
              className="small danger"
              onClick={() => confirm('Clear the whole journal? (Your identity and checklist are kept)') && journal.forEach((j) => store.removeJournal(j.id))}
            >
              Clear all
            </button>
          )}
        </div>
      </div>

      <div className="card">
        {journal.length === 0 && <p className="muted small">Nothing logged yet. Actions on the kibble board and chat will appear automatically; add your off-app contributions above with their URLs.</p>}
        {shown.map((j) => (
          <div className="journalitem" key={j.id}>
            <div className="spread">
              <span className="when">{new Date(j.ts).toLocaleString()} · <span style={{ color: TYPE_COLORS[j.type] || 'var(--dim)' }}>{j.type}</span></span>
              <button className="small ghost" onClick={() => store.removeJournal(j.id)} title="Delete entry">✕</button>
            </div>
            <div>{j.text}</div>
            {j.url && (
              <div className="tiny"><a href={j.url} target="_blank" rel="noreferrer">{j.url} ↗</a></div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
