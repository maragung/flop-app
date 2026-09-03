// did.js — Ed25519 did:key identity, entirely in the browser.
// Key format matches technocore.chat / kibble: did:key:z6Mk… (multicodec
// ed25519-pub, base58btc), signatures are base64url unpadded, and the
// canonical string signed for a room write is `<room>|<nonce>|<text>`
// where <text> is the single-line-swept message the server will store.
import { etc, getPublicKey, sign as edSign, verify as edVerify } from '@noble/ed25519'
import { sha512 } from '@noble/hashes/sha2.js'
import { base58 } from '@scure/base'

// noble v2's sync sign/getPublicKey need a sync sha512; the pure-JS one works
// in every context (including pages opened from file:// where WebCrypto is absent).
etc.sha512Sync = (...m) => sha512(etc.concatBytes(...m))

export const hexToBytes = (hex) => {
  const clean = hex.trim().toLowerCase().replace(/^0x/, '')
  if (!/^[0-9a-f]*$/.test(clean) || clean.length % 2 !== 0) {
    throw new Error('Invalid hex string')
  }
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  return out
}

export const bytesToHex = (bytes) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

export function randomSeedHex() {
  const b = new Uint8Array(32)
  crypto.getRandomValues(b)
  return bytesToHex(b)
}

export function validateSeedHex(hex) {
  const clean = hex.trim().toLowerCase().replace(/^0x/, '')
  if (!/^[0-9a-f]{64}$/.test(clean)) throw new Error('Private key must be 64 hex characters (32 bytes)')
  return clean
}

export async function didFromSeed(seedHex) {
  const pub = getPublicKey(hexToBytes(seedHex))
  // multicodec ed25519-pub = varint 0xed 0x01, then the 32-byte public key
  const mc = new Uint8Array(2 + pub.length)
  mc[0] = 0xed
  mc[1] = 0x01
  mc.set(pub, 2)
  return 'did:key:z' + base58.encode(mc)
}

// Unicode general categories Cc Cf Cs Co Zl Zp -> space, then trim.
// This is the server's single-line sweep; the signature must cover the
// text AS SWEPT, not as typed.
export function sweep(text) {
  return String(text).replace(/[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Zl}\p{Zp}]/gu, ' ').trim()
}

export function toBase64UrlNoPad(bytes) {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// Sign `<room>|<nonce>|<text>` — returns { sig, nonce, text } ready for the wire.
export async function signRoomMessage(seedHex, room, text, lastNonce = 0) {
  const swept = sweep(text)
  if (!swept) throw new Error('Message is empty after the single-line sweep')
  if (swept.length > 4096) throw new Error(`Message is ${swept.length} chars; the cap is 4096`)
  let nonce = Math.max(Date.now(), Number(lastNonce) + 1)
  const canonical = `${room}|${nonce}|${swept}`
  const sig = toBase64UrlNoPad(edSign(new TextEncoder().encode(canonical), hexToBytes(seedHex)))
  return { sig, nonce: String(nonce), text: swept }
}

// Verify a stored room record's signature against `<room>|<nonce>|<text>`.
// Mirrors the server: the sig covers the swept text exactly as stored.
export function verifyRoomMessage(did, room, nonce, text, sig) {
  try {
    if (!did?.startsWith('did:key:z6Mk') || !sig || !nonce) return false
    const mc = base58.decode(did.slice('did:key:z'.length))
    if (mc[0] !== 0xed || mc[1] !== 0x01) return false
    const pub = mc.slice(2)
    const canonical = new TextEncoder().encode(`${room}|${nonce}|${text}`)
    const b64 = sig.replace(/-/g, '+').replace(/_/g, '/')
    const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : ''
    const bin = atob(b64 + pad)
    const sigBytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) sigBytes[i] = bin.charCodeAt(i)
    return edVerify(sigBytes, canonical, pub)
  } catch {
    return false
  }
}

// did:key:z6Mk… -> short, human-comparable fingerprint
export function shortDid(did, n = 10) {
  if (!did) return ''
  return did.startsWith('did:key:z6Mk') ? `z6Mk…${did.slice(-4)}` : did.length > n + 3 ? `${did.slice(0, n)}…` : did
}

export function shortAny(id, n = 14) {
  if (!id) return '—'
  return id.length > n + 3 ? `${id.slice(0, n)}…` : id
}
