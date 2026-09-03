// share.js — build a unique "task completed" tweet for the Share-on-X button.
// Composition: random OPENER × random CLOSER (10 × 10 = 100 combinations per
// task) + the task label + the user's DID at the bottom. The store remembers
// which opener/closer pairs were already used per task, so tweets never repeat
// until all 100 combinations of that task are spent — the anti-duplicate
// guarantee X's spam filters (and the never-do list) ask for.

export const TWEET_OPENERS = Array.from({ length: 10 }, (_, i) => 'tw_o' + (i + 1))
export const TWEET_CLOSERS = Array.from({ length: 10 }, (_, i) => 'tw_c' + (i + 1))

// stay under X's 280-char limit (278 leaves headroom for count oddities)
const MAX = 278

export function buildTaskTweet(t, taskId, did, used = []) {
  const usedSet = new Set(used.map((u) => u.join(',')))
  const label = t('task_' + taskId).split(' — ')[0].split(' (')[0]
  const all = []
  for (const o of TWEET_OPENERS) for (const c of TWEET_CLOSERS) all.push([o, c])
  // fresh = combinations this task has not tweeted yet; empty → start a new round
  const fresh = all.filter((p) => !usedSet.has(p.join(',')))
  const pool = fresh.length > 0 ? fresh : all
  const compose = (o, c, lbl) => `${t(o)} ${lbl}.\n${t(c)}\n${did}`

  // random pick first — variety over minimalism; 12 tries at the cap
  let best = null
  for (let i = 0; i < 12 && !best; i++) {
    const [o, c] = pool[Math.floor(Math.random() * pool.length)]
    const text = compose(o, c, label)
    if (text.length <= MAX) best = { text, combo: [o, c] }
  }
  // nothing random fits → the SHORTEST opener/closer pair; if even that
  // overflows, trim the label on a word boundary — never mid-word
  if (!best) {
    const [o, c] = [...all].sort((a, b) => (t(a[0]).length + t(a[1]).length) - (t(b[0]).length + t(b[1]).length))[0]
    const head = `${t(o)} `
    const tail = `.\n${t(c)}\n${did}`
    const room = MAX - head.length - tail.length
    let lbl = label
    if (lbl.length > room) {
      let cut = lbl.slice(0, Math.max(0, room - 1)) // -1 leaves room for the ellipsis
      const sp = cut.lastIndexOf(' ')
      if (sp > 0) cut = cut.slice(0, sp)
      lbl = cut.trimEnd() + '…'
    }
    best = { text: (head + lbl + tail).slice(0, MAX), combo: [o, c] }
  }
  return best
}

export function tweetUrl(text) {
  return 'https://x.com/intent/tweet?text=' + encodeURIComponent(text)
}
