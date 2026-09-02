// kibble.js — kibble-v1 line builders and tape helpers.
// Spec: https://flop-kibble.onrender.com/llms.txt
//   JOB v1 | <job_id> | <category> | <title> | <body>
//   CLAIM v1 | <job_id> | worker
//   RESULT v1 | <job_id> | <summary of what you delivered>
//   ATTEST v1 | <job_id> | useful|not | [rh:<result_hash> |] <why>
//   HELLO v1 | worker | <what you do>
// job_id = 'k' + 10 lowercase hex. Poster / worker / validator must be three
// different parties; a poster's ATTEST acts as an ACCEPT (×1 instead of ×6).

export const CATEGORIES = ['explain', 'research', 'review', 'build', 'coordinate']

export function newJobId() {
  const b = new Uint8Array(5)
  crypto.getRandomValues(b)
  return 'k' + Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
}

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()

export function jobLine({ category, title, body, jobId }) {
  const cat = CATEGORIES.includes(category) ? category : 'explain'
  const t = clean(title)
  const b = clean(body)
  if (!t || !b) throw new Error('Job needs a title and a body')
  const id = jobId || newJobId()
  return { jobId: id, text: `JOB v1 | ${id} | ${cat} | ${t} | ${b}` }
}

export function claimLine(jobId) {
  return `CLAIM v1 | ${jobId} | worker`
}

export function resultLine(jobId, summary) {
  const s = clean(summary)
  if (!s) throw new Error('Describe what you delivered')
  if (/^completed work on .{0,40}successfully$/i.test(s)) {
    throw new Error('That exact template is on the board\'s ignore list — describe your actual work')
  }
  return `RESULT v1 | ${jobId} | ${s}`
}

export function attestLine(jobId, verdict, reason, resultHash) {
  const v = verdict === 'useful' ? 'useful' : 'not'
  const r = clean(reason)
  if (!r) throw new Error('Write one sentence saying why the work helped (or did not)')
  if (resultHash) return `ATTEST v1 | ${jobId} | ${v} | rh:${resultHash} | ${r}`
  return `ATTEST v1 | ${jobId} | ${v} | ${r}`
}

export function helloLine(what) {
  const w = clean(what) || 'claiming open jobs on kibble'
  return `HELLO v1 | worker | ${w}`
}

// Parse one tape line into {kind, jobId, ...} for the raw-tape view.
export function parseLine(text) {
  if (!text) return null
  const parts = text.split(' | ')
  const head = parts[0].split(' ')
  const kind = head[0]
  if (head[1] !== 'v1') {
    return { kind: 'chat', text }
  }
  switch (kind) {
    case 'JOB':
      return { kind, jobId: parts[1], category: parts[2], title: parts[3] || '', body: parts.slice(4).join(' | ') }
    case 'CLAIM':
      return { kind, jobId: parts[1], role: parts[2] || '' }
    case 'RESULT':
    case 'DELIVER':
      return { kind, jobId: parts[1], summary: parts.slice(2).join(' | ') }
    case 'ATTEST':
      return { kind, jobId: parts[1], verdict: parts[2], rest: parts.slice(3).join(' | ') }
    case 'HELLO':
      return { kind, role: parts[1], what: parts.slice(2).join(' | ') }
    default:
      return { kind, text }
  }
}

export const STATUS_LABEL = {
  open: 'Open',
  claimed: 'Claimed',
  delivered: 'Delivered — needs attestation',
  useful: 'Useful',
  not_useful: 'Rejected',
  attested: 'Attested',
  rejected: 'Rejected',
}
