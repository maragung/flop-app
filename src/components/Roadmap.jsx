import { useI18n } from '../lib/i18n'

// Source: flop.finance/teaser (v0.1 draft, updated 2026-08-26) — every date below is
// a plan from that draft, not a promise. The Yellow Paper is the definitive spec.
const TESTNET_START = new Date('2026-10-01T00:00:00Z') // Q4 2026
const MAINNET_START = new Date('2027-01-01T00:00:00Z') // Q1 2027
const DAY = 86400000

const PHASES = [
  {
    id: 'now',
    when: 'Now · until Q4 2026',
    title: 'Pre-testnet',
    status: 'active',
    points: [
      'Teaser v0.1 (draft, 2026-08-26) is published; the Yellow Paper — the definitive spec — is not yet final.',
      'Apply forms are open: GPU providers (miners), validators, KOLs & creators — flop.finance/apply.',
      'Follow @flop_labs — the only official airdrop-eligibility channel.',
      'Practice the agent loop on the kibble board (ask → do → check → attest) while you wait.',
    ],
  },
  {
    id: 'testnet',
    when: 'Q4 2026 · ~90 days',
    title: 'Testnet — the full rehearsal',
    status: 'future',
    points: [
      'Everything runs in test tokens: miners serve real inference, validators produce blocks and check work certificates, agents buy compute.',
      'Participation is what earns the 3.5bn $FLOP genesis airdrop — miners by compute delivered, agents by inference spent, validators by performance.',
      'The top 1,000 validators on uptime, block production, accuracy and latency make the mainnet set.',
    ],
  },
  {
    id: 'settle',
    when: 'End of testnet',
    title: 'Settlement into the genesis block',
    status: 'future',
    points: [
      'Testnet results are settled into the genesis block.',
      'The bulk of the pool is expected to be distributed at the token generation event; any remainder released at a later stage.',
    ],
  },
  {
    id: 'mainnet',
    when: 'Q1 2027',
    title: 'Mainnet + TGE',
    status: 'future',
    points: [
      'Miners: ~¼ of their airdrop liquid at TGE, the rest over the opening months of mainnet while they keep serving compute.',
      'Agents: airdrop arrives locked — every 3 $FLOP spent on inference unlocks 1 airdropped $FLOP (inference or staking only).',
      'Validators: their airdrop is their bonded stake — slashing collateral, not a payout.',
      'Block rewards start: 96 $FLOP per 1-second block, halving every 730 days.',
    ],
  },
  {
    id: 'h1',
    when: '~2 years after mainnet',
    title: 'First halving',
    status: 'future',
    points: [
      'Block reward halves 96 → 48 $FLOP.',
      'Validator airdrop stake is locked through this halving, then released over the following 1,000 days.',
      'Until the first halving, only the Flop Foundation may submit FIPs (⅔ of the active validator set must approve one).',
    ],
  },
  {
    id: 'h2-5',
    when: 'Every 730 days',
    title: 'Halvings 2–5',
    status: 'future',
    points: [
      'Block reward steps 48 → 24 → 12 → 6 → 3 $FLOP on the same 730-day cadence.',
      'Cumulative supply approaches the year-10 figure of 17.2bn $FLOP.',
    ],
  },
  {
    id: 'y10',
    when: 'Year 10',
    title: 'The reward floor',
    status: 'future',
    points: [
      'After the fifth halving the block reward stays at 3 $FLOP forever — a permanent security budget (~0.6% terminal inflation).',
      'The Team + Foundation allocation (8 + 8 $FLOP per block) sunsets after year ten.',
    ],
  },
  {
    id: 'ongoing',
    when: 'Ongoing',
    title: 'Continuous work',
    status: 'future',
    points: [
      'Foundation core-dev goal: push block times below one second for near-instant agent payments.',
      'Validator set capped at 1,000 — every month the worst-performing 50 are replaced by the top 50 in waiting.',
      'Native HTLC lets agents exchange $FLOP for other cryptocurrencies without a bridge.',
    ],
  },
]

function daysUntil(target, now) {
  return Math.max(0, Math.ceil((target.getTime() - now.getTime()) / DAY))
}

export default function Roadmap() {
  const { t } = useI18n()
  const now = new Date()

  return (
    <div className="grid">
      <div className="card toky">
        <h2 className="toktitle">{t('rm_hero')}</h2>
        <p className="toktag">$FLOP is food for your AI agent.</p>
        <div className="statrow" style={{ marginTop: 16 }}>
          <div className="stat">
            <b>{daysUntil(TESTNET_START, now)}</b>
            <span>days until planned testnet (Q4 2026)</span>
          </div>
          <div className="stat">
            <b>{daysUntil(MAINNET_START, now)}</b>
            <span>days until planned mainnet (Q1 2027)</span>
          </div>
          <div className="stat">
            <b>~90</b>
            <span>testnet duration (days)</span>
          </div>
          <div className="stat">
            <b>3.5bn</b>
            <span>$FLOP genesis airdrop pool</span>
          </div>
        </div>
      </div>

      <div className="card">
        <ol className="timeline">
          {PHASES.map((p) => (
            <li key={p.id} className={`tlitem ${p.status === 'active' ? 'active' : ''}`}>
              <span className="tldot" aria-hidden="true" />
              <div className="tlbody">
                <div className="spread">
                  <h3 style={{ margin: 0 }}>{p.title}</h3>
                  <span className={`badge ${p.status === 'active' ? 'open' : ''}`}>{p.when}</span>
                </div>
                {p.status === 'active' && (
                  <div className="tlhere">◂ {t('rm_here')}</div>
                )}
                <ul className="small muted" style={{ paddingLeft: 18, margin: '8px 0 0' }}>
                  {p.points.map((pt, i) => <li key={i} style={{ marginBottom: 4 }}>{pt}</li>)}
                </ul>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className="note warn">
        <b>Draft — every date on this page is a plan, not a promise.</b> All of it comes from the
        flop.finance teaser (v0.1 draft, updated 2026-08-26); the figures are provisional and the
        Yellow Paper — not yet final — is the definitive specification.
      </div>
    </div>
  )
}
