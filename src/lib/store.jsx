// store.js — all state lives in this browser: localStorage by default, a
// COMPACT cookie mirror (auto-saved on every change when cookieSave is on) as
// a wipe/private-window recovery path, and full JSON backup/restore. No server,
// no telemetry, keys never leave the device except into technocore.chat
// messages the user signs on purpose.
//
// Why compact: cookies ride on EVERY request to the origin. The whole state
// (journal, server snapshots…) can exceed the 16 KB request-header ceiling a
// Node server allows, and once the Cookie header is that big the page itself
// 431s and can never load to clear it. So the cookie mirror keeps only the
// irreplaceable core — identity+key, settings, checklist, autoDone, the
// monotonic "ever" tracker and the recent journal — under a hard byte budget.
// Full history lives in localStorage and in file backups.
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { encryptSeedToPem, hexToBytes } from './keyfile.js'
import { mergeEver } from './ever.js'

const LS_KEY = 'flop-toolkit-v1'
const COOKIE_PREFIX = 'ftk'
const COOKIE_CHUNK = 3600 // encoded bytes per cookie, safely under the 4 KB ceiling
const COOKIE_BUDGET = 6000 // max encoded bytes for the whole cookie mirror — keeps the request header under ~8 KB even on strict servers
const COOKIE_MAX_CHUNKS = 64 // hard ceiling on chunk indices, so a shrink can always be fully cleaned
// The task list itself lives in tasks.js (merged technocore playbook + FLOP
// airdrop guide, with auto-detection keys consumed by contrib.js).

export function emptyState() {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    identity: null, // { did, seedHex, nick, pass, createdAt }
    prevIdentity: null, // { did, nick, createdAt, removedAt } — last removed identity, so DID rotation can be caught
    settings: { cookieSave: true, autoRefresh: true, scanEvery: '5m', lang: 'en', theme: 'dark' },
    checklist: {}, // id -> { done: bool, ts }
    journal: [],   // { id, ts, type, text, url? }
    lastNonces: {}, // room -> last nonce used by our key
    chat: { nick: 'anon', lastRoom: 'lobby' },
    roomVisits: {}, // room -> { n, first, last }
    postedRooms: {}, // room -> ISO ts of the last SIGNED post this app made there (extends the tracker's scan)
    tweetsUsed: {}, // task id -> [[openerKey, closerKey], …] tweet combinations already shared (anti-duplicate)
    signVerifiedAt: null,
    lastAnnCheck: null,
    autoDone: {}, // auto key -> ISO ts first detected done (sticky: scans only see the recent window)
    activity: null, // { at, did, scan, score } — cached auto-detection scan
    ever: {}, // did -> monotonic contribution record (see lib/ever.js) — never shrinks
    lastGood: {}, // cacheKey -> { did?, at, data } — last-known-good server snapshots so a reload or backend hiccup never blanks a stats card
    lastBackupAt: null,
  }
}

// Merge a saved snapshot over fresh defaults — but keep the settings merge DEEP,
// so a snapshot saved before a setting existed still picks up that default, and
// a user who explicitly turned a setting OFF keeps it off.
export function mergeDefaults(src) {
  if (!src || typeof src !== 'object') return emptyState()
  const base = emptyState()
  const out = { ...base, ...src }
  out.settings = { ...base.settings, ...(src.settings || {}) }
  if (!out.lastGood || typeof out.lastGood !== 'object') out.lastGood = {}
  if (!out.ever || typeof out.ever !== 'object') out.ever = {}
  return out
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

// encodeURIComponent leaves these characters as-is (1 char each); everything
// else becomes %XX escapes — 3 chars per UTF-8 byte, so non-ASCII text can
// inflate a chunk up to 3× (emoji 4×). Chunk by that encoded size, or the
// browser silently drops any cookie over ~4 KB and the snapshot becomes
// unrestorable even though the save reported success.
const UNRESERVED = /[A-Za-z0-9\-_.!~*'()]/
const cookieCharLen = (ch) => {
  if (UNRESERVED.test(ch)) return 1
  const c = ch.codePointAt(0)
  const utf8Bytes = c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4
  return 3 * utf8Bytes
}

// The cookie mirror keeps only the irreplaceable core. Everything else is
// recomputable (activity, last-known-good server stats) or comfortably lives in
// localStorage + file backups (full journal, room bookkeeping).
export function compactForCookie(state) {
  if (!state || typeof state !== 'object') return null
  const s = {}
  for (const k of ['identity', 'prevIdentity', 'settings', 'checklist', 'autoDone', 'ever', 'chat', 'signVerifiedAt', 'lastAnnCheck', 'lastBackupAt']) {
    if (state[k] !== undefined) s[k] = state[k]
  }
  s.journal = Array.isArray(state.journal) ? state.journal.slice(-25) : []
  return s
}

const encBytes = (str) => {
  let n = 0
  for (const ch of str) n += cookieCharLen(ch)
  return n
}

function chunkJson(json) {
  const chunks = []
  let cur = '', curLen = 0
  for (const ch of json) {
    const l = cookieCharLen(ch)
    if (curLen + l > COOKIE_CHUNK) { chunks.push(cur); cur = ch; curLen = l }
    else { cur += ch; curLen += l }
  }
  if (cur) chunks.push(cur)
  return chunks
}

export function cookiesWrite(state) {
  try {
    if (!state || typeof state !== 'object') return 0
    // Stay under the header budget no matter how much journal accumulated:
    // mirror the recent journal, and if that still overflows, mirror less
    // (25 → 10 → 5 → 0) until it fits.
    const journal = Array.isArray(state.journal) ? state.journal : []
    for (const cap of [25, 10, 5, 0]) {
      const snapshot = compactForCookie(state)
      snapshot.journal = cap ? journal.slice(-cap) : []
      const json = JSON.stringify(snapshot)
      if (encBytes(json) > COOKIE_BUDGET) continue
      const chunks = chunkJson(json)
      if (chunks.length > COOKIE_MAX_CHUNKS) continue
      // Wipe EVERY previous chunk first: a cookie set can only shrink if the
      // old tail is deleted — leaving any index behind would make the header
      // grow across saves until requests 431 (see note at the top of this file).
      for (let i = 0; i < COOKIE_MAX_CHUNKS; i++) setCookie(`${COOKIE_PREFIX}${i}`, '', -1)
      setCookie(`${COOKIE_PREFIX}n`, '', -1)
      setCookie(`${COOKIE_PREFIX}t`, '', -1)
      chunks.forEach((c, i) => setCookie(`${COOKIE_PREFIX}${i}`, c))
      setCookie(`${COOKIE_PREFIX}n`, String(chunks.length))
      setCookie(`${COOKIE_PREFIX}t`, new Date().toISOString())
      return chunks.length
    }
    return 0 // nothing fit — keep whatever snapshot is already saved
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
    if (loaded) return mergeDefaults(loaded)
    // No localStorage (wiped / private-mode flush / first visit on this
    // browser) — fall back to the cookie snapshot so an auto-saved state is
    // never lost to a storage wipe. The app saves cookies on every change when
    // cookieSave is on (default), so this is a genuine recovery path.
    return mergeDefaults(cookiesRead())
  })
  const first = useRef(true)
  const stateRef = useRef(state)
  stateRef.current = state
  const cookieTimer = useRef(null)

  useEffect(() => {
    if (first.current) { first.current = false; return }
    lsSave(state)
    if (state.settings.cookieSave) {
      // debounce: cookies are chunked + rewritten wholesale, so only flush the
      // last change after a short quiet period, not on every single state bump
      clearTimeout(cookieTimer.current)
      cookieTimer.current = setTimeout(() => {
        try { cookiesWrite(stateRef.current) } catch { /* ignore */ }
      }, 1200)
    }
    return () => clearTimeout(cookieTimer.current)
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
      noteTweetUsed: (taskId, combo) => update((s) => {
        const list = s.tweetsUsed[taskId] || []
        if (!list.some((u) => u[0] === combo[0] && u[1] === combo[1])) list.push(combo)
        s.tweetsUsed[taskId] = list
      }),
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
      // Commit one activity scan: fold its signed-message log into the DID's
      // monotonic "ever" record, then keep the scan as the recent-window view.
      // The transient per-message log never reaches the store (it would bloat
      // every localStorage save) — it is consumed and dropped here.
      recordScan: (data) => update((s) => {
        const scan = data && data.scan
        const log = scan && Array.isArray(scan.mine) ? scan.mine : []
        if (scan) delete scan.mine
        if (data && data.did) {
          const did = data.did
          const at = data.at || new Date().toISOString()
          const merged = mergeEver((s.ever || {})[did], did, log, at)
          s.ever = { ...(s.ever || {}), [did]: merged }
        }
        s.activity = data
      }),
      // Last-known-good server snapshot (kibble score/stats, tclk stats). Small
      // payloads only — never the full kibble board.
      setLastGood: (key, val) => update((s) => { s.lastGood[key] = val }),
      removeJournal: (id) => update((s) => { s.journal = s.journal.filter((j) => j.id !== id) }),
      setSetting: (k, v) => update((s) => { s.settings[k] = v }),
      noteNonce: (room, nonce) => update((s) => {
        const n = Number(nonce)
        if (!s.lastNonces[room] || n > s.lastNonces[room]) s.lastNonces[room] = n
      }),
      setChatRoom: (room) => update((s) => { s.chat.lastRoom = room }),
      replaceState: (next) => setState(mergeDefaults(next)), // merge over defaults so a backup/cookie snapshot missing a newer key can't crash the app
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
