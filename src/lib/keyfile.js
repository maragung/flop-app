// keyfile.js — PEM export/import for the Ed25519 seed, 100% client-side and
// insecure-context safe (no crypto.subtle — only @noble/hashes + @noble/ciphers).
//
// Formats:
//   plain PEM  — PKCS#8 (RFC 5958) Ed25519 private key (RFC 8410):
//                -----BEGIN PRIVATE KEY-----   (48-byte DER, prefix
//                302e020100300506032b657004220420 + 32-byte seed)
//   encrypted  — PKCS#8 PBES2 (RFC 8018): PBKDF2-HMAC-SHA256 (600k rounds,
//                16-byte salt) + AES-256-CBC with random IV:
//                -----BEGIN ENCRYPTED PRIVATE KEY-----
// Both are the same files `openssl` produces/reads, so the export works with
// standard tooling: openssl pkey -in key.pem -passin pass:…
import { pbkdf2 } from '@noble/hashes/pbkdf2.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { cbc } from '@noble/ciphers/aes.js'

const PBKDF2_ITERS = 600_000
const KEY_LEN = 32

// ---- tiny DER ---------------------------------------------------------------

const enc = (n) => new Uint8Array([n])

function derLen(n) {
  if (n < 0x80) return enc(n)
  if (n < 0x100) return new Uint8Array([0x81, n])
  return new Uint8Array([0x82, n >> 8, n & 0xff])
}

function tlv(tag, body) {
  const l = derLen(body.length)
  const out = new Uint8Array(1 + l.length + body.length)
  out[0] = tag
  out.set(l, 1)
  out.set(body, 1 + l.length)
  return out
}

const derSeq = (...parts) => tlv(0x30, concat(parts))
const derInt = (n) => tlv(0x02, n === 0 ? enc(0) : bytesOfInt(n))
const derOct = (b) => tlv(0x04, b)

function bytesOfInt(n) {
  const bytes = []
  while (n > 0) { bytes.unshift(n & 0xff); n = Math.floor(n / 256) }
  if (bytes[0] > 0x7f) bytes.unshift(0x00) // keep it positive
  return new Uint8Array(bytes)
}

// OID from dotted string, e.g. '1.2.840.113549.1.5.12'
function derOid(oid) {
  const parts = oid.split('.').map(Number)
  const body = [parts[0] * 40 + parts[1]]
  for (const p of parts.slice(2)) {
    let stack = [p & 0x7f]
    let v = Math.floor(p / 128)
    while (v > 0) { stack.unshift((v & 0x7f) | 0x80); v = Math.floor(v / 128) }
    body.push(...stack)
  }
  return tlv(0x06, new Uint8Array(body))
}

function concat(parts) {
  const len = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(len)
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return out
}

// Minimal DER reader: returns [tag, content, rest] per TLV.
function readTLV(buf, at = 0) {
  const tag = buf[at]
  let len = buf[at + 1]
  let hdr = 2
  if (len & 0x80) {
    const n = len & 0x7f
    len = 0
    for (let i = 0; i < n; i++) len = len * 256 + buf[at + 2 + i]
    hdr = 2 + n
  }
  return { tag, content: buf.slice(at + hdr, at + hdr + len), rest: at + hdr + len }
}

function b64(bytes) {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

function unb64(s) {
  const bin = atob(s.replace(/\s+/g, ''))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function pemWrap(label, bytes) {
  const b = b64(bytes)
  const lines = b.match(/.{1,64}/g) || []
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`
}

// ---- plain PKCS#8 Ed25519 ----------------------------------------------------

const PKCS8_PREFIX = new Uint8Array([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20])

export function seedToPkcs8(seed) {
  if (seed.length !== 32) throw new Error('seed must be 32 bytes')
  const der = new Uint8Array(48)
  der.set(PKCS8_PREFIX, 0)
  der.set(seed, 16)
  return der
}

export function seedToPem(seedBytes) {
  return pemWrap('PRIVATE KEY', seedToPkcs8(seedBytes))
}

function pkcs8ToSeed(der) {
  if (der.length !== 48) throw new Error('not an Ed25519 PKCS#8 key')
  for (let i = 0; i < 16; i++) {
    if (der[i] !== PKCS8_PREFIX[i]) throw new Error('not an Ed25519 PKCS#8 key')
  }
  return der.slice(16)
}

// ---- encrypted PKCS#8 (PBES2 / PBKDF2-SHA256 / AES-256-CBC) -----------------

const OID_PBES2 = '1.2.840.113549.1.5.13'
const OID_PBKDF2 = '1.2.840.113549.1.5.12'
const OID_HMAC_SHA256 = '1.2.840.113549.2.9'
const OID_AES256_CBC = '2.16.840.1.101.3.4.1.42'

function randomBytes(n) {
  const b = new Uint8Array(n)
  crypto.getRandomValues(b)
  return b
}

export function encryptSeedToPem(seedBytes, passphrase, { iterations = PBKDF2_ITERS } = {}) {
  if (seedBytes.length !== 32) throw new Error('seed must be 32 bytes')
  if (!passphrase || passphrase.length < 8) throw new Error('Passphrase must be at least 8 characters')
  const salt = randomBytes(16)
  const iv = randomBytes(16)
  const key = pbkdf2(sha256, passphrase, salt, { c: iterations, dkLen: KEY_LEN })
  const plain = seedToPkcs8(seedBytes)
  const ciphertext = cbc(key, iv).encrypt(plain)

  const kdfParams = derSeq(
    derOct(salt),
    derInt(iterations),
    derInt(KEY_LEN),
    derSeq(derOid(OID_HMAC_SHA256)),
  )
  const kdfAlgId = derSeq(derOid(OID_PBKDF2), kdfParams)
  const encAlgId = derSeq(derOid(OID_AES256_CBC), derOct(iv))
  const pbes2Params = derSeq(kdfAlgId, encAlgId)
  // EncryptedPrivateKeyInfo ::= SEQUENCE { AlgorithmIdentifier, OCTET STRING }
  const epki = derSeq(
    derSeq(derOid(OID_PBES2), pbes2Params),
    derOct(ciphertext),
  )
  return pemWrap('ENCRYPTED PRIVATE KEY', epki)
}

export function decryptPemToSeed(pem, passphrase) {
  const m = pem.match(/-----BEGIN ([A-Z ]+)-----([A-Za-z0-9+/=\s]+)-----END \1-----/)
  if (!m) throw new Error('Not a PEM file')
  const der = unb64(m[2])
  if (m[1] === 'PRIVATE KEY') return pkcs8ToSeed(der)
  if (m[1] !== 'ENCRYPTED PRIVATE KEY') throw new Error(`Unsupported PEM type: ${m[1]}`)

  // EncryptedPrivateKeyInfo ::= SEQUENCE { AlgorithmIdentifier, encryptedData }
  let t = readTLV(der)
  if (t.tag !== 0x30) throw new Error('bad encrypted key')
  let alg = readTLV(t.content)
  // tolerate a leading version INTEGER (non-standard but harmless)
  if (alg.tag === 0x02) alg = readTLV(t.content, alg.rest)
  const data = readTLV(t.content, alg.rest) // encryptedData OCTET STRING
  if (data.tag !== 0x04) throw new Error('bad encrypted key body')

  // alg = AlgorithmIdentifier { OID(pbes2), SEQUENCE { kdfAlgId, encAlgId } }
  const pbes2Oid = readTLV(alg.content)
  const pbes2Hex = Array.from(pbes2Oid.content).map((b) => b.toString(16).padStart(2, '0')).join('')
  if (pbes2Oid.tag !== 0x06 || pbes2Hex !== '2a864886f70d01050d') throw new Error('unsupported encryption (need PBES2)')
  const params = readTLV(alg.content, pbes2Oid.rest)
  const kdf = readTLV(params.content)
  const encScheme = readTLV(params.content, kdf.rest)
  const kdfOid = readTLV(kdf.content)
  const kdfOidHex = Array.from(kdfOid.content).map((b) => b.toString(16).padStart(2, '0')).join('')
  if (kdfOid.tag !== 0x06 || kdfOidHex !== '2a864886f70d01050c') throw new Error('unsupported key derivation (need PBKDF2)')
  const kdfParams = readTLV(kdf.content, kdfOid.rest)

  // kdfParams = SEQUENCE { salt OCTET, iter INT, [keyLen INT], [prf SEQ] }
  const saltT = readTLV(kdfParams.content)
  const iterT = readTLV(kdfParams.content, saltT.rest)
  let next = readTLV(kdfParams.content, iterT.rest)
  let keyLen = KEY_LEN
  if (next.tag === 0x02) { // optional keyLength
    keyLen = 0
    for (const b of next.content) keyLen = keyLen * 256 + b
    next = readTLV(kdfParams.content, next.rest)
  }
  if (next.tag === 0x30) { // optional prf AlgorithmIdentifier — must be HMAC-SHA256
    const prfOid = readTLV(next.content)
    const prf = Array.from(prfOid.content).map((b) => b.toString(16).padStart(2, '0')).join('')
    if (prf !== '2a864886f70d0209') throw new Error('unsupported PRF (need hmacWithSHA256)')
  }
  const encOid = readTLV(encScheme.content)
  const encOidHex = Array.from(encOid.content).map((b) => b.toString(16).padStart(2, '0')).join('')
  if (encOidHex !== '60864801650304012a') throw new Error('unsupported cipher (need AES-256-CBC)')
  const ivT = readTLV(encScheme.content, encOid.rest)

  const iter = Number(Array.from(iterT.content).reduce((n, b) => n * 256 + b, 0))
  const key = pbkdf2(sha256, passphrase, saltT.content, { c: iter, dkLen: keyLen })
  let plain
  try {
    plain = cbc(key, ivT.content).decrypt(data.content)
  } catch {
    throw new Error('Wrong passphrase or corrupted key')
  }
  return pkcs8ToSeed(plain)
}

export function pemLooksEncrypted(text) {
  return /-----BEGIN ENCRYPTED PRIVATE KEY-----/.test(text)
}

export function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function hexToBytes(hex) {
  const clean = hex.trim().toLowerCase().replace(/^0x/, '')
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  return out
}
