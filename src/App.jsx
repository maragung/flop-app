import { useEffect, useRef, useState } from 'react'
import { useStore } from './lib/store.jsx'
import { useI18n, LANGS } from './lib/i18n.js'
import { shortDid } from './lib/did.js'
import { copyText } from './lib/util.js'
import { refreshActivity, taskDone } from './lib/contrib.js'
import { CONTRIB_TASKS } from './lib/tasks.js'
import { useContrib } from './lib/useContrib.jsx'
import Dashboard from './components/Dashboard.jsx'
import Identity from './components/Identity.jsx'
import Kibble from './components/Kibble.jsx'
import Chat from './components/Chat.jsx'
import Guide from './components/Guide.jsx'
import Tokenomics from './components/Tokenomics.jsx'
import Roadmap from './components/Roadmap.jsx'
import Journal from './components/Journal.jsx'
import Backup from './components/Backup.jsx'

const TABS = [
  { id: 'dashboard', key: 'tab_dashboard', ico: '◎' },
  { id: 'kibble', key: 'tab_kibble', ico: '▩' },
  { id: 'chat', key: 'tab_chat', ico: '✦' },
  { id: 'guide', key: 'tab_guide', ico: '◈' },
  { id: 'tokenomics', key: 'tab_tokenomics', ico: '⬢' },
  { id: 'roadmap', key: 'tab_roadmap', ico: '◷' },
  { id: 'identity', key: 'tab_identity', ico: '🔑' },
  { id: 'journal', key: 'tab_journal', ico: '✎' },
  { id: 'backup', key: 'tab_backup', ico: '⤓' },
]

// Global toast: whenever a contribution task completes — by a background scan
// (app open, post-signed re-scan) or a manual tick — announce it, whatever tab
// is on screen. Also fires a browser notification when permission is granted.
function TaskToast({ go }) {
  const store = useStore()
  const { autoChecks } = useContrib({ auto: false })
  const [toast, setToast] = useState(null)
  const prevIds = useRef(null)
  const doneTasks = CONTRIB_TASKS.filter((c) => taskDone(c, store.state.checklist, autoChecks))
  const ids = doneTasks.map((c) => c.id).join(',')

  useEffect(() => {
    const cur = new Set(ids ? ids.split(',') : [])
    if (prevIds.current == null) { prevIds.current = cur; return } // baseline on first render
    const fresh = doneTasks.filter((c) => !prevIds.current.has(c.id))
    prevIds.current = cur
    if (!fresh.length) return
    setToast({ n: fresh.length, label: fresh[0].label.split(' — ')[0].split(' (')[0] })
    try {
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('FLOP Toolkit', {
          body: `✓ ${fresh.length > 1 ? `${fresh.length} tasks completed` : 'Task completed'} — ${fresh[0].label.slice(0, 90)}`,
        })
      }
    } catch { /* notifications unavailable (e.g. insecure context) */ }
    const t = setTimeout(() => setToast(null), 7000)
    return () => clearTimeout(t)
  }, [ids]) // eslint-disable-line

  if (!toast) return null
  return (
    <div className="tasktoast" role="status" aria-live="polite">
      <b style={{ color: 'var(--good)' }}>✓ {toast.n > 1 ? `${toast.n} tasks completed` : 'Task completed'}</b>
      <span className="small">{toast.label}{toast.n > 1 ? ` (+${toast.n - 1} more)` : ''}</span>
      <button className="small ghost" onClick={() => { setToast(null); go('guide') }}>View tracker →</button>
    </div>
  )
}

// Tabs live in the URL hash (#kibble, #guide…) so a reload / shared link /
// the back button all land on the same tab.
const tabFromHash = () => {
  const h = window.location.hash.replace(/^#/, '')
  return TABS.some((x) => x.id === h) ? h : 'dashboard'
}

export default function App() {
  const store = useStore()
  const { lang, setLang, t } = useI18n()
  const [tab, setTab] = useState(tabFromHash)
  const [copiedDid, setCopiedDid] = useState(false)
  const { identity } = store.state
  const theme = store.state.settings.theme === 'light' ? 'light' : 'dark'

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  // scan on every app open: re-read the rooms + score ledger in the background
  // so the tracker reflects your latest activity before you even open the Guide
  useEffect(() => {
    const did = store.state.identity?.did
    if (!did) return
    refreshActivity(did).then((a) => store.setActivity(a)).catch(() => {})
  }, []) // eslint-disable-line

  useEffect(() => {
    const onHash = () => setTab(tabFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const go = (id) => {
    if (TABS.some((x) => x.id === id)) window.location.hash = id
  }

  const labels = Object.fromEntries(TABS.map((x) => [x.id, t(x.key)]))

  // the tab name in the title bar — also proves language switching at a glance
  useEffect(() => {
    document.title = `${labels[tab]} · FLOP Toolkit`
  }, [tab, lang]) // eslint-disable-line

  const copyDid = () => {
    copyText(identity.did).then(() => {
      setCopiedDid(true)
      setTimeout(() => setCopiedDid(false), 1500)
    })
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="chip" aria-hidden="true" />
          <span>
            FLOP TOOLKIT
            <small>{t('subtitle')}</small>
          </span>
        </div>
        <div className="topbar-actions">
          <label className="langwrap" title={t('language')}>
            <span aria-hidden="true">🌐</span>
            <select
              className="langsel"
              value={lang}
              onChange={(e) => setLang(e.target.value)}
              aria-label={t('language')}
            >
              {LANGS.map((l) => <option key={l.code} value={l.code}>{l.native}</option>)}
            </select>
          </label>
          <button
            className="iconbtn"
            onClick={() => store.setSetting('theme', theme === 'dark' ? 'light' : 'dark')}
            title={t('toggle_theme')}
            aria-label={t('toggle_theme')}
          >
            {theme === 'dark' ? '☀' : '🌙'}
          </button>
        </div>
        <button
          type="button"
          className={`didbadge ${identity ? 'on' : ''}`}
          title={identity ? identity.did + ' — click to copy' : ''}
          onClick={identity ? copyDid : undefined}
          disabled={!identity}
        >
          {identity ? (copiedDid ? '✓ copied' : `◈ ${shortDid(identity.did)}`) : t('no_identity')}
        </button>
      </header>

      <nav className="navtabs" aria-label="Sections">
        {TABS.map((x) => (
          <button key={x.id} className={tab === x.id ? 'active' : ''} aria-current={tab === x.id ? 'page' : undefined} onClick={() => go(x.id)}>
            {labels[x.id]}
          </button>
        ))}
      </nav>

      <main>
        {tab === 'dashboard' && <Dashboard go={go} />}
        {tab === 'kibble' && <Kibble />}
        {tab === 'chat' && <Chat />}
        {tab === 'guide' && <Guide go={go} />}
        {tab === 'tokenomics' && <Tokenomics />}
        {tab === 'roadmap' && <Roadmap />}
        {tab === 'identity' && <Identity />}
        {tab === 'journal' && <Journal />}
        {tab === 'backup' && <Backup />}
      </main>

      <footer className="appfoot">
        <span className="muted tiny">dibuat oleh</span>{' '}
        <a href="https://x.com/0xMaragung" target="_blank" rel="noreferrer">0xMaragung</a>
      </footer>

      <TaskToast go={go} />

      <nav className="tabbar-mobile" aria-label="Sections">
        {TABS.map((x) => (
          <button key={x.id} className={tab === x.id ? 'active' : ''} aria-current={tab === x.id ? 'page' : undefined} onClick={() => go(x.id)}>
            <span className="ico" aria-hidden="true">{x.ico}</span>
            {labels[x.id].split(' ')[0]}
          </button>
        ))}
      </nav>
    </div>
  )
}
