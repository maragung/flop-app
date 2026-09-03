// store.js — all state lives in this browser: localStorage by default,
// optional cookie persistence (chunked, because a cookie maxes at ~4 KB),
// and full JSON backup/restore. No server, no telemetry, keys never leave
// the device except into technocore.chat messages the user signs on purpose.
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { encryptSeedToPem, hexToBytes } from './keyfile.js'

const LS_KEY = 'flop-toolkit-v1'
const COOKIE_PREFIX = 'ftk'
const COOKIE_CHUNK = 3600 // bytes per cookie, safely under the 4 KB ceiling
// The task list itself lives in tasks.js (merged technocore playbook + FLOP
// airdrop guide, with auto-detection keys consumed by contrib.js).

export function emptyState() {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    identity: null, // { did, seedHex, nick, pass, createdAt }
    prevIdentity: null, // { did, nick, createdAt, removedAt } — last removed identity, so DID rotation can be caught
    settings: { cookieSave: false, autoRefresh: true, lang: 'en', theme: 'dark' },
    checklist: {}, // id -> { done: bool, ts }
    journal: [],   // { id, ts, type, text, url? }
    lastNonces: {}, // room -> last nonce used by our key
    chat: { nick: 'anon', lastRoom: 'lobby' },
    roomVisits: {}, // room -> { n, first, last }
    postedRooms: {}, // room -> ISO ts of the last SIGNED post this app made there (extends the tracker's scan)
    signVerifiedAt: null,
    lastAnnCheck: null,
    autoDone: {}, // auto key -> ISO ts first detected done (sticky: scans only see the recent window)
    activity: null, // { at, did, scan, score } — cached auto-detection scan
    lastBackupAt: null,
  }
}

// crypto.randomUUID only exists in secure contexts (https / localhost).
// On plain http over a LAN IP it's undefined — fall back to a manual v4 UUID.
export function uuid() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

// ---- localStorage ---------------------------------------------------------

export function lsSave(state) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(state)) } catch { /* quota/private mode */ }
}

export function lsLoad() {
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

export function lsClear() {
  try { localStorage.removeItem(LS_KEY) } catch { /* ignore */ }
}

// ---- cookies (chunked) ----------------------------------------------------

function setCookie(name, value, days = 365) {
  const exp = new Date(Date.now() + days * 864e5).toUTCString()
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${exp}; path=/; SameSite=Lax`
}

function getCookie(name) {
  const m = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'))
  return m ? decodeURIComponent(m[1]) : null
}

export function cookiesWrite(state) {
  try {
    const json = JSON.stringify(state)
    const chunks = []
    for (let i = 0; i < json.length; i += COOKIE_CHUNK) chunks.push(json.slice(i, i + COOKIE_CHUNK))
    // clear stale chunks from a previous, larger save
    const oldCount = getCookie(`${COOKIE_PREFIX}n`)
    if (oldCount) for (let i = Number(oldCount); i < chunks.length + 32; i++) setCookie(`${COOKIE_PREFIX}${i}`, '', -1)
    chunks.forEach((c, i) => setCookie(`${COOKIE_PREFIX}${i}`, c))
    setCookie(`${COOKIE_PREFIX}n`, String(chunks.length))
    setCookie(`${COOKIE_PREFIX}t`, new Date().toISOString())
    return chunks.length
  } catch {
    return 0
  }
}

export function cookiesRead() {
  try {
    const n = Number(getCookie(`${COOKIE_PREFIX}n`))
    if (!n || n < 1) return null
    let json = ''
    for (let i = 0; i < n; i++) {
      const c = getCookie(`${COOKIE_PREFIX}${i}`)
      if (c == null) return null // incomplete — unusable
      json += c
    }
    return JSON.parse(json)
  } catch { return null }
}

export function cookiesClear() {
  const n = Number(getCookie(`${COOKIE_PREFIX}n`)) || 40
  for (let i = 0; i < n; i++) setCookie(`${COOKIE_PREFIX}${i}`, '', -1)
  setCookie(`${COOKIE_PREFIX}n`, '', -1)
  setCookie(`${COOKIE_PREFIX}t`, '', -1)
}

// ---- backup / restore -----------------------------------------------------

export function backupPayload(state) {
  return {
    app: 'flop-toolkit',
    version: 1,
    exportedAt: new Date().toISOString(),
    state,
  }
}

export function parseBackup(text) {
  const obj = JSON.parse(text)
  const st = obj.state ?? obj
  if (!st || typeof st !== 'object' || !('identity' in st) || !('journal' in st)) {
    throw new Error('Not a FLOP Toolkit backup (missing identity/journal)')
  }
  return { backup: obj.app ? obj : null, state: st }
}

// Encrypted backup — the private key never leaves the browser in plain text.
// The seed is wrapped as a PBES2 encrypted PEM (the same scheme as the Identity
// tab's key files, readable by openssl) under `identity.encSeed`; the stored
// key-file passphrase and the raw seed are stripped from the payload. Everything
// else (journal, checklist, settings) stays plain so the file remains inspectable.
export function encryptedBackup(state, passphrase) {
  const copy = JSON.parse(JSON.stringify(state))
  const payload = backupPayload(copy)
  const id = payload.state.identity
  if (id) {
    delete id.pass
    if (id.seedHex) {
      if (!passphrase) throw new Error('A passphrase is required to encrypt the key')
      payload.keyEnc = 'PBES2 (PBKDF2-SHA256 ×600k + AES-256-CBC)'
      id.encSeed = encryptSeedToPem(hexToBytes(id.seedHex), passphrase)
      delete id.seedHex
    }
  }
  return payload
}

// ---- React context --------------------------------------------------------

const StoreCtx = createContext(null)

export function StoreProvider({ children }) {
  // merge saved state over fresh defaults, so old saves gain the new fields
  const [state, setState] = useState(() => {
    const loaded = lsLoad()
    return loaded ? { ...emptyState(), ...loaded } : emptyState()
  })
  const first = useRef(true)

  useEffect(() => {
    if (first.current) { first.current = false; return }
    lsSave(state)
    if (state.settings.cookieSave) cookiesWrite(state)
  }, [state])

  const api = useMemo(() => {
    // fn mutates the clone and usually returns nothing — hand back the clone
    // in that case, so a missing `return` can never nuke the state.
    const update = (fn) => setState((s) => {
      const next = structuredClone(s)
      const out = fn(next)
      return out === undefined ? next : out
    })
    return {
      state,
      update,
      setIdentity: (identity) => update((s) => {
        // re-importing the DID that was removed is a restore, not a rotation —
        // only a genuinely different DID keeps prevIdentity around as a signal
        if (s.prevIdentity && s.prevIdentity.did === identity.did) s.prevIdentity = null
        s.identity = identity
      }),
      clearIdentity: () => update((s) => {
        // remember the DID (never the key) so the create/import panel can warn
        // if a DIFFERENT identity shows up afterwards — rotation is never-do #1
        if (s.identity) s.prevIdentity = { did: s.identity.did, nick: s.identity.nick, createdAt: s.identity.createdAt, removedAt: new Date().toISOString() }
        s.identity = null
      }),
      setNick: (nick) => update((s) => { if (s.identity) s.identity.nick = nick; s.chat.nick = nick }),
      toggleCheck: (id) => update((s) => {
        s.checklist[id] = { done: !s.checklist[id]?.done, ts: new Date().toISOString() }
      }),
      addJournal: (type, text, url) => update((s) => {
        const entry = { id: uuid(), ts: new Date().toISOString(), type, text: String(text).slice(0, 500) }
        if (url) entry.url = String(url).slice(0, 500)
        s.journal.unshift(entry)
        if (s.journal.length > 500) s.journal.length = 500
      }),
      visitRoom: (room) => update((s) => {
        const v = s.roomVisits[room] || { n: 0, first: new Date().toISOString() }
        s.roomVisits[room] = { n: v.n + 1, first: v.first, last: new Date().toISOString() }
      }),
      notePostedRoom: (room) => update((s) => { s.postedRooms[room] = new Date().toISOString() }),
      markSignVerified: () => update((s) => { s.signVerifiedAt = new Date().toISOString() }),
      markAutoDones: (keys) => update((s) => {
        const fresh = (keys || []).filter((k) => k && !s.autoDone[k])
        if (!fresh.length) return s // nothing new — return the same object so React bails out
        const ts = new Date().toISOString()
        fresh.forEach((k) => { s.autoDone[k] = ts })
      }),
      markAnnCheck: () => update((s) => {
        const today = new Date().toISOString().slice(0, 10)
        const lastDay = s.lastAnnCheck ? String(s.lastAnnCheck).slice(0, 10) : null
        s.lastAnnCheck = new Date().toISOString()
        if (lastDay !== today) {
          s.journal.unshift({ id: uuid(), ts: new Date().toISOString(), type: 'manual', text: 'Checked official channels (@flop_labs, flop.finance) for airdrop announcements' })
        }
      }),
      setActivity: (data) => update((s) => { s.activity = data }),
      removeJournal: (id) => update((s) => { s.journal = s.journal.filter((j) => j.id !== id) }),
      setSetting: (k, v) => update((s) => { s.settings[k] = v }),
      noteNonce: (room, nonce) => update((s) => {
        const n = Number(nonce)
        if (!s.lastNonces[room] || n > s.lastNonces[room]) s.lastNonces[room] = n
      }),
      setChatRoom: (room) => update((s) => { s.chat.lastRoom = room }),
      replaceState: (next) => setState(next),
      cookiesInfo: () => ({ count: Number(getCookie(`${COOKIE_PREFIX}n`)) || 0, at: getCookie(`${COOKIE_PREFIX}t`) }),
      wipeAll: () => { lsClear(); cookiesClear(); setState(emptyState()) },
    }
  }, [state])

  return <StoreCtx.Provider value={api}>{children}</StoreCtx.Provider>
}

export function useStore() {
  const ctx = useContext(StoreCtx)
  if (!ctx) throw new Error('useStore outside StoreProvider')
  return ctx
}
