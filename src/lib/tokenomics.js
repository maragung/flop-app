// tokenomics.js — the $FLOP supply model, exactly as published on flop.finance
// (teaser v0.1 draft; figures preliminary). All numbers derive from four
// constants, and they reconcile with the published year-10 totals:
//
//   genesis 3.5bn + community block rewards 11.73bn + team/foundation 1.96bn
//     = 17.19bn ≈ "17.2bn total supply by year 10"
//   terminal reward 3 $FLOP/s ÷ 17.2bn ≈ 0.55%/yr ≈ "0.6% terminal inflation / yr"
//
// Model (per the teaser): 1-second blocks, 96 $FLOP per block at launch,
// halving every 730 days (5 halvings, then constant forever), plus 8 + 8
// $FLOP per block to Flop Labs and the Foundation on the same halving
// schedule, sunsetting after year 10.

export const GENESIS = 3.5e9
export const BLOCKS_PER_DAY = 86400 // 1-second blocks
export const HALVING_DAYS = 730
export const LAUNCH_REWARD = 96 // $FLOP per block, community rewards
export const TF_REWARD = 16 // 8 Flop Labs + 8 Foundation, per block
export const YEAR10_DAYS = 3650
export const MONTH_DAYS = 365 / 12

// Community reward at a given day (96, 48, 24, 12, 6, then 3 forever).
export function rewardAtDay(day) {
  return LAUNCH_REWARD / 2 ** Math.floor(day / HALVING_DAYS)
}

// Team + Foundation reward at a given day (sunsets after year 10).
export function tfRewardAtDay(day) {
  return day < YEAR10_DAYS ? TF_REWARD / 2 ** Math.floor(day / HALVING_DAYS) : 0
}

// Cumulative $FLOP supply at day `d` after TGE.
export function supplyAtDay(d) {
  let total = GENESIS
  let day = 0
  for (let era = 0; day < d; era++) {
    const eraEnd = Math.min((era + 1) * HALVING_DAYS, d)
    total += (eraEnd - day) * BLOCKS_PER_DAY * (LAUNCH_REWARD / 2 ** era)
    if (day < YEAR10_DAYS) {
      const tfEnd = Math.min(eraEnd, YEAR10_DAYS)
      total += (tfEnd - day) * BLOCKS_PER_DAY * (TF_REWARD / 2 ** era)
    }
    day = eraEnd
  }
  return total
}

// Monthly cumulative series, TGE → year 10 (121 points: months 0..120).
export function monthlySupply() {
  const pts = []
  for (let m = 0; m <= 120; m++) {
    const day = m * MONTH_DAYS
    pts.push({
      month: m,
      year: m / 12,
      day,
      supply: supplyAtDay(day),
      reward: rewardAtDay(Math.min(day, YEAR10_DAYS - 0.5)),
    })
  }
  return pts
}

export const TOTAL_BY_Y10 = supplyAtDay(YEAR10_DAYS) // ≈ 17.19bn
export const TERMINAL_INFLATION = (LAUNCH_REWARD / 32) * 31_536_000 / TOTAL_BY_Y10 // ≈ 0.0055

// ---- allocations (end of year 10, exactly as published on flop.finance) ----

export const ALLOCATIONS = [
  { key: 'airdrop', label: 'Genesis airdrop', tokens: 3.5, pct: 20.4 },
  { key: 'miners', label: 'Miners', tokens: 8.8, pct: 51.2 },
  { key: 'validators', label: 'Validators', tokens: 1.2, pct: 6.8 },
  { key: 'brokers', label: 'Brokers / agents', tokens: 1.2, pct: 6.8 },
  { key: 'team', label: 'Team + Foundation', tokens: 2.0, pct: 11.4 },
  { key: 'staking', label: 'Staking rewards', tokens: 0.6, pct: 3.4 },
]

export const AIRDROP_BREAKDOWN = [
  { label: 'Miners', tokens: 1.2, pct: 7.0 },
  { label: 'Validators', tokens: 0.31, pct: 1.8 },
  { label: 'Agents', tokens: 1.2, pct: 7.0 },
  { label: 'Reserve / incentives', tokens: 0.79, pct: 4.6 },
]

// Halving table: era, window, community block reward, era emission.
export function halvingSchedule() {
  const rows = []
  for (let era = 0; era <= 5; era++) {
    const from = era * HALVING_DAYS
    const to = from + HALVING_DAYS
    rows.push({
      era,
      fromYear: from / 365,
      toYear: to / 365,
      reward: LAUNCH_REWARD / 2 ** era,
      emission: HALVING_DAYS * BLOCKS_PER_DAY * (LAUNCH_REWARD / 2 ** era),
    })
  }
  return rows
}
