import { useRef, useState } from 'react'
import { useStore, backupPayload, parseBackup, cookiesRead, cookiesWrite, cookiesClear } from '../lib/store.jsx'

export default function Backup() {
  const store = useStore()
  const fileRef = useRef(null)
  const [flash, setFlash] = useState('')
  const [err, setErr] = useState('')
  const [pasted, setPasted] = useState('')
  const [wipeStage, setWipeStage] = useState(0)

  const say = (m) => { setFlash(m); setErr('') }

  const exportFile = () => {
    const payload = backupPayload(store.state)
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `flop-toolkit-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(a.href)
    say('Backup file downloaded. It contains your private key — store it somewhere you control.')
    store.update((s) => { s.lastBackupAt = new Date().toISOString() })
  }

  const exportText = async () => {
    const text = JSON.stringify(backupPayload(store.state))
    try {
      await navigator.clipboard.writeText(text)
      say('Backup JSON copied to clipboard. It contains your private key.')
    } catch {
      setPasted(text)
      say('Clipboard blocked — the JSON is in the box below; copy it manually.')
    }
  }

  const doRestore = (text) => {
    try {
      const { state } = parseBackup(text)
      if (!confirm('Replace everything in this browser with the backup?')) return
      store.replaceState(state)
      say('Restored ✓')
      setPasted('')
    } catch (e) {
      setErr(`Restore failed: ${e.message}`)
    }
  }

  const onFile = async (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    doRestore(await f.text())
    e.target.value = ''
  }

  const { cookieSave } = store.state.settings
  const cookieInfo = store.cookiesInfo()

  const storageBytes = (() => {
    try { return new Blob([JSON.stringify(store.state)]).size } catch { return 0 }
  })()

  return (
    <div className="grid cols-2">
      <div className="card">
        <h3>Backup (export)</h3>
        <p className="muted small">
          A complete snapshot: your DID <b>and its private key</b>, nickname, checklist, journal, and settings.
          One JSON file, readable anywhere — including the paste box on the right of any other browser or device.
        </p>
        <div className="row">
          <button className="primary" onClick={exportFile}>Download .json</button>
          <button onClick={exportText}>Copy JSON</button>
        </div>
        {store.state.lastBackupAt && <p className="tiny muted">Last export: {new Date(store.state.lastBackupAt).toLocaleString()}</p>}
        <div className="note warn small" style={{ marginTop: 10 }}>
          The backup includes the private key in plain text. Don't paste it into chat rooms, don't upload it
          to cloud drives you don't control, don't share it "for verification". Anyone with it signs as you.
        </div>
      </div>

      <div className="card">
        <h3>Restore (import)</h3>
        <p className="muted small">From a backup file or pasted JSON. This replaces the current state.</p>
        <div className="row">
          <button onClick={() => fileRef.current?.click()}>Choose file…</button>
          <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={onFile} />
        </div>
        <label>…or paste backup JSON</label>
        <textarea value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder='{"app":"flop-toolkit",…}' />
        <div style={{ marginTop: 8 }}>
          <button disabled={!pasted.trim()} onClick={() => doRestore(pasted)}>Restore from pasted JSON</button>
        </div>
      </div>

      <div className="card">
        <h3>Cookie storage</h3>
        <p className="muted small">
          Your full state (keys included) can live in browser cookies, chunked under the ~4 KB per-cookie
          ceiling. This is the "save to cookie / load from cookie" mode: handy for carrying state between
          normal and private windows on the same machine, or surviving a localStorage wipe.
        </p>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={cookieSave} onChange={(e) => { store.setSetting('cookieSave', e.target.checked); if (e.target.checked) cookiesWrite(store.state) }} />
          auto-save state to cookies on every change
        </label>
        <div className="row" style={{ marginTop: 10 }}>
          <button onClick={() => { const n = cookiesWrite(store.state); n ? say(`Saved to ${n} cookie${n > 1 ? 's' : ''} ✓`) : setErr('Could not write cookies (blocked?)') }}>
            Save to cookies now
          </button>
          <button onClick={() => { const c = cookiesRead(); c ? (confirm('Load the cookie snapshot? It replaces current state.') && (store.replaceState(c), say('Loaded from cookies ✓'))) : setErr('No complete cookie snapshot found') }}>
            Load from cookies
          </button>
          <button className="danger" onClick={() => { cookiesClear(); say('Cookies cleared') }}>Clear cookies</button>
        </div>
        {cookieInfo.count > 0 && <p className="tiny muted">Snapshot present: {cookieInfo.count} chunk(s), written {cookieInfo.at ? new Date(cookieInfo.at).toLocaleString() : 'unknown'}</p>}
        <p className="tiny muted" style={{ marginBottom: 0 }}>
          Note: cookies travel with every request to the origin serving this app — fine for a local/static
          build, a bad idea if you host it on someone else's server.
        </p>
      </div>

      <div className="card">
        <h3>Device & data</h3>
        <div className="statrow">
          <div className="stat"><b>{(storageBytes / 1024).toFixed(1)} KB</b><span>state size</span></div>
          <div className="stat"><b>{store.state.journal.length}</b><span>journal entries</span></div>
          <div className="stat"><b>{store.state.identity ? 'DID ✓' : 'none'}</b><span>identity</span></div>
        </div>
        <p className="muted small" style={{ marginTop: 12 }}>
          Everything lives in this browser (localStorage{cookieSave ? ' + cookies' : ''}). No server, no account, no sync.
        </p>
        {wipeStage === 0 ? (
          <button className="danger" onClick={() => setWipeStage(1)}>Wipe all data from this browser…</button>
        ) : (
          <div className="note bad">
            <p className="small" style={{ margin: '0 0 8px' }}>
              This deletes the identity, journal, checklist and settings from localStorage and cookies.
              Without an exported backup the DID is <b>gone forever</b>.
            </p>
            <div className="row">
              <button className="danger" onClick={() => { store.wipeAll(); setWipeStage(0); say('All local data wiped') }}>Yes, wipe everything</button>
              <button onClick={() => setWipeStage(0)}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      {flash && <div className="note" style={{ gridColumn: '1 / -1' }}>{flash}</div>}
      {err && <div className="error" style={{ gridColumn: '1 / -1' }}>{err}</div>}
    </div>
  )
}
