// contrib.js — the auto-detection engine behind the contribution task list.
//
// It scans what is publicly verifiable: your messages in the technocore rooms
// (each signed record can be re-verified from the JSON alone, per the protocol
// docs), your ledger row on the kibble board (kibble-score-v2 counts your
// results / jobs / attestations), and this browser's own state. From that it
// derives which checklist tasks have genuinely happened — no self-reporting.
import { readRoom, kibbleScore } from './technocore.js'
import { verifyRoomMessage } from './did.js'

export const SCAN_ROOMS = ['lobby', 'kibble', 'technocore', 'flop', 'flop_labs', 'flop_governance', 'flop-network', 'inference-agents', 'gpu-miners', 'validators', 'meta', 'announcements']

// The scan window: the curated room list plus every room THIS app has posted a
// signed message to (state.postedRooms) — so legitimate participation in a room
// outside the curated list still counts toward rooms-active / replies / days.
// Extras are capped at the 10 most recent so the scan stays ~22 requests max.
export function scanRoomsWith(state) {
  const extras = Object.entries(state?.postedRooms || {})
    .sort((a, b) => new Date(b[1]) - new Date(a[1]))
    .map(([r]) => r)
    .filter((r) => !SCAN_ROOMS.includes(r))
    .slice(0, 10)
  return [...SCAN_ROOMS, ...extras]
}

// Read the recent window of each room and build activity metrics for one DID.
// Notes: a room read returns the last N messages (limit 200 max advisory);
// older history beyond the retained window can't be seen — the scan is
// "recent public activity", not a full archive.
export async function scanActivity(did, { rooms = SCAN_ROOMS } = {}) {
  if (!did) throw new Error('Create your identity first — nothing to scan without a DID')
  const settled = await Promise.allSettled(rooms.map((r) => readRoom(r, { limit: 200 })))

  const perRoom = {}
  let signedPosts = 0
  let totalPosts = 0
  let verifiedSigs = 0
  let replies = 0
  let answers = 0
  let maxLen = 0
  let helloFound = false
  const daySet = new Set()
  const textCounts = new Map()

  settled.forEach((res, i) => {
    const room = rooms[i]
    if (res.status !== 'rejected') {
      const msgs = res.value?.messages || []
      perRoom[room] = { visible: msgs.length, mine: 0, signed: 0 }
      msgs.forEach((m, idx) => {
        const mine = m.from === did
        // a reply: my message immediately follows someone else's
        if (mine && idx > 0 && msgs[idx - 1].from !== did) {
          replies++
          // an answer: my message follows a question from someone else
          if (msgs.slice(Math.max(0, idx - 5), idx).some((x) => x.from !== did && x.text?.includes('?'))) answers++
        }
        if (!mine) return
        perRoom[room].mine++
        totalPosts++
        if (room === 'kibble' && /^HELLO v1/.test(m.text || '')) helloFound = true
        if (m.ts) daySet.add(String(m.ts).slice(0, 10))
        const len = (m.text || '').length
        if (len > maxLen) maxLen = len
        const key = (m.text || '').toLowerCase().replace(/\s+/g, ' ').trim()
        if (key) textCounts.set(key, (textCounts.get(key) || 0) + 1)
        if (m.sig) {
          signedPosts++
          perRoom[room].signed++
          if (verifyRoomMessage(did, room, m.nonce, m.text, m.sig)) verifiedSigs++
        }
      })
    } else {
      perRoom[room] = { visible: 0, mine: 0, signed: 0, error: String(res.reason?.message || res.reason) }
    }
  })

  const duplicateTexts = Array.from(textCounts.values()).filter((n) => n > 1).length
  const roomsPosted = Object.entries(perRoom).filter(([, v]) => v.mine > 0).map(([room, v]) => ({ room, ...v }))
  return {
    at: new Date().toISOString(),
    did,
    signedPosts,
    totalPosts,
    verifiedSigs,
    replies,
    answers,
    maxLen,
    duplicateTexts,
    activeDays: daySet.size,
    days: Array.from(daySet).sort(),
    helloFound,
    roomsPosted,
    lobbySigned: perRoom.lobby?.signed || 0,
  }
}

// Fetch the kibble board's own ledger row for this DID — kibble-score-v2 counts
// what the board actually scored: results, jobs, attestations given, usefuls.
export async function fetchScoreTerms(did) {
  try {
    const s = await kibbleScore(did)
    const t = s?.breakdown?.terms || {}
    return {
      score: s?.score || 0,
      rank: s?.rank,
      found: s?.found !== false,
      results: t.results || 0,
      jobs: t.jobs || t.jobs_posted || 0,
      given: t.given || t.attestations_given || 0,
      useful: t.useful || t.peer_useful || 0,
    }
  } catch {
    return null
  }
}

// Full activity refresh (room scan + score ledger) as a store-ready object.
// Called by useContrib.scan() and — fire-and-forget — right after any signed
// write lands, so the tracker ticks without anyone pressing a button.
export async function refreshActivity(did, { rooms } = {}) {
  const [scan, score] = await Promise.all([scanActivity(did, { rooms }), fetchScoreTerms(did)])
  return { at: new Date().toISOString(), did, scan, score }
}

const DAY = 864e5

// The single source of truth for auto-completion. Returns
// { [taskKey]: { done: boolean, detail: string } } — detail explains WHAT was
// detected, so the badge is evidence, not a bare checkmark.
export function computeAutoChecks(state, scan, scoreTerms, now = Date.now()) {
  const out = {}
  const s = state || {}
  const id = s.identity
  const journal = s.journal || []
  const urlEntries = journal.filter((j) => j.url)
  const ageDays = id ? Math.floor((now - new Date(id.createdAt).getTime()) / DAY) : 0
  const m = scan || {}
  const k = scoreTerms || {}
  const journalHasResult = journal.some((j) => j.type === 'kibble' && /\bRESULT\b/.test(j.text || ''))
  const roomsVisited = Object.keys(s.roomVisits || {}).length
  const annFresh = s.lastAnnCheck ? now - new Date(s.lastAnnCheck).getTime() < 7 * DAY : false
  // rotation: this browser held a different DID before the current one. Restoring
  // the same key clears prevIdentity's mismatch; a genuinely new DID does not.
  const rotated = Boolean(s.prevIdentity && id && s.prevIdentity.did !== id.did)

  const set = (key, done, detail) => { out[key] = { done, detail } }

  set('did', !!id, id ? 'identity created ' + new Date(id.createdAt).toLocaleDateString() : 'no identity yet')
  set('verify', Boolean(s.signVerifiedAt || m.verifiedSigs > 0),
    s.signVerifiedAt ? 'self-test passed ' + new Date(s.signVerifiedAt).toLocaleDateString()
      : m.verifiedSigs > 0 ? `${m.verifiedSigs} on-chain signature(s) re-verified` : 'run the self-test in Identity')
  set('intro', (m.lobbySigned || 0) > 0, m.lobbySigned > 0 ? 'signed message found in /r/lobby' : 'no signed message in /r/lobby yet')
  set('read-rooms', roomsVisited >= 3, `${roomsVisited} room(s) opened in this app`)
  set('join-rooms', (m.roomsPosted || []).filter((r) => r.signed > 0).length >= 2,
    `${(m.roomsPosted || []).length} room(s) with recent posts (${(m.roomsPosted || []).filter((r) => r.signed > 0).length} signed)`)
  set('read-before-post', (m.totalPosts || 0) >= 3 && (m.duplicateTexts || 0) === 0,
    `${m.totalPosts || 0} recent posts, ${m.duplicateTexts || 0} duplicated text(s)`)
  set('meaningful', (m.maxLen || 0) >= 140, `longest recent message: ${m.maxLen || 0} chars (needs ≥ 140)`)
  set('reply', (m.replies || 0) >= 1, `${m.replies || 0} message(s) directly after someone else's`)
  set('answer', (m.answers || 0) >= 1, `${m.answers || 0} reply(ies) that followed a question`)
  set('kibble-hello', Boolean(m.helloFound || journal.some((j) => /HELLO v1/.test(j.text || ''))),
    m.helloFound ? 'HELLO v1 found on the board' : 'post a HELLO from the Kibble tab')
  set('kibble-job', (k.jobs || 0) >= 1, k.found === false ? 'no board ledger row yet' : `${k.jobs || 0} job(s) posted (board ledger)`)
  set('kibble-result', (k.results || 0) >= 1 || journalHasResult,
    (k.results || 0) >= 1 ? `${k.results} scored RESULT(s) (board ledger)` : journalHasResult ? 'RESULT recorded in journal' : 'no RESULT on the board yet')
  set('kibble-attest', (k.given || 0) >= 1, `${k.given || 0} attestation(s) given (board ledger)`)
  set('evidence-record', urlEntries.length >= 3, `${urlEntries.length} evidence entr(ies) with URL in the journal (needs ≥ 3)`)
  set('link-did', ((m.signedPosts || 0) >= 1 || Boolean(s.signVerifiedAt)) && urlEntries.length >= 1,
    `${(m.signedPosts || 0) + (s.signVerifiedAt ? 1 : 0)} signed/verified act(s) + ${urlEntries.length} evidence entr(ies) under one DID`)
  set('external-evidence', urlEntries.length >= 1, `${urlEntries.length} evidence URL(s) recorded`)
  set('history', journal.length >= 10, `${journal.length} journal entries (needs ≥ 10)`)
  set('periodic', (m.activeDays || 0) >= 3, `active on ${m.activeDays || 0} different day(s) (needs ≥ 3)`)
  set('help-others', (m.replies || 0) >= 3, `${m.replies || 0} substantive repl(ies) (needs ≥ 3)`)
  set('same-identity', Boolean(id && ageDays >= 7 && !rotated),
    rotated ? 'a different DID was used in this browser before — DID rotation is on the never-do list'
      : id ? `identity held for ${ageDays} day(s)` : 'no identity')
  set('monitor-ann', annFresh, s.lastAnnCheck ? 'official channels checked ' + new Date(s.lastAnnCheck).toLocaleDateString() : 'open the guide to check announcements')

  return out
}

// Auto tasks that are a recurring habit rather than a one-off achievement —
// these legitimately re-evaluate on every scan (announcement checks go stale
// after 7 days on purpose, and same-identity must be able to UN-tick if the
// browser's DID is rotated). Everything else, once detected, stays done: the
// room scan only sees the last ~200 messages per room, so yesterday's work
// would otherwise scroll out of the window and un-tick the task.
export const RECURRING_AUTOS = new Set(['monitor-ann', 'same-identity'])

// Effective auto-checks: what the scan just detected, plus everything ever
// detected before (sticky history) for non-recurring tasks.
export function mergeStickyChecks(autoChecks, autoDone) {
  const out = {}
  for (const [key, check] of Object.entries(autoChecks || {})) {
    const sticky = !RECURRING_AUTOS.has(key) && autoDone?.[key]
    if (check.done || !sticky) out[key] = check
    else out[key] = { ...check, done: true, detail: 'kept from earlier detection (' + new Date(sticky).toLocaleDateString() + ') — no longer in the recent window' }
  }
  return out
}

// Effective completion for one task: manual tick OR auto-detected.
export function taskDone(task, checklist, autoChecks) {
  if (task.auto && autoChecks?.[task.auto]?.done) return true
  return Boolean(checklist[task.id]?.done)
}
