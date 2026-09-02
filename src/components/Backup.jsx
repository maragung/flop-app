import { useRef, useState } from 'react'
import { useStore, backupPayload, parseBackup, encryptedBackup, cookiesRead, cookiesWrite, cookiesClear } from '../lib/store.jsx'
import { decryptPemToSeed, bytesToHex } from '../lib/keyfile.js'
import { copyText } from '../lib/util.js'
import { BtnSpin } from './Retry.jsx'

export default function Backup() {
  const store = useStore()
  const fileRef = useRef(null)
  const [flash, setFlash] = useState('')
  const [err, setErr] = useState('')
  const [pasted, setPasted] = useState('')
  const [wipeStage, setWipeStage] = useState(0)
  const [busyKey, setBusyKey] = useState('') // 'file' | 'paste' | 'cookies' | 'export:file' | 'export:copy'
  const busy = Boolean(busyKey)
  const hasKey = Boolean(store.state.identity?.seedHex)
  // prefill with the identity's key-file passphrase when there is one (it already
  // lives in this browser's localStorage — the export must still ask, not silently use it)
  const [expPass, setExpPass] = useState(store.state.identity?.pass || '')
  const [expPass2, setExpPass2] = useState(store.state.identity?.pass || '')
  const [resPass, setResPass] = useState('')

  const say = (m) => { setFlash(m); setErr('') }

  const doExport = (kind) => {
    setErr(''); setFlash('')
    if (hasKey) {
      if (expPass.length < 12) return setErr('Passphrase must be at least 12 characters')
      if (expPass !== expPass2) return setErr('Passphrases do not match')
    }
    setBusyKey('export:' + kind)
    // PBKDF2 (600k rounds) blocks the thread — let the button paint its busy state first
    setTimeout(() => {
      try {
        const payload = encryptedBackup(store.state, hasKey ? expPass : null)
        const json = JSON.stringify(payload, null, 2)
        if (kind === 'file') {
          const blob = new Blob([json], { type: 'application/json' })
          const a = document.createElement('a')
          a.href = URL.createObjectURL(blob)
          a.download = `flop-toolkit-backup-${new Date().toISOString().slice(0, 10)}.json`
          a.click()
          URL.revokeObjectURL(a.href)
          say('Encrypted backup downloaded. The key inside is protected by your passphrase — the passphrase itself is NOT in the file.')
          store.update((s) => { s.lastBackupAt = new Date().toISOString() })
        } else {
          copyText(json).then(
            () => say('Encrypted backup JSON copied to clipboard. The key inside is protected by your passphrase.'),
            () => { setPasted(json); say('Clipboard blocked — the JSON is in the box on the right; copy it manually.') },
          )
        }
      } catch (e) {
        setErr(`Export failed: ${e.message}`)
      }
      setBusyKey('')
    }, 30)
  }

  const doRestore = (text, key) => {
    setErr(''); setFlash('')
    setBusyKey(key)
    // let the button paint its busy state before the (blocking) confirm + PBKDF2 run
    setTimeout(() => {
      const t0 = Date.now()
      let msg = ''
      try {
        const { state } = parseBackup(text)
        let st = state
        if (st.identity?.encSeed) {
          // encrypted backup: unwrap the key with the export passphrase
          if (!resPass) throw new Error('This backup encrypts the private key — enter the passphrase it was exported with')
          const seed = decryptPemToSeed(st.identity.encSeed, resPass)
          const { encSeed, ...rest } = st.identity
          st = { ...st, identity: { ...rest, seedHex: bytesToHex(seed) } }
        }
        if (confirm('Replace everything in this browser with the backup?')) {
          store.replaceState(st)
          setPasted('')
          msg = 'Restored ✓'
        }
      } catch (e) {
        setErr(`Restore failed: ${e.message}`)
      }
      // hold the busy state for a beat so the click visibly reads as handled
      const wait = Math.max(0, 350 - (Date.now() - t0))
      setTimeout(() => { if (msg) say(msg); setBusyKey('') }, wait)
    }, 60)
  }

  const onFile = async (e) => {
    const f = e.target.files?.[0]
    e.target.value = '' // allow picking the same file twice
    if (!f) return
    setErr(''); setFlash('')
    setBusyKey('file')
    try {
      doRestore(await f.text(), 'file')
    } catch (e2) {
      setErr(`Could not read ${f.name}: ${e2.message || e2}`)
      setBusyKey('')
    }
  }

  const loadCookies = () => {
    setErr(''); setFlash('')
    setBusyKey('cookies')
    setTimeout(() => {
      const t0 = Date.now()
      let msg = ''
      const c = cookiesRead()
      if (!c) {
        setErr('No complete cookie snapshot found')
      } else if (confirm('Load the cookie snapshot? It replaces current state.')) {
        store.replaceState(c)
        msg = 'Loaded from cookies ✓'
      }
      const wait = Math.max(0, 350 - (Date.now() - t0))
      setTimeout(() => { if (msg) say(msg); setBusyKey('') }, wait)
    }, 60)
  }

  const { cookieSave } = store.state.settings
  const cookieInfo = store.cookiesInfo()

  const storageBytes = (() => {
    try { return new Blob([JSON.stringify(store.state)]).size } catch { return 0 }
  })()

  return (
    <div className="grid cols-2">
      <div className="card">
        <h3>Backup (export) <span className="muted small">— key encrypted with your passphrase</span></h3>
        <p className="muted small">
          A complete snapshot: your DID, nickname, checklist, journal, and settings — plus the
          <b> private key, encrypted</b> (PBES2: PBKDF2-SHA256 ×600k + AES-256-CBC, the same format
          openssl reads). Without the passphrase the key inside is unreadable; the passphrase itself
          is never written into the file.
        </p>
        {hasKey && (
          <>
            <label>Backup passphrase (min 12 characters)</label>
            <input type="password" value={expPass} onChange={(e) => setExpPass(e.target.value)} placeholder="encrypts the private key inside the backup" maxLength={256} />
            <label>Repeat passphrase</label>
            <input type="password" value={expPass2} onChange={(e) => setExpPass2(e.target.value)} placeholder="repeat it" maxLength={256} />
            <p className="tiny muted" style={{ margin: '6px 0 0' }}>
              {store.state.identity?.pass
                ? 'Prefilled with this identity’s key-file passphrase — change it here to protect the backup with a different one.'
                : 'Choose a passphrase you will remember — a lost passphrase makes the backup’s key unrecoverable.'}
            </p>
          </>
        )}
        <div className="row" style={{ marginTop: 10 }}>
          <button className="primary" disabled={busy || (hasKey && (!expPass || !expPass2))} onClick={() => doExport('file')}>
            {busyKey === 'export:file' ? <><BtnSpin /> Encrypting…</> : 'Download .json'}
          </button>
          <button disabled={busy || (hasKey && (!expPass || !expPass2))} onClick={() => doExport('copy')}>
            {busyKey === 'export:copy' ? <><BtnSpin /> Encrypting…</> : 'Copy JSON'}
          </button>
        </div>
        {store.state.lastBackupAt && <p className="tiny muted">Last export: {new Date(store.state.lastBackupAt).toLocaleString()}</p>}
        <div className="note warn small" style={{ marginTop: 10 }}>
          Even encrypted, treat the backup like cash: don't paste it into chat rooms or share it
          "for verification". Backups exported by older versions of this app held the key in
          <b> plain text</b> — those still restore (passphrase not needed for them).
        </div>
      </div>

      <div className="card">
        <h3>Restore (import)</h3>
        <p className="muted small">From a backup file or pasted JSON. This replaces the current state.</p>
        <div className="row">
          <button disabled={busy} onClick={() => fileRef.current?.click()}>
            {busyKey === 'file' ? <><BtnSpin /> Reading…</> : 'Choose file…'}
          </button>
          <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={onFile} />
        </div>
        <label style={{ marginTop: 8 }}>Passphrase (needed when the backup encrypts the key)</label>
        <input type="password" value={resPass} onChange={(e) => setResPass(e.target.value)} placeholder="passphrase the backup was exported with" maxLength={256} />
        <label>…or paste backup JSON</label>
        <textarea value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder='{"app":"flop-toolkit",…}' />
        <div style={{ marginTop: 8 }}>
          <button disabled={busy || !pasted.trim()} onClick={() => doRestore(pasted, 'paste')}>
            {busyKey === 'paste' ? <><BtnSpin /> Restoring…</> : 'Restore from pasted JSON'}
          </button>
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
          <button disabled={busy} onClick={loadCookies}>
            {busyKey === 'cookies' ? <><BtnSpin /> Loading…</> : 'Load from cookies'}
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
