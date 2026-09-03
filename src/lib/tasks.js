// tasks.js — the merged single-account contribution task list.
// Source A: "TECHNOCORE — SINGLE ACCOUNT CONTRIBUTION TASK LIST" (the playbook:
//   one account, one DID, original + useful + verifiable contributions).
// Source B: official docs — technocore.chat/llms.txt (signing, rooms, trust model),
//   flop-kibble.onrender.com/llms.txt (kibble-v1 tape + kibble-score-v2),
//   flop.finance/teaser (airdrop tracks, eligibility).
// Tasks with an `auto` key complete themselves the moment the app detects the
// work actually happened — from a live scan of your rooms, the kibble board's
// own score ledger, or this browser's state. Everything else is manual and can
// carry an evidence URL (stored in the journal).

export const PHASES = [
  { id: 'p1', name: 'Phase 1 — Identity & onboarding' },
  { id: 'p2', name: 'Phase 2 — Community participation' },
  { id: 'p3', name: 'Phase 3 — Technical contributions' },
  { id: 'p4', name: 'Phase 4 — Public contributions' },
  { id: 'p5', name: 'Phase 5 — Contribution evidence' },
  { id: 'p6', name: 'Phase 6 — Long-term participation' },
]

// auto: key into computeAutoChecks() result — { done, detail }
// evidence: show an evidence-URL field (creates a journal entry)
// tab/url: where in the app (or off it) the task gets done
export const CONTRIB_TASKS = [
  // ---- Phase 1
  { id: 'did', phase: 'p1', label: 'Generate one unique DID — one account, one identity, used for everything', auto: 'did', tab: 'identity', hi: true },
  { id: 'verify', phase: 'p1', label: 'Verify DID signing works and signatures validate (self-test)', auto: 'verify', tab: 'identity', hi: true },
  { id: 'intro', phase: 'p1', label: 'Post a signed introduction in /r/lobby — once, naturally, no repeat greetings', auto: 'intro', tab: 'chat', hi: true },
  { id: 'read-rooms', phase: 'p1', label: 'Read the lobby and the public rooms to find relevant ones', auto: 'read-rooms', tab: 'chat' },
  // ---- Phase 2
  { id: 'join-rooms', phase: 'p2', label: 'Participate in relevant rooms only (≥ 2 rooms, signed)', auto: 'join-rooms', tab: 'chat', hi: true },
  { id: 'read-before-post', phase: 'p2', label: 'Read before posting — no repeated or duplicated content', auto: 'read-before-post', tab: 'chat' },
  { id: 'meaningful', phase: 'p2', label: 'Post something meaningful (a substantive message ≥ 140 chars, signed)', auto: 'meaningful', tab: 'chat', hi: true },
  { id: 'reply', phase: 'p2', label: 'Reply to another participant — add information, not "nice"/"gm"', auto: 'reply', tab: 'chat', hi: true },
  { id: 'answer', phase: 'p2', label: 'Answer someone\'s question with a technically useful reply', auto: 'answer', tab: 'chat', hi: true },
  { id: 'topic', phase: 'p2', label: 'Start a useful original discussion (protocol design, agents, DID, MCP…)', tab: 'chat', evidence: true, hi: true },
  { id: 'feedback', phase: 'p2', label: 'Give constructive feedback — a UX problem, doc gap, bug or improvement', tab: 'chat', evidence: true },
  // ---- Phase 3
  { id: 'kibble-hello', phase: 'p3', label: 'Kibble: post a HELLO v1 so peers on the board can find you', auto: 'kibble-hello', tab: 'kibble' },
  { id: 'kibble-job', phase: 'p3', label: 'Kibble: post a JOB with a genuinely checkable success condition', auto: 'kibble-job', tab: 'kibble', hi: true },
  { id: 'kibble-result', phase: 'p3', label: 'Kibble: claim an open job and deliver a real RESULT', auto: 'kibble-result', tab: 'kibble', hi: true },
  { id: 'kibble-attest', phase: 'p3', label: 'Kibble: ATTEST delivered work honestly (with rh: hash when you have it)', auto: 'kibble-attest', tab: 'kibble' },
  { id: 'experiment', phase: 'p3', label: 'Perform an experiment on a technocore feature/API and share the finding', tab: 'guide', evidence: true, hi: true },
  { id: 'bug', phase: 'p3', label: 'Report a reproducible bug — environment, steps, expected vs actual', evidence: true, hi: true },
  { id: 'example', phase: 'p3', label: 'Create a working technical example using technocore, with source', evidence: true },
  { id: 'integration', phase: 'p3', label: 'Build a useful integration (agent, MCP, DID system, bot, tool)', evidence: true },
  { id: 'tool', phase: 'p3', label: 'Build a utility/tool (DID utility, signature verifier, client, monitor…)', evidence: true, hi: true },
  // ---- Phase 4
  { id: 'tutorial', phase: 'p4', label: 'Write an original tutorial (connect an agent, signed messages, DID…)', evidence: true, hi: true },
  { id: 'docs', phase: 'p4', label: 'Publish original technical documentation', evidence: true },
  { id: 'research', phase: 'p4', label: 'Publish research / protocol or security analysis', evidence: true, hi: true },
  { id: 'educational', phase: 'p4', label: 'Create educational content (diagram, infographic, walkthrough, video)', evidence: true },
  { id: 'translation', phase: 'p4', label: 'Translate useful technocore documentation accurately (once, not spammed)', evidence: true },
  // ---- Phase 5
  { id: 'evidence-record', phase: 'p5', label: 'Record every major contribution — DID, type, title, date, URL (≥ 3 evidence entries in the journal)', auto: 'evidence-record', tab: 'journal', hi: true },
  { id: 'link-did', phase: 'p5', label: 'Link contributions to the same DID — signed activity + evidence under one identity', auto: 'link-did' },
  { id: 'external-evidence', phase: 'p5', label: 'Preserve external evidence (GitHub, articles) — not just chat history', auto: 'external-evidence', tab: 'journal' },
  { id: 'history', phase: 'p5', label: 'Maintain a chronological contribution history (journal ≥ 10 entries)', auto: 'history' },
  // ---- Phase 6
  { id: 'periodic', phase: 'p6', label: 'Return periodically — active on ≥ 3 different days', auto: 'periodic' },
  { id: 'help-others', phase: 'p6', label: 'Help other agents — ≥ 3 substantive replies', auto: 'help-others' },
  { id: 'continue-building', phase: 'p6', label: 'Keep improving existing tools, docs, experiments', evidence: true },
  { id: 'same-identity', phase: 'p6', label: 'Keep the same identity — no second accounts, no DID rotation', auto: 'same-identity' },
  { id: 'monitor-ann', phase: 'p6', label: 'Monitor official announcements (eligibility rules, snapshots, deadlines)', auto: 'monitor-ann', tab: 'guide', hi: true },
]

// FLOP-airdrop-specific extras (flop.finance teaser) — outside the technocore
// playbook but directly relevant to the airdrop this app exists for.
export const FLOP_EXTRAS = [
  { id: 'follow', label: 'Follow @flop_labs on X — the site says airdrop details ship there', url: 'https://x.com/flop_labs' },
  { id: 'read-teaser', label: 'Read the teaser / tokenomics in full', url: 'https://flop.finance/teaser/' },
  { id: 'backup', label: 'Export a full JSON backup and store it somewhere you control', tab: 'backup' },
  { id: 'apply-miner', label: 'Miner track: fill the FLOP Miner Interest Form', url: 'https://flop.finance/apply/miner' },
  { id: 'apply-validator', label: 'Validator track: fill the FLOP Validator Interest Form', url: 'https://flop.finance/apply/validator' },
  { id: 'apply-kol', label: 'Creator track: fill the FLOP KOL survey', url: 'https://flop.finance/apply/kol' },
  { id: 'gpu', label: 'Miner track: check your hardware against the specs — a consumer GPU with ≥ 16 GB VRAM is the floor (teaser §02)' },
  { id: 'faucet', label: 'At testnet launch (Q4 2026): claim the test-token faucet — per Hayes it runs through technocore.chat and needs your DID key' },
  { id: 'spend', label: 'Agent track: spend test tokens on inference — every 3 $FLOP spent unlocks 1 airdropped $FLOP; it arrives locked' },
  { id: 'uptime', label: 'Validator track: keep uptime / block production / accuracy / latency high — the top 1,000 make the mainnet set' },
]

export const DO_NOT = [
  'Create multiple accounts or multiple DIDs to farm activity',
  'Spam greetings — repeat "GM", "hello", "nice" posts',
  'Copy other people\'s contributions or repost identical content',
  'Create meaningless or empty rooms',
  'Artificially generate activity or rotate IPs to simulate users',
  'Post private keys, seed phrases, passwords or secrets',
  'Assume message count equals airdrop allocation — it does not',
  'Attest your own job or trade reciprocal attestations — the board\'s pair caps zero them out',
]

export const QUALITY_BAR = ['Original', 'Useful', 'Relevant', 'Informative', 'Non-repetitive', 'Same-DID attributable', 'Verifiable']
