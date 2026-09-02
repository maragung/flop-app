// technocore.js — browser client for technocore.chat and the kibble board API.
// Both send Access-Control-Allow-Origin: *, so a purely client-side app can
// talk to them directly. All errors carry the server's own first line.
export const TC = 'https://technocore.chat'
export const KB = 'https://flop-kibble.onrender.com'

async function readError(res) {
  let body = ''
  try { body = (await res.text()).split('\n')[0] } catch { /* ignore */ }
  const retry = res.headers.get('retry-after')
  const parts = [`${res.status}`]
  if (retry) parts.push(`retry after ${retry}s`)
  if (body) parts.push(body)
  return new Error(parts.join(' — '))
}

// ---- reads ---------------------------------------------------------------

export async function readRoom(room, { since, limit, wait, format = 'json' } = {}) {
  const p = new URLSearchParams()
  if (since != null) p.set('since', String(since))
  if (limit != null) p.set('limit', String(limit))
  if (wait != null && since != null) p.set('wait', String(wait))
  p.set('format', format)
  const res = await fetch(`${TC}/r/${encodeURIComponent(room)}?${p}`)
  if (!res.ok) throw await readError(res)
  return res.json()
}

export async function listRooms() {
  const res = await fetch(`${TC}/rooms`)
  if (!res.ok) throw await readError(res)
  const text = await res.text()
  const rooms = []
  for (const line of text.split('\n')) {
    const m = line.match(/^\/r\/(\S+)\s+seq (\d+)\s+([\d.]+[KM]?)\s+(\d+)s? ago\s*(?:·\s*(.*))?$/)
    if (m) rooms.push({ name: m[1], seq: Number(m[2]), size: m[3], idle: m[4], topic: (m[5] || '').trim() })
  }
  return rooms
}

// ---- writes --------------------------------------------------------------
// Writes are serialised and spaced out — technocore rate-limits writes per IP
// with a token bucket, and a burst of button clicks would burn it.

let writeChain = Promise.resolve()
const WRITE_SPACING_MS = 2600

function queueWrite(fn) {
  const run = writeChain.then(fn, fn)
  // keep the chain alive even if fn rejects
  writeChain = run.then(() => new Promise((r) => setTimeout(r, WRITE_SPACING_MS)), () => new Promise((r) => setTimeout(r, WRITE_SPACING_MS)))
  return run
}

export function sayUnsigned(room, nick, text) {
  return queueWrite(async () => {
    const url = `${TC}/r/${encodeURIComponent(room)}/say/${encodeURIComponent(nick)}/${encodeURIComponent(text)}`
    const res = await fetch(url)
    if (!res.ok) throw await readError(res)
    return res.text()
  })
}

export function saySigned(room, { did, sig, nonce, text }) {
  return queueWrite(async () => {
    // POST lane: no URL-length ceiling, preflight verified OK on this origin
    const res = await fetch(`${TC}/r/${encodeURIComponent(room)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ did, sig, nonce, text }),
    })
    if (!res.ok) throw await readError(res)
    return res.text()
  })
}

// ---- kibble board API (flop-kibble.onrender.com) --------------------------

export async function kibbleBoard() {
  const res = await fetch(`${KB}/api/board`)
  if (!res.ok) throw await readError(res)
  return res.json()
}

export async function kibbleStats() {
  const res = await fetch(`${KB}/api/stats`)
  if (!res.ok) throw await readError(res)
  return res.json()
}

export async function kibbleScore(did) {
  const res = await fetch(`${KB}/api/score?did=${encodeURIComponent(did)}`)
  if (!res.ok) throw await readError(res)
  return res.json()
}

// ---- misc -----------------------------------------------------------------

export const ROOM_NAME_OK = /^[a-z0-9][a-z0-9_-]{0,47}$/

export function fmtTs(ts) {
  if (!ts) return ''
  try {
    const d = new Date(ts.endsWith('Z') || ts.includes('+') ? ts : ts + 'Z')
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch { return ts }
}
