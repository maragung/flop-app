import { useState } from 'react'
import { useStore } from '../lib/store.jsx'
import { didFromSeed, randomSeedHex, validateSeedHex, shortDid, hexToBytes, bytesToHex, signRoomMessage, verifyRoomMessage } from '../lib/did.js'
import { seedToPem, encryptSeedToPem, decryptPemToSeed, pemLooksEncrypted } from '../lib/keyfile.js'
import { copyText } from '../lib/util.js'

function KeyField({ label, value, secret = false }) {
  const [show, setShow] = useState(!secret)
  const [copied, setCopied] = useState(false)
  const copy = () => {
    copyText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div>
      <label>{label}</label>
      <div className="keybox" style={{ color: secret && !show ? 'var(--dim)' : 'var(--accent)' }}>
        {show ? value : '•'.repeat(48)}
      </div>
      <div className="row" style={{ marginTop: 6 }}>
        <button className="small ghost" onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'}</button>
        <button className="small ghost" onClick={copy}>{copied ? 'Copied ✓' : 'Copy'}</button>
      </div>
    </div>
  )
}

function download(name, text) {
  const blob = new Blob([text], { type: 'text/plain' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  URL.revokeObjectURL(a.href)
}

const safeName = (nick) => (nick || 'anon').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) || 'anon'

export default function Identity() {
  const store = useStore()
  const { identity } = store.state
  const [importKey_, setImportKey] = useState('')
  const [importPass, setImportPass] = useState('')
  const [nick, setNick] = useState(identity?.nick || '')
  const [newPass, setNewPass] = useState('')
  const [newPass2, setNewPass2] = useState('')
  const [err, setErr] = useState('')
  const [flash, setFlash] = useState('')
  const [busy, setBusy] = useState(false)
  const [pass, setPass] = useState('')
  const [pass2, setPass2] = useState('')

  const importIsPem = importKey_.trim().startsWith('-----')

  const create = async () => {
    setErr(''); setFlash('')
    if (newPass.length < 12) return setErr('Passphrase must be at least 12 characters')
    if (newPass !== newPass2) return setErr('Passphrases do not match')
    setBusy(true)
    // let the button paint its busy state before the (blocking) PBKDF2 run
    setTimeout(async () => {
      try {
        const seedHex = randomSeedHex()
        const did = await didFromSeed(seedHex)
        store.setIdentity({ did, seedHex, nick: nick.trim() || 'anon', pass: newPass, createdAt: new Date().toISOString() })
        store.addJournal('identity', `Created DID ${shortDid(did)}`)
        setNewPass(''); setNewPass2('')
      } catch (e) { setErr(String(e.message || e)) }
      setBusy(false)
    }, 30)
  }

  const importKey = async () => {
    setErr(''); setBusy(true)
    try {
      let seedHex
      if (importIsPem) {
        const seed = decryptPemToSeed(importKey_.trim(), importPass)
        seedHex = bytesToHex(seed)
        setFlash(`Imported PEM key → DID ${shortDid(await didFromSeed(seedHex))}`)
      } else {
        seedHex = validateSeedHex(importKey_)
      }
      const did = await didFromSeed(seedHex)
      store.setIdentity({ did, seedHex, nick: nick.trim() || 'anon', createdAt: new Date().toISOString() })
      store.addJournal('identity', `Imported DID ${shortDid(did)}`)
      setImportKey('')
      setImportPass('')
    } catch (e) { setErr(String(e.message || e)) }
    setBusy(false)
  }

  const downloadTxt = () => {
    download(`${safeName(identity.nick)}-identity.txt`,
      `FLOP Toolkit — did:key identity\nDID: ${identity.did}\nPrivate key (seed, 32 bytes hex): ${identity.seedHex}\nCreated: ${identity.createdAt}\n\nAnyone holding the private key can sign as this DID. Store it somewhere you control.\n`)
  }

  const downloadPem = () => {
    try {
      download(`${safeName(identity.nick)}-identity.pem`, seedToPem(hexToBytes(identity.seedHex)))
      setFlash('Downloaded plain PEM (PKCS#8 Ed25519). Anyone who has this file has your key.')
    } catch (e) { setErr(String(e.message || e)) }
  }

  const downloadPemEnc = (usePass) => {
    setErr(''); setFlash('')
    if (!usePass) {
      if (pass !== pass2) return setErr('Passphrases do not match')
      if (pass.length < 12) return setErr('Passphrase must be at least 12 characters')
      usePass = pass
    }
    setBusy(true)
    // let the button paint its busy state before the (blocking) PBKDF2 run
    setTimeout(() => {
      try {
        download(`${safeName(identity.nick)}-identity.pem`, encryptSeedToPem(hexToBytes(identity.seedHex), usePass))
        setFlash('Downloaded encrypted PEM — PBES2 (PBKDF2-SHA256 ×600k + AES-256-CBC), opens with openssl: openssl pkcs8 -in file.pem -passin pass:…')
      } catch (e) { setErr(String(e.message || e)) }
      setBusy(false)
    }, 30)
  }

  const selfTest = async () => {
    setErr(''); setFlash('')
    try {
      // sign a throwaway payload and verify the signature locally — proves the
      // key in this browser is the key the DID names, without posting anything
      const text = `signing self-test ${new Date().toISOString()}`
      const { sig, nonce, text: swept } = await signRoomMessage(identity.seedHex, 'selftest', text)
      if (!verifyRoomMessage(identity.did, 'selftest', nonce, swept, sig)) {
        throw new Error('Signature did not verify — the key does not match the DID. Re-import your key.')
      }
      store.markSignVerified()
      store.addJournal('identity', 'Signing self-test passed — sign + verify round-trip OK')
      setFlash('Self-test passed ✓ — a test message was signed and the signature verified against your DID (nothing was posted).')
    } catch (e) { setErr(String(e.message || e)) }
  }

  if (!identity) {
    return (
      <div className="grid cols-2">
        <div className="card">
          <h3>Create a new identity</h3>
          <p className="muted small">
            A fresh Ed25519 key pair is generated in this browser with <code>crypto.getRandomValues</code>.
            The public half becomes your <code>did:key:z6Mk…</code> — the same identity format technocore.chat
            and the kibble board verify. Nothing is sent anywhere until you sign a message.
          </p>
          <label>Nickname (for unsigned posts & chat)</label>
          <input value={nick} onChange={(e) => setNick(e.target.value)} placeholder="anon" maxLength={48} />
          <label style={{ marginTop: 10 }}>Passphrase (required, min 12 characters)</label>
          <input type="password" value={newPass} onChange={(e) => setNewPass(e.target.value)} placeholder="encrypts your key file backup" maxLength={256} />
          <label>Repeat passphrase</label>
          <input type="password" value={newPass2} onChange={(e) => setNewPass2(e.target.value)} placeholder="repeat it" maxLength={256} />
          <div style={{ marginTop: 14 }}>
            <button className="primary" disabled={busy} onClick={create}>{busy ? 'Deriving…' : 'Generate key pair'}</button>
          </div>
          <p className="tiny muted" style={{ margin: '8px 0 0' }}>
            The passphrase encrypts the .pem key file you download (PBES2: PBKDF2-SHA256 ×600k + AES-256-CBC).
            It is stored alongside the key in this browser only, so future downloads need no re-entry — but if
            you forget it, an exported encrypted file is unrecoverable.
          </p>
          {err && <div className="error">{err}</div>}
        </div>
        <div className="card">
          <h3>Use an existing key</h3>
          <p className="muted small">
            Paste a 32-byte private key (64 hex characters) — or a PEM file (<code>PRIVATE KEY</code> /
            <code> ENCRYPTED PRIVATE KEY</code>, encrypted with a passphrase) — from a previous FLOP Toolkit
            session or the kibble repo. The DID is re-derived from it.
          </p>
          <label>Private key (hex or PEM)</label>
          <textarea
            value={importKey_}
            onChange={(e) => setImportKey(e.target.value)}
            placeholder="64 hex characters — or paste a -----BEGIN … KEY----- file"
            style={{ minHeight: 96 }}
          />
          {importIsPem && pemLooksEncrypted(importKey_) && (
            <>
              <label>PEM passphrase</label>
              <input type="password" value={importPass} onChange={(e) => setImportPass(e.target.value)} placeholder="passphrase used to encrypt the file" />
            </>
          )}
          <div style={{ marginTop: 14 }}>
            <button disabled={busy || !importKey_.trim()} onClick={importKey}>Import key</button>
          </div>
          {err && <div className="error">{err}</div>}
        </div>
        <div className="card" style={{ gridColumn: '1 / -1' }}>
          <div className="note warn">
            <b>Handle keys like cash.</b> The private key is the only way to sign as your DID. This app is
            100% client-side — the key is stored in your browser's localStorage (and cookies only if you turn
            that on), never on a server. Clearing browser data or switching devices without a backup loses
            the identity. Export a backup from the Backup tab or download the key file below after creating.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="grid cols-2">
      <div className="card">
        <h3>Your identity <span className="muted small">— verified writes everywhere</span></h3>
        <KeyField label="DID (public — share freely)" value={identity.did} />
        <KeyField label="Private key (seed hex — secret!)" value={identity.seedHex} secret />
        <h3 style={{ marginTop: 22 }}>Download the key</h3>
        {identity.pass ? (
          <>
            <div className="row">
              <button className="small primary" disabled={busy} onClick={() => downloadPemEnc(identity.pass)}>{busy ? 'Deriving…' : 'Download encrypted .pem'}</button>
              <button className="small ghost" onClick={downloadTxt}>plain .txt</button>
              <button className="small ghost" onClick={downloadPem}>plain .pem</button>
            </div>
            <p className="tiny muted" style={{ margin: '8px 0 0' }}>
              Encrypted with the passphrase you set when creating this identity (PBES2: PBKDF2-SHA256
              ×600,000 + AES-256-CBC). Any OpenSSL opens it:
              <code> openssl pkcs8 -in {safeName(identity.nick)}-identity.pem -passin pass:YOURPASS</code>.
              The plain files hold the raw key — anyone who has them has your identity.
            </p>
          </>
        ) : (
          <>
            <div className="row">
              <button className="small" onClick={downloadTxt}>Download .txt</button>
              <button className="small" onClick={downloadPem}>Download .pem</button>
            </div>
            <p className="tiny muted" style={{ margin: '8px 0 0' }}>
              The .txt holds the raw seed hex; the .pem is a standard PKCS#8 Ed25519 private key — the same
              format <code>openssl</code>, <code>ssh-keygen</code>-adjacent tooling and most wallets use. Named
              <code> {safeName(identity.nick)}-identity.txt / .pem</code>.
            </p>
            <label style={{ marginTop: 14 }}>Encrypt the PEM with a passphrase (min 12 characters)</label>
            <div className="row">
              <input type="password" style={{ maxWidth: 200 }} placeholder="passphrase (min 12 chars)" value={pass} onChange={(e) => setPass(e.target.value)} />
              <input type="password" style={{ maxWidth: 200 }} placeholder="repeat passphrase" value={pass2} onChange={(e) => setPass2(e.target.value)} />
              <button className="small" disabled={busy || !pass} onClick={() => downloadPemEnc()}>{busy ? 'Deriving…' : 'Download encrypted .pem'}</button>
            </div>
            <p className="tiny muted" style={{ margin: '8px 0 0' }}>
              Encrypted with PBES2 — PBKDF2-HMAC-SHA256 (600,000 rounds) + AES-256-CBC — decrypted by any OpenSSL:
              <code> openssl pkcs8 -in {safeName(identity.nick)}-identity.pem -passin pass:YOURPASS</code>.
              The passphrase is never stored; if you forget it, the file is unrecoverable.
            </p>
          </>
        )}
        {flash && <div className="note" style={{ marginTop: 10 }}>{flash}</div>}
        {err && <div className="error">{err}</div>}
        <div className="row" style={{ marginTop: 10 }}>
          <button
            className="small danger"
            onClick={() => { if (confirm('Remove the identity from this browser? Export a backup first if you have not.')) { store.clearIdentity(); store.addJournal('identity', 'Removed DID from this browser') } }}
          >
            Remove from this browser
          </button>
        </div>
      </div>
      <div className="card">
        <h3>Nickname</h3>
        <p className="muted small">
          Used for unsigned posts. Signed messages always display your DID fingerprint instead —
          <code>~nick</code> means self-asserted, a <code>z6Mk…</code> means key-verified.
        </p>
        <label>Nickname</label>
        <input value={nick} onChange={(e) => setNick(e.target.value)} maxLength={48} />
        <div style={{ marginTop: 10 }}>
          <button onClick={() => { store.setNick(nick.trim() || 'anon'); store.addJournal('identity', `Nickname set to "${nick.trim()}"`) }}>Save</button>
        </div>
        <h3 style={{ marginTop: 22 }}>How signing works here</h3>
        <p className="muted small">
          For every signed write this app builds the canonical string
          <code> room|nonce|text</code> (text after technocore's single-line sweep), signs it with your
          Ed25519 key, and POSTs <code>{'{did, sig, nonce, text}'}</code> to technocore.chat. The nonce is a
          millisecond clock that only ever increases, so captured URLs can't be replayed against you.
        </p>
        <h3 style={{ marginTop: 22 }}>Verify signing works</h3>
        <div className="row">
          <button className="small primary" onClick={selfTest}>
            {store.state.signVerifiedAt ? '↻ Run signing self-test again' : 'Run signing self-test'}
          </button>
          {store.state.signVerifiedAt && (
            <span className="tiny muted">last passed {new Date(store.state.signVerifiedAt).toLocaleString()}</span>
          )}
        </div>
        <p className="tiny muted" style={{ margin: '8px 0 0' }}>
          Signs a throwaway message locally and verifies the signature against your DID — the same
          check technocore's server runs on every signed write. Nothing is posted anywhere. Completes
          task 2 of the contribution checklist automatically.
        </p>
      </div>
    </div>
  )
}
