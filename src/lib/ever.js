// ever.js — monotonic per-DID contribution totals.
//
// A room scan can only ever see the recent ~200 messages per room, so showing
// "what the last scan found" makes the tracker shrink as yesterday's posts
// scroll out of the window. Instead every scan is merged into a per-DID "ever"
// record: a signed message is counted exactly once, on the first scan that
// observes it (a per-room nonce ceiling), and the totals only ever grow. This
// module is pure (no imports) so both store.jsx and the UI can use it without
// creating an import cycle.

export function emptyEver(did, at) {
  return {
    did,
    firstSeen: at,
    lastSeen: at,
    updatedAt: at,
    signed: 0,      // distinct signed messages observed
    verified: 0,    // of those, with a signature that re-verified
    replies: 0,     // observed signed messages directly after someone else's
    answers: 0,     // …that followed a question
    maxLen: 0,      // longest observed signed message
    hello: false,   // saw a signed HELLO v1 on the kibble board
    lobbySigned: 0, // signed messages observed in /r/lobby
    rooms: {},      // room -> highest nonce of OUR signed message already counted
    days: {},       // 'YYYY-MM-DD' -> 1 for every day a signed message was seen
  }
}

// Merge one scan's worth of signed messages (see contrib.js scanActivity.mine)
// into the running record for a DID. Returns a NEW object; `prev` is untouched.
// `log` entries: { room, nonce, len, day, verified, reply, answer, hello }.
export function mergeEver(prev, did, log, at) {
  const e = prev && prev.did === did
    ? JSON.parse(JSON.stringify(prev))
    : emptyEver(did, at)
  e.lastSeen = at
  e.updatedAt = at
  for (const m of log || []) {
    const nonce = Number(m.nonce)
    if (!(nonce > 0) || !m.room) continue // unsigned/odd rows have no dedupe key
    const last = e.rooms[m.room] || 0
    if (nonce <= last) continue // already counted on an earlier scan
    e.rooms[m.room] = nonce
    e.signed++
    if (m.verified) e.verified++
    if (m.reply) e.replies++
    if (m.answer) e.answers++
    if (m.hello) e.hello = true
    if (m.room === 'lobby') e.lobbySigned++
    if (m.len > e.maxLen) e.maxLen = m.len
    if (m.day) e.days[m.day] = 1
  }
  return e
}

// The six numbers the tracker tile renders, read from the ever record (or null
// when no record exists for this DID yet).
export function everSummary(ever) {
  if (!ever) return null
  return {
    signed: ever.signed || 0,
    verified: ever.verified || 0,
    rooms: Object.keys(ever.rooms || {}).length,
    replies: ever.replies || 0,
    answers: ever.answers || 0,
    days: Object.keys(ever.days || {}).length,
    maxLen: ever.maxLen || 0,
    lobbySigned: ever.lobbySigned || 0,
    firstSeen: ever.firstSeen,
    lastSeen: ever.lastSeen,
  }
}
