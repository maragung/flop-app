import { useMemo, useRef, useState } from 'react'
import { useI18n } from '../lib/i18n.js'
import {
  monthlySupply, halvingSchedule, ALLOCATIONS, AIRDROP_BREAKDOWN,
  TOTAL_BY_Y10, TERMINAL_INFLATION,
} from '../lib/tokenomics.js'

const bn = (n, digits = 2) => `${(n / 1e9).toFixed(digits)}bn`
const MONTHS = monthlySupply()

// ---- cumulative supply chart -------------------------------------------------

const W = 760, H = 300
const M = { top: 26, right: 18, bottom: 30, left: 52 }
const PW = W - M.left - M.right
const PH = H - M.top - M.bottom
const Y_MAX = 17.5e9
const xOf = (m) => M.left + (m / 120) * PW
const yOf = (v) => M.top + PH - (v / Y_MAX) * PH

function SupplyChart() {
  const [hover, setHover] = useState(null) // month index
  const svgRef = useRef(null)

  const { line, area } = useMemo(() => {
    let d = ''
    for (const p of MONTHS) d += `${d ? 'L' : 'M'}${xOf(p.month).toFixed(1)},${yOf(p.supply).toFixed(1)}`
    return { line: d, area: `${d}L${xOf(120).toFixed(1)},${(M.top + PH).toFixed(1)}L${M.left},${(M.top + PH).toFixed(1)}Z` }
  }, [])

  const onMove = (e) => {
    const svg = svgRef.current
    if (!svg) return
    const r = svg.getBoundingClientRect()
    const px = ((e.clientX - r.left) / r.width) * W
    const m = Math.max(0, Math.min(120, Math.round(((px - M.left) / PW) * 120)))
    setHover(m)
  }

  const p = hover != null ? MONTHS[hover] : null
  const yGrid = [0, 4e9, 8e9, 12e9, 16e9]

  return (
    <div className="chartwrap">
      <svg
        ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="tokchart" role="img"
        aria-label="Cumulative $FLOP supply, TGE to year 10"
        onMouseMove={onMove} onMouseLeave={() => setHover(null)}
        onTouchStart={onMove} onTouchMove={onMove} onTouchEnd={() => setHover(null)}
      >
        {/* grid */}
        {yGrid.map((v) => (
          <g key={v}>
            <line x1={M.left} x2={W - M.right} y1={yOf(v)} y2={yOf(v)} className="gridline" />
            <text x={M.left - 8} y={yOf(v) + 4} className="tick" textAnchor="end">{v === 0 ? '0' : `${v / 1e9}bn`}</text>
          </g>
        ))}
        {[0, 24, 48, 72, 96, 120].map((m) => (
          <text key={m} x={xOf(m)} y={H - 8} className="tick" textAnchor="middle">{m === 0 ? 'TGE' : `Y${m / 12}`}</text>
        ))}
        {/* halving markers */}
        {[24, 48, 72, 96, 120].map((m, i) => (
          <g key={m}>
            <line x1={xOf(m)} x2={xOf(m)} y1={M.top} y2={M.top + PH} className="halving" />
            <text x={xOf(m)} y={M.top - 8} className="halvinglab" textAnchor={m === 120 ? 'end' : 'middle'}>H{i + 1}</text>
          </g>
        ))}
        {/* series */}
        <path d={area} className="supplyarea" />
        <path d={line} className="supplyline" />
        {/* direct label: the endpoint */}
        <text x={xOf(120) - 6} y={yOf(MONTHS[120].supply) - 8} className="endlab" textAnchor="end">
          {bn(MONTHS[120].supply, 1)}
        </text>
        {/* hover crosshair */}
        {p && (
          <g className="pointer-events-none">
            <line x1={xOf(p.month)} x2={xOf(p.month)} y1={M.top} y2={M.top + PH} className="crosshair" />
            <circle cx={xOf(p.month)} cy={yOf(p.supply)} r={4.5} className="hoverdot" />
          </g>
        )}
      </svg>
      {p && (
        <div
          className="charttip"
          style={{ left: `${(xOf(p.month) / W) * 100}%`, top: 0 }}
        >
          <b>Y{Math.floor(p.year)}{p.month % 12 ? ` · m${p.month % 12}` : ''}</b>
          <span>supply {bn(p.supply, 2)}</span>
          <span>block reward {p.reward} $FLOP/s</span>
        </div>
      )}
    </div>
  )
}

// ---- allocations donut -------------------------------------------------------

function arcPath(cx, cy, r1, r2, a0, a1) {
  const p = (r, a) => `${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`
  const large = a1 - a0 > Math.PI ? 1 : 0
  return `M${p(r2, a0)} A${r2},${r2} 0 ${large} 1 ${p(r2, a1)} L${p(r1, a1)} A${r1},${r1} 0 ${large} 0 ${p(r1, a0)} Z`
}

function AllocDonut({ onHover, hovered }) {
  const CX = 90, CY = 90, R1 = 58, R2 = 86
  let a = -Math.PI / 2
  const gap = 1.5 / ((R1 + R2) / 2) // ~1.5px gap between segments
  return (
    <svg viewBox="0 0 180 180" className="tokdonut" role="img" aria-label="Allocations donut">
      {ALLOCATIONS.map((s) => {
        const sweep = (s.pct / 100) * Math.PI * 2
        const d = arcPath(CX, CY, R1, R2, a + gap / 2, a + sweep - gap / 2)
        a += sweep
        return (
          <path
            key={s.key} d={d} className={`seg c-${s.key} ${hovered === s.key ? 'hot' : ''}`}
            onMouseEnter={() => onHover(s.key)} onMouseLeave={() => onHover(null)}
          />
        )
      })}
      {hovered ? (
        <>
          <text x={CX} y={CY - 4} className="centerbig" textAnchor="middle">
            {ALLOCATIONS.find((s) => s.key === hovered).tokens}bn
          </text>
          <text x={CX} y={CY + 14} className="centersmall" textAnchor="middle">
            {ALLOCATIONS.find((s) => s.key === hovered).label} · {ALLOCATIONS.find((s) => s.key === hovered).pct}%
          </text>
        </>
      ) : (
        <>
          <text x={CX} y={CY - 4} className="centerbig" textAnchor="middle">17.2bn</text>
          <text x={CX} y={CY + 14} className="centersmall" textAnchor="middle">year-10 supply</text>
        </>
      )}
    </svg>
  )
}

// ---- page -------------------------------------------------------------------

export default function Tokenomics() {
  const { t } = useI18n()
  const [hovered, setHovered] = useState(null)
  const schedule = useMemo(() => halvingSchedule(), [])

  return (
    <div className="grid">
      <div className="card toky">
        <h2 className="toktitle">{t('tok_hero')}</h2>
        <p className="toktag">{t('tok_earned')}</p>
        <div className="statrow" style={{ marginTop: 12 }}>
          <div className="stat"><b>17.2bn</b><span>total supply by year 10</span></div>
          <div className="stat"><b>0.6%</b><span>terminal inflation / yr</span></div>
          <div className="stat"><b>96</b><span>$FLOP per block at launch</span></div>
          <div className="stat"><b>1s</b><span>block time</span></div>
          <div className="stat"><b>730d</b><span>halving interval</span></div>
          <div className="stat"><b>100%</b><span>fair launch — no VC, no presale</span></div>
        </div>
        <p className="tiny muted" style={{ marginBottom: 0 }}>
          Model: 1-second blocks, 96 $FLOP per block halving every 730 days (5 halvings, then constant),
          plus 8 + 8 $FLOP per block to Flop Labs and the Foundation on the same schedule, sunsetting after year 10.
          Genesis pool 3.5bn. Hover the charts. Source: <a href="https://flop.finance/" target="_blank" rel="noreferrer">flop.finance ↗</a>
        </p>
      </div>

      <div className="card">
        <h3>{t('tok_cum')} <span className="muted small">— TGE → year 10, monthly, with halvings</span></h3>
        <SupplyChart />
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h3>{t('tok_alloc')} <span className="muted small">— end of year 10</span></h3>
          <div className="donutrow">
            <AllocDonut hovered={hovered} onHover={setHovered} />
            <div className="donutlegend">
              {ALLOCATIONS.map((s) => (
                <div
                  key={s.key} className={`legendrow ${hovered === s.key ? 'hot' : ''}`}
                  onMouseEnter={() => setHovered(s.key)} onMouseLeave={() => setHovered(null)}
                >
                  <span className={`swatch c-${s.key}`} aria-hidden="true" />
                  <span className="grow">{s.label}</span>
                  <span className="mono">{s.tokens}bn</span>
                  <span className="mono muted">{s.pct}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="card">
          <h3>{t('tok_genesis')} <span className="muted small">— 3.5bn, earned on testnet only</span></h3>
          <div className="bars">
            {AIRDROP_BREAKDOWN.map((s) => (
              <div key={s.label} className="barrow">
                <span className="barlab">{s.label}</span>
                <div className="bartrack"><div className="barfill" style={{ width: `${(s.tokens / 1.2) * 100}%` }} /></div>
                <span className="mono barval">{s.tokens.toFixed(2)}bn · {s.pct}%</span>
              </div>
            ))}
          </div>
          <p className="tiny muted" style={{ marginBottom: 0 }}>
            Testnet participation is the only path: compute delivered (miners), inference spend — every 3 $FLOP spent
            unlocks 1 airdropped (agents), top-1000 node performance (validators). Kibble reputation is advisory, not
            redeemable. Details: <a href="https://flop.finance/teaser/" target="_blank" rel="noreferrer">teaser §03–04 ↗</a>
          </p>
        </div>
      </div>

      <div className="card">
        <h3>{t('tok_halving')} <span className="muted small">— block reward path, community rewards</span></h3>
        <table className="toktable">
          <thead>
            <tr><th>Era</th><th>Window</th><th>$FLOP / block</th><th>Era emission</th><th>Cumulative supply</th></tr>
          </thead>
          <tbody>
            {schedule.map((r) => (
              <tr key={r.era}>
                <td>{r.era === 5 ? 'terminal' : `E${r.era}`}</td>
                <td>Y{r.fromYear} – Y{r.toYear}{r.era === 5 ? ' → forever' : ''}</td>
                <td className="mono">{r.reward}</td>
                <td className="mono">{bn(r.emission, 2)}</td>
                <td className="mono">{bn(r.cumulative, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="tiny muted" style={{ marginBottom: 0 }}>
          After the fifth halving the reward stays 3 $FLOP per block in perpetuity — {bn(TOTAL_BY_Y10, 1)} supply ×
          {' '}{(TERMINAL_INFLATION * 100).toFixed(1)}% ≈ the published 0.6% terminal inflation. Team + Foundation
          emissions (8 + 8 $FLOP per block, same halvings) end at year 10. Rows sum to 3.5bn genesis + 11.73bn
          community + 1.96bn team/foundation ≈ 17.2bn.
        </p>
      </div>

      <div className="note warn">{t('tok_draft')}</div>
    </div>
  )
}
