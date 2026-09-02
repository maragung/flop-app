import { useEffect, useState } from 'react'
import { useStore } from './lib/store.jsx'
import { useI18n, LANGS } from './lib/i18n.js'
import { shortDid } from './lib/did.js'
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

export default function App() {
  const store = useStore()
  const { lang, setLang, t } = useI18n()
  const [tab, setTab] = useState('dashboard')
  const { identity } = store.state
  const theme = store.state.settings.theme === 'light' ? 'light' : 'dark'

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  const labels = Object.fromEntries(TABS.map((x) => [x.id, t(x.key)]))

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
        <span className={`didbadge ${identity ? 'on' : ''}`} title={identity?.did || ''}>
          {identity ? `◈ ${shortDid(identity.did)}` : t('no_identity')}
        </span>
      </header>

      <nav className="navtabs" aria-label="Sections">
        {TABS.map((x) => (
          <button key={x.id} className={tab === x.id ? 'active' : ''} onClick={() => setTab(x.id)}>
            {labels[x.id]}
          </button>
        ))}
      </nav>

      <main>
        {tab === 'dashboard' && <Dashboard go={setTab} />}
        {tab === 'kibble' && <Kibble />}
        {tab === 'chat' && <Chat />}
        {tab === 'guide' && <Guide go={setTab} />}
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

      <nav className="tabbar-mobile" aria-label="Sections">
        {TABS.map((x) => (
          <button key={x.id} className={tab === x.id ? 'active' : ''} onClick={() => setTab(x.id)}>
            <span className="ico" aria-hidden="true">{x.ico}</span>
            {labels[x.id].split(' ')[0]}
          </button>
        ))}
      </nav>
    </div>
  )
}
