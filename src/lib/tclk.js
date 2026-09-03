// tclk.js — Technocore Lock Protocol (tclk/1), ported for the browser from the
// reference implementation (github.com/flop-labs/tclk, Apache-2.0). One frame
// per technocore room message: the prefix `tclk1 ` + one canonical ASCII JSON
// object on a single line. The ids are domain-tagged sha256 over the canonical
// fields, so a frame built here verifies anywhere the reference library runs.
//
// Scope: the HASH-lock (HTLC) path only. The point-lock / adaptor-signature
// path is unaudited reference crypto upstream and needs secp256k1, which this
// app does not ship — frames with `lock:"point"` are rejected loudly here.
//
// State machine: pure and fail-closed. applyFrame never throws on a bad frame
// and never mutates its input — an invalid transition returns the same state
// with { ok:false, reason }, so a fold can be fed every line of a
// world-writable room and money-state only advances on frames that verify.
import { sha256 } from '@noble/hashes/sha2.js'
import { verifyRoomMessage } from './did.js'

export const TCLK_PREFIX = 'tclk1 '
export const TCLK_DOMAIN = 'FLOP::tclk::v1'
export const MAX_FRAME_CHARS = 4096
// Where public offers rest so two agents who have never met can find each
// other — an ordinary world-writable room, listed like any other.
export const OFFER_ROOM = 'tclk-offers'

// ---- rails -----------------------------------------------------------------

export const CANONICAL_RAIL_IDS = ['btc-htlc', 'evm-htlc', 'flop-htlc', 'memory', 'near-htlc', 'paper', 'x402']
const RAIL_ALIASES = { paperrail: 'paper', 'paper-rail': 'paper' }
const CANONICAL_RAIL = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
// The original tclk/1 wire grammar — decoding keeps accepting it so old
// transcripts remain replayable; new emissions require registered rail ids.
const LEGACY_RAIL = /^(?:[a-z0-9][a-z0-9._-]{0,63}|PaperRail)$/

export function normalizeRailId(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('tclk: rail id must be a non-empty string')
  const spelling = value.trim().replace(/[A-Z]/g, (c) => c.toLowerCase())
  if (!CANONICAL_RAIL.test(spelling)) throw new Error(`tclk: malformed rail id: ${value}`)
  const canonical = RAIL_ALIASES[spelling] || spelling
  if (!CANONICAL_RAIL_IDS.includes(canonical)) throw new Error(`tclk: unknown rail id: ${value}`)
  return canonical
}

export function normalizeRailIds(values) {
  if (!Array.isArray(values) || values.length === 0) throw new Error('tclk: rails must be a non-empty array')
  return [...new Set(values.map(normalizeRailId))].sort()
}

// ---- canonical encoding + ids ----------------------------------------------

// Deterministic JSON: sorted keys, compact separators, undefined dropped.
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') {
    const s = JSON.stringify(value)
    if (s === undefined) throw new Error('tclk: frame contains an unsupported value')
    return s
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const keys = Object.keys(value).sort().filter((k) => value[k] !== undefined)
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`
}

const hexOf = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

// Escape every non-ASCII char so the stored line equals the signed line.
const toAscii = (json) => json.replace(/[\u0080-\uffff]/g,
  (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`)

// The id hash. The payload is escaped to ASCII first: the id must commit to
// the same bytes the wire carries, or two conforming implementations would
// disagree on the contract id for any frame with a non-ASCII character.
function domainHash(tag, payload) {
  return '0x' + hexOf(sha256(new TextEncoder().encode(`${TCLK_DOMAIN}|${tag}|${toAscii(payload)}`)))
}

/** The offer id: sha256 over the domain-tagged canonical offer fields (no `id`). */
export function offerId(fields) {
  return domainHash('offer', canonicalJson(fields))
}

/**
 * The contract id: sha256 over the domain-tagged canonical {offer, accept}
 * pair — binds the full offer (id included) and the acceptance, so tampering
 * with any term yields a different contract.
 */
export function contractId(offer, acceptCore) {
  return domainHash('contract', canonicalJson({ offer, accept: acceptCore }))
}

// The recommended deal room: a signed-only (mb-) mailbox room keyed by the
// contract id — `mb-p-tclk-<first 16 hex>`.
export function dealRoom(contract) {
  if (!/^0x[0-9a-f]{64}$/.test(contract)) throw new Error(`tclk: malformed contract id: ${contract}`)
  return `mb-p-tclk-${contract.slice(2, 18)}`
}

// ---- hash lock --------------------------------------------------------------

export function generateHashLock() {
  const preimage = crypto.getRandomValues(new Uint8Array(32))
  return {
    preimage: '0x' + hexOf(preimage),
    hash: '0x' + hexOf(sha256(preimage)), // safe to publish
  }
}

/** True iff sha256(preimage) == hash. Fail-closed: malformed input is false. */
export function verifyHashPreimage(hash, preimage) {
  try {
    if (typeof preimage !== 'string' || !/^0x[0-9a-f]{64}$/.test(preimage)) return false
    const bytes = new Uint8Array(32)
    for (let i = 0; i < 32; i++) bytes[i] = parseInt(preimage.slice(2 + i * 2, 4 + i * 2), 16)
    return '0x' + hexOf(sha256(bytes)) === hash.toLowerCase()
  } catch {
    return false
  }
}

// ---- frame validation (fail-closed) -----------------------------------------

const HEX32 = /^0x[0-9a-f]{64}$/
const DID = /^did:key:z6Mk[1-9A-HJ-NP-Za-km-z]{44}$/
const AMOUNT = /^[1-9][0-9]*$/
const ASSET = /^[A-Za-z0-9_-]{1,32}$/
const NONCE = /^[0-9a-f]{8,64}$/

const fail = (msg) => { throw new Error(`tclk: ${msg}`) }

const FRAME_FIELDS = {
  offer: {
    allowed: ['type', 'from', 'role', 'amount', 'asset', 'lock', 'rails', 'claimByMs', 'refundAfterMs', 'expiresMs', 'paymentKey', 'job', 'nonce', 'id'],
    required: ['type', 'from', 'role', 'amount', 'asset', 'lock', 'rails', 'claimByMs', 'refundAfterMs', 'expiresMs', 'nonce', 'id'],
  },
  accept: {
    allowed: ['type', 'from', 'ref', 'statement', 'contract', 'paymentKey', 'nonce'],
    required: ['type', 'from', 'ref', 'statement', 'contract', 'nonce'],
  },
  lock: { allowed: ['type', 'from', 'contract', 'rail', 'ref'], required: ['type', 'from', 'contract', 'rail', 'ref'] },
  reveal: { allowed: ['type', 'from', 'contract', 'ref', 'secret'], required: ['type', 'from', 'contract', 'secret'] },
  refund: { allowed: ['type', 'from', 'contract', 'ref', 'reason'], required: ['type', 'from', 'contract'] },
  cancel: { allowed: ['type', 'from', 'contract', 'reason'], required: ['type', 'from', 'contract'] },
  receipt: { allowed: ['type', 'from', 'contract', 'outcome', 'rail', 'ref'], required: ['type', 'from', 'contract', 'outcome'] },
  heartbeat: { allowed: ['type', 'from', 'contract', 'nonce', 'note'], required: ['type', 'from', 'contract', 'nonce'] },
}

function reqStr(v, name, re) {
  if (typeof v !== 'string' || v.length === 0) fail(`${name} must be a non-empty string`)
  if (re && !re.test(v)) fail(`${name} is malformed: ${v}`)
  return v
}

function reqMs(v, name) {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v <= 0) fail(`${name} must be a positive unix-ms integer`)
  return v
}

function validateJob(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) fail('job must be an object')
  for (const k of Object.keys(v)) if (!['proto', 'id', 'context'].includes(k)) fail(`unknown field on job: ${k}`)
  reqStr(v.proto, 'job.proto', /^[a-z0-9][a-z0-9._-]{0,31}$/)
  reqStr(v.id, 'job.id')
  if (v.context !== undefined) reqStr(v.context, 'job.context')
}

/** Validate one frame structurally. Throws with a reason on the first violation. */
export function validateFrame(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('frame must be an object')
  const frame = value
  const spec = FRAME_FIELDS[frame.type]
  if (!spec) fail(`unknown frame type: ${String(frame.type)}`)
  const allowed = new Set(spec.allowed)
  for (const k of Object.keys(frame)) if (!allowed.has(k)) fail(`unknown field on ${frame.type}: ${k}`)
  for (const k of spec.required) if (frame[k] === undefined) fail(`missing field on ${frame.type}: ${k}`)
  reqStr(frame.from, 'from', DID)

  switch (frame.type) {
    case 'offer': {
      if (frame.role !== 'payer' && frame.role !== 'payee') fail('role must be payer|payee')
      reqStr(frame.amount, 'amount', AMOUNT)
      reqStr(frame.asset, 'asset', ASSET)
      if (frame.lock !== 'hash' && frame.lock !== 'point') fail('lock must be hash|point')
      if (frame.lock === 'point') fail('point locks are not supported by this build (hash locks only)')
      if (!Array.isArray(frame.rails) || frame.rails.length === 0) fail('rails must be a non-empty array')
      for (const rail of frame.rails) reqStr(rail, 'rail', LEGACY_RAIL)
      const claimBy = reqMs(frame.claimByMs, 'claimByMs')
      const refundAfter = reqMs(frame.refundAfterMs, 'refundAfterMs')
      reqMs(frame.expiresMs, 'expiresMs')
      if (claimBy >= refundAfter) fail('claimByMs must be strictly before refundAfterMs')
      if (frame.job !== undefined) validateJob(frame.job)
      reqStr(frame.nonce, 'nonce', NONCE)
      const { id, ...fields } = frame
      const expected = offerId(fields)
      if (frame.id !== expected) fail(`offer id mismatch (expected ${expected})`)
      break
    }
    case 'accept': {
      reqStr(frame.ref, 'ref', HEX32)
      reqStr(frame.statement, 'statement', HEX32)
      reqStr(frame.contract, 'contract', HEX32)
      reqStr(frame.nonce, 'nonce', NONCE)
      break
    }
    case 'lock': {
      reqStr(frame.contract, 'contract', HEX32)
      reqStr(frame.rail, 'rail', LEGACY_RAIL)
      reqStr(frame.ref, 'ref')
      break
    }
    case 'reveal': {
      reqStr(frame.contract, 'contract', HEX32)
      if (frame.ref !== undefined) reqStr(frame.ref, 'ref')
      reqStr(frame.secret, 'secret', HEX32)
      break
    }
    case 'refund': {
      reqStr(frame.contract, 'contract', HEX32)
      if (frame.ref !== undefined) reqStr(frame.ref, 'ref')
      if (frame.reason !== undefined) reqStr(frame.reason, 'reason')
      break
    }
    case 'cancel': {
      reqStr(frame.contract, 'contract', HEX32)
      if (frame.reason !== undefined) reqStr(frame.reason, 'reason')
      break
    }
    case 'receipt': {
      reqStr(frame.contract, 'contract', HEX32)
      if (!['claimed', 'refunded', 'cancelled'].includes(frame.outcome)) fail('outcome must be claimed|refunded|cancelled')
      if (frame.rail !== undefined) reqStr(frame.rail, 'rail', LEGACY_RAIL)
      if (frame.ref !== undefined) reqStr(frame.ref, 'ref')
      break
    }
    case 'heartbeat': {
      reqStr(frame.contract, 'contract', HEX32)
      reqStr(frame.nonce, 'nonce', NONCE)
      if (frame.note !== undefined) reqStr(frame.note, 'note')
      break
    }
  }
  return frame
}

// ---- builders ---------------------------------------------------------------

const randomNonceHex = () => hexOf(crypto.getRandomValues(new Uint8Array(8)))

/** Build a validated offer; mints a nonce if none given, computes the id. */
export function makeOffer(fields) {
  const body = { ...fields, type: 'offer', rails: normalizeRailIds(fields.rails), nonce: fields.nonce || randomNonceHex() }
  return validateFrame({ ...body, id: offerId(body) })
}

/**
 * Accept an offer: verifies the offer, checks the statement fits the offered
 * lock kind, computes the contract id. The payee's hash statement goes in;
 * the preimage never leaves the caller.
 */
export function makeAccept(offer, { from, statement, nonce }) {
  validateFrame(offer)
  if (from === offer.from) fail('accept.from must differ from offer.from')
  if (offer.lock !== 'hash' || !HEX32.test(statement)) fail(`statement does not fit a ${offer.lock} lock: ${statement}`)
  const core = { from, ref: offer.id, statement, nonce: nonce || randomNonceHex() }
  return validateFrame({ type: 'accept', ...core, contract: contractId(offer, core) })
}

// ---- line codec --------------------------------------------------------------

export const isTclkLine = (text) => typeof text === 'string' && text.startsWith(TCLK_PREFIX)

/** Encode a frame to its room-message line. Validates, enforces the venue caps. */
export function encodeFrame(frame) {
  const validated = validateFrame(frame)
  if (validated.type === 'offer') {
    for (const rail of validated.rails) {
      const canonical = normalizeRailId(rail)
      if (rail !== canonical) fail(`non-canonical rail id: ${rail}; use ${canonical}`)
    }
  } else if (validated.type === 'lock') {
    const canonical = normalizeRailId(validated.rail)
    if (validated.rail !== canonical) fail(`non-canonical rail id: ${validated.rail}; use ${canonical}`)
  }
  const line = TCLK_PREFIX + toAscii(canonicalJson(validated))
  if (line.length > MAX_FRAME_CHARS) fail(`frame exceeds the ${MAX_FRAME_CHARS}-char room-message cap (${line.length})`)
  if (!/^[\x20-\x7e]*$/.test(line)) fail('frame line contains non-printable-ASCII characters')
  return line
}

/** Decode a room-message line. Throws on a malformed tclk line or a non-tclk line. */
export function decodeFrame(text) {
  if (!isTclkLine(text)) fail('not a tclk/1 line')
  let parsed
  try { parsed = JSON.parse(text.slice(TCLK_PREFIX.length)) } catch { fail('frame is not valid JSON') }
  return validateFrame(parsed)
}

/** Null for non-tclk AND malformed tclk lines — a hostile line must not break the reader. */
export function tryDecodeFrame(text) {
  try { return decodeFrame(text) } catch { return null }
}

// ---- state machine ------------------------------------------------------------
//
// proposed ─accept→ accepted ─lock→ locked ─reveal→ claimed | ─refund→ refunded
// proposed|accepted ─cancel→ cancelled; accepted|locked ─heartbeat→ unchanged

export function openContract(offer) {
  validateFrame(offer)
  return {
    status: 'proposed',
    offer,
    payerDid: offer.role === 'payer' ? offer.from : undefined,
    payeeDid: offer.role === 'payee' ? offer.from : undefined,
  }
}

const isParty = (state, did) => did === state.offer.from || did === state.payerDid || did === state.payeeDid

function offerIncludesRail(offered, selected) {
  if (offered.includes(selected)) return true
  let target
  try { target = normalizeRailId(selected) } catch { return false }
  return offered.some((rail) => {
    try { return normalizeRailId(rail) === target } catch { return false }
  })
}

/** Apply one frame at wall-clock `nowMs`. Fail-closed: bad input is rejected, never thrown. */
export function applyFrame(state, frame, nowMs) {
  const reject = (reason) => ({ state, ok: false, reason })
  if (!Number.isFinite(nowMs) || nowMs < 0) return reject('tclk: nowMs must be a finite non-negative number')
  try { validateFrame(frame) } catch (e) { return reject(e.message) }

  switch (frame.type) {
    case 'offer':
      return reject('contract is already open')

    case 'accept': {
      if (state.status !== 'proposed') return reject(`accept in status ${state.status}`)
      if (frame.ref !== state.offer.id) return reject('accept.ref names a different offer')
      if (frame.from === state.offer.from) return reject('cannot accept own offer')
      if (nowMs >= state.offer.expiresMs) return reject('offer has expired')
      const core = { from: frame.from, ref: frame.ref, statement: frame.statement, nonce: frame.nonce }
      if (frame.contract !== contractId(state.offer, core)) return reject('contract id mismatch')
      if (!HEX32.test(frame.statement)) return reject(`statement does not fit a ${state.offer.lock} lock`)
      const acceptorIsPayer = state.offer.role === 'payee'
      return {
        ok: true,
        state: {
          ...state,
          status: 'accepted',
          contract: frame.contract,
          statement: frame.statement,
          payerDid: acceptorIsPayer ? frame.from : state.payerDid,
          payeeDid: acceptorIsPayer ? state.payeeDid : frame.from,
        },
      }
    }

    case 'lock': {
      if (state.status !== 'accepted') return reject(`lock in status ${state.status}`)
      if (frame.contract !== state.contract) return reject('lock names a different contract')
      if (frame.from !== state.payerDid) return reject('only the payer locks')
      if (nowMs >= state.offer.refundAfterMs) return reject('refund window is already open')
      if (!offerIncludesRail(state.offer.rails, frame.rail)) return reject(`rail ${frame.rail} was not offered`)
      return { ok: true, state: { ...state, status: 'locked', rail: frame.rail, railRef: frame.ref } }
    }

    case 'reveal': {
      if (state.status !== 'locked') return reject(`reveal in status ${state.status}`)
      if (frame.contract !== state.contract) return reject('reveal names a different contract')
      if (frame.ref !== undefined && frame.ref !== state.railRef) return reject('reveal names a different rail ref')
      if (frame.from !== state.payeeDid) return reject('only the payee reveals')
      if (nowMs >= state.offer.refundAfterMs) return reject('refund window is open')
      if (!verifyHashPreimage(state.statement, frame.secret)) return reject('secret does not open the statement')
      return { ok: true, state: { ...state, status: 'claimed', secret: frame.secret } }
    }

    case 'refund': {
      if (state.status !== 'locked') return reject(`refund in status ${state.status}`)
      if (frame.contract !== state.contract) return reject('refund names a different contract')
      if (frame.ref !== undefined && frame.ref !== state.railRef) return reject('refund names a different rail ref')
      if (frame.from !== state.payerDid) return reject('only the payer refunds')
      if (nowMs < state.offer.refundAfterMs) return reject('refund window not open yet')
      return { ok: true, state: { ...state, status: 'refunded' } }
    }

    case 'cancel': {
      if (state.status !== 'proposed' && state.status !== 'accepted') return reject(`cancel in status ${state.status}`)
      if (state.status === 'accepted' && frame.contract !== state.contract) return reject('cancel names a different contract')
      if (!isParty(state, frame.from)) return reject('cancel from a non-party')
      return { ok: true, state: { ...state, status: 'cancelled' } }
    }

    case 'receipt': {
      if (!['claimed', 'refunded', 'cancelled'].includes(state.status)) return reject('receipt before a terminal status')
      if (frame.contract !== state.contract) return reject('receipt names a different contract')
      if (!isParty(state, frame.from)) return reject('receipt from a non-party')
      if (frame.outcome !== state.status) return reject(`receipt outcome ${frame.outcome} does not match ${state.status}`)
      return { ok: true, state }
    }

    case 'heartbeat': {
      if (state.status !== 'accepted' && state.status !== 'locked') return reject(`heartbeat in status ${state.status}`)
      if (frame.contract !== state.contract) return reject('heartbeat names a different contract')
      if (!isParty(state, frame.from)) return reject('heartbeat from a non-party')
      return { ok: true, state }
    }
  }
}

// ---- transcript fold ----------------------------------------------------------
//
// A transcript is not an array of frame strings: the transport record beside
// each line supplies the identity and time that make the guards meaningful.
// Every record is signature-verified (same `<room>|<nonce>|<text>` canonical
// the venue checks) before its frame may advance money-state.

/** Normalize one readRoom format=json message into a foldable record. */
export function transcriptRecord(room, m) {
  return {
    room,
    seq: m.seq,
    timestampMs: Date.parse(m.ts && m.ts.includes && (m.ts.includes('+') || m.ts.endsWith('Z')) ? m.ts : m.ts + 'Z'),
    sender: m.from,
    nonce: m.nonce != null ? String(m.nonce) : null,
    signature: m.sig || null,
    line: m.text,
  }
}

function authenticatedFrame(record) {
  // unsigned records and records whose signature does not verify are rejected
  if (record.nonce == null || record.signature == null) return null
  if (!verifyRoomMessage(record.sender, record.room, record.nonce, record.line, record.signature)) return null
  const frame = tryDecodeFrame(record.line)
  return frame !== null && frame.from === record.sender ? frame : null
}

/**
 * Authenticate and fold records in the supplied order. Every record gets a
 * verdict; invalid signatures, forged `from` fields, wrong rooms, malformed
 * lines and bad transitions are rejected without changing state.
 */
export function foldTranscript(records) {
  const steps = []
  let state = null
  records.forEach((record, index) => {
    const base = { index, room: record?.room || '', seq: record?.seq ?? -1 }
    const frame = authenticatedFrame(record)
    if (frame === null) {
      steps.push({ ...base, ok: false, reason: 'record did not authenticate (unsigned, bad signature, or forged from)' })
      return
    }
    if (state === null) {
      if (frame.type !== 'offer') {
        steps.push({ ...base, type: frame.type, ok: false, reason: 'no contract open yet' })
        return
      }
      if (record.room !== OFFER_ROOM) {
        steps.push({ ...base, type: frame.type, ok: false, reason: `offer must be posted in ${OFFER_ROOM}` })
        return
      }
      state = openContract(frame)
      steps.push({ ...base, type: frame.type, ok: true })
      return
    }
    const expectedRoom = frame.type === 'offer' || frame.type === 'accept' || state.contract === undefined
      ? OFFER_ROOM
      : dealRoom(state.contract)
    if (record.room !== expectedRoom) {
      steps.push({ ...base, type: frame.type, ok: false, reason: `${frame.type} must be posted in ${expectedRoom}` })
      return
    }
    const result = applyFrame(state, frame, record.timestampMs)
    state = result.state
    steps.push({ ...base, type: frame.type, ok: result.ok, reason: result.reason })
  })
  return { state, steps }
}
