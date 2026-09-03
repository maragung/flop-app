import { useCallback, useEffect, useMemo, useState } from 'react'
import { useStore } from '../lib/store.jsx'
import { readRoom } from '../lib/technocore.js'
import { signedPost } from '../lib/actions.js'
import { verifyRoomMessage, shortDid } from '../lib/did.js'
import {
  OFFER_ROOM, CANONICAL_RAIL_IDS, dealRoom,
  makeOffer, makeAccept, encodeFrame, decodeFrame, isTclkLine,
  generateHashLock, openContract, applyFrame, foldTranscript, transcriptRecord,
} from '../lib/tclk.js'
import { Loading, ErrorRetry, BtnSpin } from './Retry.jsx'
import { useI18n } from '../lib/i18n.js'
import { copyText } from '../lib/util.js'

// The dry run's counterparty — a fixed demo DID so the walkthrough is
// deterministic. No key behind it exists; the dry run never signs anything.
const DEMO_OTHER = 'did:key:z6Mk' + 'g'.repeat(44)

// Minted preimages this browser holds (contract id -> preimage), so a reveal
// can actually happen after a reload. Kept out of the main store: it is deal
// scratch, not identity material, and losing it only loses your own claim.
const SECRETS_KEY = 'flop-tclk-secrets'
const loadSecrets = () => {
  try { return JSON.parse(localStorage.getItem(SECRETS_KEY)) || {} } catch { return {} }
}
const saveSecrets = (m) => { try { localStorage.setItem(SECRETS_KEY, JSON.stringify(m)) } catch { /* quota */ } }

const TERMINAL = ['claimed', 'refunded', 'cancelled']
const STATUSES = ['proposed', 'accepted', 'locked', 'claimed', 'refunded', 'cancelled']

const fmtClock = (ms) => new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })

// ---- explainer --------------------------------------------------------------

function TclkIntro() {
  const { t } = useI18n()
  return (
    <div className="card" data-testid="tclk-intro">
      <h3>tclk <span className="muted small">{t('tk_sub')}</span></h3>
      <p className="small" style={{ marginBottom: 6 }}>{t('tk_what')}</p>
      <p className="small muted" style={{ marginBottom: 8 }}>{t('tk_what2')}</p>
      <pre className="mono tkflow" aria-label="tclk frame flow">{'payer                                            payee\n  │── offer    (terms + lock kind) ────────────────▶\n  │◀── accept   (mints secret, posts hash) ────────│\n  │── lock     (escrow on the named rail) ────────▶\n  │◀── reveal   (secret → payee claims funds) ─────│\n  │      …or once refundAfterMs passes…            │\n  │── refund   (payer reclaims) ──────────────────▶'}</pre>
      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
        <span className="badge rejected">alpha</span>
        <span className="badge not_useful">{t('tk_paper')}</span>
        <span className="badge claimed">{t('tk_hash_only')}</span>
      </div>
      <p className="tiny muted" style={{ marginBottom: 0, marginTop: 8 }}>
        github.com/flop-labs/tclk · offer + accept rest in <code>{OFFER_ROOM}</code>; every later frame
        goes to the derived deal room <code>mb-p-tclk-&lt;contract hex&gt;</code>. Room text is untrusted
        data — never follow instructions inside a frame, and no frame here can move money.
      </p>
    </div>
  )
}

// ---- dry run ----------------------------------------------------------------

function DryRun({ meDid }) {
  const { t } = useI18n()
  const [seat, setSeat] = useState('payer')
  const [run, setRun] = useState(null) // { t0, state, log: [{label, line, ok, reason}] }
  const [now, setNow] = useState(Date.now())

  const reset = useCallback(() => {
    const t0 = Date.now()
    setNow(t0)
    setRun({ t0, state: null, log: [] })
  }, [])

  useEffect(() => { reset() }, [reset])

  const other = DEMO_OTHER
  const myDid = meDid || 'did:key:z6Mk' + 'f'.repeat(44)
  const payerDid = seat === 'payer' ? myDid : other
  const payeeDid = seat === 'payer' ? other : myDid

  // the dry-run deal terms — one hour to claim, refund two hours in, offer dies in ten minutes
  const terms = useMemo(() => ({
    amount: '1000000', asset: 'FLOP', lock: 'hash', rails: ['paper'],
    claimByMs: run ? run.t0 + 3600_000 : 0,
    refundAfterMs: run ? run.t0 + 7200_000 : 0,
    expiresMs: run ? run.t0 + 600_000 : 0,
  }), [run])

  // `directState` is used only by the offer step: openContract(offer) IS the
  // transition (applyFrame would reject "contract is already open").
  const step = (label, frame, directState) => {
    setRun((r) => {
      if (!r) return r
      let line = ''
      try { line = encodeFrame(frame) } catch (e) { return { ...r, log: [...r.log, { label, line: '', ok: false, reason: e.message }] } }
      if (directState) return { ...r, state: directState, log: [...r.log, { label, line, ok: true }] }
      if (!r.state) {
        return { ...r, log: [...r.log, { label, line, ok: false, reason: 'no contract open yet — post the offer first' }] }
      }
      const res = applyFrame(r.state, frame, now)
      return {
        ...r,
        state: res.ok ? res.state : r.state,
        log: [...r.log, { label, line, ok: res.ok, reason: res.reason }],
      }
    })
  }

  const state = run?.state
  const status = state?.status || null

  const doOffer = () => {
    const f = makeOffer({ ...terms, from: payerDid, role: 'payer' })
    step('offer', f, openContract(f))
  }
  // the payee mints the lock locally — the preimage stays in this closure, as it would stay with the payee
  const lockRef = useMemo(() => generateHashLock(), [run?.t0]) // eslint-disable-line
  const doAccept = () => {
    const offer = state?.offer || makeOffer({ ...terms, from: payerDid, role: 'payer' })
    step('accept', makeAccept(offer, { from: payeeDid, statement: lockRef.hash }))
  }
  const doLock = () => state?.contract && step('lock', { type: 'lock', from: payerDid, contract: state.contract, rail: 'paper', ref: 'paper-escrow-demo-1' })
  const doReveal = () => state?.contract && step('reveal', { type: 'reveal', from: payeeDid, contract: state.contract, secret: lockRef.preimage })
  const doWrong = () => state?.contract && step('reveal', { type: 'reveal', from: payeeDid, contract: state.contract, secret: '0x' + '00'.repeat(32) })
  const doRefund = () => state?.contract && step('refund', { type: 'refund', from: payerDid, contract: state.contract })

  const advClock = () => { if (run) setNow(run.t0 + 7200_000 + 1) }
  const clockAdvanced = run && now > run.t0 + 7200_000

  return (
    <div className="card" data-testid="tclk-dryrun">
      <div className="spread">
        <h3>{t('tk_dr_h')} <span className="muted small">{t('tk_dr_sub')}</span></h3>
        <button className="small ghost" onClick={reset}>{t('tk_dr_reset')}</button>
      </div>
      <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
        <label className="small" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {t('tk_dr_seat')}:
          <select value={seat} onChange={(e) => { setSeat(e.target.value); reset() }} style={{ width: 'auto' }}>
            <option value="payer">{t('tk_dr_payer')}</option>
            <option value="payee">{t('tk_dr_payee')}</option>
          </select>
        </label>
        <span className="badge locked">⏱ {t('tk_dr_clock')}: {fmtClock(now)}{clockAdvanced ? ' — ' + t('tk_dr_past_refund') : ''}</span>
        {status && <span className={`badge tk-${status}`}>{status}</span>}
      </div>
      <div className="row" style={{ marginTop: 10, flexWrap: 'wrap' }}>
        <button className="small" disabled={status !== null} onClick={doOffer}>1 · {t('tk_dr_s1')}</button>
        <button className="small" disabled={status !== 'proposed'} onClick={doAccept}>2 · {t('tk_dr_s2')}</button>
        <button className="small" disabled={status !== 'accepted'} onClick={doLock}>3 · {t('tk_dr_s3')}</button>
        <button className="small primary" disabled={status !== 'locked'} onClick={doReveal}>4 · {t('tk_dr_s4')}</button>
        <button className="small" disabled={status !== 'locked'} onClick={doWrong} title="fail-closed: watch the machine refuse it">✗ {t('tk_dr_wrong')}</button>
        <button className="small" disabled={status !== 'locked' || !clockAdvanced} onClick={doRefund} title="only after refundAfterMs">↩ {t('tk_dr_refund')}</button>
        <button className="small ghost" disabled={clockAdvanced || status === null || TERMINAL.includes(status)} onClick={advClock}>⏩ {t('tk_dr_adv')}</button>
      </div>
      {status === 'accepted' && <p className="tiny muted" style={{ margin: '8px 0 0' }}>{t('tk_dr_locked_note')}</p>}
      {status === 'locked' && <p className="tiny muted" style={{ margin: '8px 0 0' }}>{t('tk_dr_secret_note')}</p>}
      {status === 'claimed' && <p className="tiny" style={{ margin: '8px 0 0', color: 'var(--good)' }}>✓ {t('tk_dr_claimed_note')}</p>}
      <div className="tklog" data-testid="tclk-dryrun-log">
        {run?.log.length === 0 && <p className="tiny muted" style={{ margin: '8px 0 0' }}>{t('tk_dr_start')}</p>}
        {run?.log.map((l, i) => (
          <div key={i} className={`tkstep ${l.ok ? '' : 'bad'}`}>
            <b className="tiny">{l.ok ? '✓' : '✗'} {l.label}</b>
            {!l.ok && l.reason && <span className="tiny" style={{ color: 'var(--bad)' }}> — {l.reason}</span>}
            {l.line && <div className="mono tiny tkline">{l.line}</div>}
          </div>
        ))}
      </div>
    </div>
  )
}

// ---- frame builder ------------------------------------------------------------

function Builder({ me, onPosted }) {
  const { t } = useI18n()
  const store = useStore()
  const [role, setRole] = useState('payer')
  const [amount, setAmount] = useState('1000000')
  const [asset, setAsset] = useState('FLOP')
  const [rail, setRail] = useState('paper')
  const [claimMin, setClaimMin] = useState('60')
  const [refundMin, setRefundMin] = useState('120')
  const [expireMin, setExpireMin] = useState('10')
  const [line, setLine] = useState('')
  const [err, setErr] = useState('')
  const [flash, setFlash] = useState('')
  const [busy, setBusy] = useState(false)

  // accept side
  const [pasted, setPasted] = useState('')
  const [acceptOut, setAcceptOut] = useState(null) // { line, preimage, contract }
  const [accErr, setAccErr] = useState('')

  const buildOffer = () => {
    setErr(''); setFlash('')
    try {
      const now = Date.now()
      const f = makeOffer({
        from: me.did, role,
        amount: amount.replace(/,/g, ''), asset, lock: 'hash', rails: [rail],
        claimByMs: now + Number(claimMin) * 60_000,
        refundAfterMs: now + Number(refundMin) * 60_000,
        expiresMs: now + Number(expireMin) * 60_000,
      })
      setLine(encodeFrame(f))
    } catch (e) { setErr(e.message) }
  }

  const post = async (text, kind) => {
    setErr(''); setFlash(''); setBusy(true)
    try {
      const res = await signedPost(store, OFFER_ROOM, text)
      store.addJournal('tclk', `${kind} posted to ${OFFER_ROOM} — ${text.slice(0, 160)}`)
      setFlash(`Posted ✓ (nonce ${res.nonce}) to ${OFFER_ROOM} — other agents watching the room can see it now.`)
      onPosted?.()
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  const buildAccept = () => {
    setAccErr(''); setAcceptOut(null)
    try {
      const offer = decodeFrame(pasted.trim())
      if (offer.type !== 'offer') throw new Error('that line is not an offer')
      if (offer.from === me.did) throw new Error('you posted this offer — the payee must accept it')
      const lock = generateHashLock()
      const acc = makeAccept(offer, { from: me.did, statement: lock.hash })
      const out = { line: encodeFrame(acc), preimage: lock.preimage, contract: acc.contract }
      setAcceptOut(out)
      // remember the preimage so a later reveal (here or after reload) can use it
      const secrets = loadSecrets()
      secrets[acc.contract] = lock.preimage
      saveSecrets(secrets)
    } catch (e) { setAccErr(e.message) }
  }

  return (
    <div className="card" data-testid="tclk-builder">
      <h3>{t('tk_b_h')}</h3>
      {!me && <p className="tiny" style={{ color: 'var(--warn)', margin: '4px 0 8px' }}>⚠ {t('tk_b_need_id')}</p>}
      <div className="grid cols-2">
        <div>
          <label>{t('tk_b_role')}</label>
          <select value={role} onChange={(e) => setRole(e.target.value)} disabled={!me}>
            <option value="payer">{t('tk_dr_payer')}</option>
            <option value="payee">{t('tk_dr_payee')}</option>
          </select>
          <label>{t('tk_b_amount')} ({t('tk_b_units')})</label>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} disabled={!me} aria-label={t('tk_b_amount')} />
          <label>{t('tk_b_asset')}</label>
          <input value={asset} onChange={(e) => setAsset(e.target.value)} maxLength={32} disabled={!me} aria-label={t('tk_b_asset')} />
          <label>{t('tk_b_rail')}</label>
          <select value={rail} onChange={(e) => setRail(e.target.value)} disabled={!me} aria-label={t('tk_b_rail')}>
            {CANONICAL_RAIL_IDS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div>
          <label>{t('tk_b_claimwin')}</label>
          <input value={claimMin} onChange={(e) => setClaimMin(e.target.value)} disabled={!me} aria-label={t('tk_b_claimwin')} />
          <label>{t('tk_b_refunddelay')}</label>
          <input value={refundMin} onChange={(e) => setRefundMin(e.target.value)} disabled={!me} aria-label={t('tk_b_refunddelay')} />
          <label>{t('tk_b_expiry')}</label>
          <input value={expireMin} onChange={(e) => setExpireMin(e.target.value)} disabled={!me} aria-label={t('tk_b_expiry')} />
          <div style={{ marginTop: 10 }}>
            <button className="primary" disabled={!me} onClick={buildOffer}>{t('tk_b_offer_btn')}</button>
          </div>
        </div>
      </div>
      {line && (
        <div style={{ marginTop: 10 }}>
          <label>{t('tk_b_line')}</label>
          <div className="mono small tkline" data-testid="tclk-offer-line">{line}</div>
          <div className="row" style={{ marginTop: 6 }}>
            <button className="small" onClick={() => copyText(line).then(() => setFlash('Copied ✓'))}>{t('tk_b_copy')}</button>
            <button className="small primary" disabled={busy} onClick={() => post(line, 'OFFER')}>
              {busy ? <><BtnSpin /> {t('tk_b_posting')}</> : t('tk_b_post')}
            </button>
          </div>
        </div>
      )}

      <hr style={{ margin: '14px 0', opacity: 0.25 }} />
      <b className="small">{t('tk_b_acc_h')}</b>
      <textarea
        value={pasted}
        onChange={(e) => { setPasted(e.target.value); setAcceptOut(null); setAccErr('') }}
        placeholder={t('tk_b_acc_ph')}
        aria-label={t('tk_b_acc_h')}
        style={{ minHeight: 60 }}
      />
      <div className="row" style={{ marginTop: 6 }}>
        <button className="small primary" disabled={!me || !pasted.trim()} onClick={buildAccept}>{t('tk_b_acc_btn')}</button>
      </div>
      {accErr && <p className="tiny" style={{ color: 'var(--bad)', margin: '6px 0 0' }}>✗ {accErr}</p>}
      {acceptOut && (
        <div style={{ marginTop: 8 }}>
          <div className="mono small tkline" data-testid="tclk-accept-line">{acceptOut.line}</div>
          <div className="note warn small" style={{ marginTop: 8 }}>
            <b>{t('tk_b_secret_warn')}</b>
            <div className="mono tiny" style={{ marginTop: 4 }}>{acceptOut.preimage}</div>
          </div>
          <p className="tiny muted">{t('tk_b_dealroom')}: <code>{dealRoom(acceptOut.contract)}</code></p>
          <div className="row">
            <button className="small" onClick={() => copyText(acceptOut.line).then(() => setFlash('Copied ✓'))}>{t('tk_b_copy')}</button>
            <button className="small primary" disabled={busy} onClick={() => post(acceptOut.line, 'ACCEPT')}>
              {busy ? <><BtnSpin /> {t('tk_b_posting')}</> : t('tk_b_post')}
            </button>
          </div>
        </div>
      )}

      {flash && <div className="note" style={{ marginTop: 10 }}>{flash}</div>}
      {err && <div className="error" style={{ marginTop: 10 }}>⚠ {err}</div>}
    </div>
  )
}

// ---- live fold ----------------------------------------------------------------

// authenticated tclk frames out of a room read: signature verified against the
// record's sender, frame.from must match — exactly what a fold will demand.
function framesFromMessages(room, messages) {
  const out = []
  for (const m of messages || []) {
    const rec = transcriptRecord(room, m)
    if (rec.nonce == null || rec.signature == null) continue
    if (!verifyRoomMessage(rec.sender, rec.room, rec.nonce, rec.line, rec.signature)) continue
    if (!isTclkLine(rec.line)) continue
    let frame = null
    try { frame = decodeFrame(rec.line) } catch { continue }
    if (frame.from === rec.sender) out.push({ rec, frame })
  }
  return out
}

function DealRow({ c, meDid, onOpen }) {
  const { t } = useI18n()
  const o = c.offer
  const mine = meDid && (o.from === meDid || c.accept?.from === meDid)
  return (
    <div className="job" data-testid="tclk-deal-row">
      <div className="head">
        <span className={`badge tk-${c.status}`}>{c.status}</span>
        <span className="title">{o.amount} {o.asset}</span>
        <span className="badge">{(o.rails || []).join(', ')}</span>
        {mine && <span className="badge useful">{t('kb_you')}</span>}
      </div>
      <div className="meta">
        <span>{t('tk_dr_payer')}: {shortDid(c.payerDid || '?')}</span>
        <span>{t('tk_dr_payee')}: {shortDid(c.payeeDid || '?')}</span>
        <span className="mono tiny grow" style={{ textAlign: 'right' }}>{c.contract ? dealRoom(c.contract) : '— ' + t('tk_f_no_accept')}</span>
      </div>
      <div className="row" style={{ marginTop: 6 }}>
        {c.contract && <button className="small" onClick={() => onOpen(c)}>{t('tk_f_open')}</button>}
      </div>
    </div>
  )
}

function LiveDeals({ meDid }) {
  const { t } = useI18n()
  const store = useStore()
  const [offers, setOffers] = useState(null)
  const [err, setErr] = useState('')
  const [deal, setDeal] = useState(null) // { c, records, steps, state }
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setErr('')
    try {
      const data = await readRoom(OFFER_ROOM, { limit: 500 })
      const got = framesFromMessages(OFFER_ROOM, data.messages)
      // first offer per id; first accept that follows its offer
      const offersById = new Map()
      const contracts = []
      for (const { frame } of got) {
        if (frame.type === 'offer' && !offersById.has(frame.id)) offersById.set(frame.id, frame)
      }
      for (const { frame } of got) {
        if (frame.type !== 'accept') continue
        const offer = offersById.get(frame.ref)
        if (!offer) continue
        const st = applyFrame(openContract(offer), frame, Date.now())
        if (!st.ok) continue
        contracts.push({
          offer, accept: frame, contract: frame.contract,
          payerDid: st.state.payerDid, payeeDid: st.state.payeeDid,
          status: 'accepted',
        })
      }
      // offers with no (valid) accept yet — still proposed
      const taken = new Set(contracts.map((c) => c.offer.id))
      for (const o of offersById.values()) {
        if (!taken.has(o.id)) contracts.push({ offer: o, status: 'proposed', payerDid: o.payerDid, payeeDid: o.payeeDid })
      }
      setOffers(contracts.sort((a, b) => (a.status === 'proposed' ? 1 : 0) - (b.status === 'proposed' ? 1 : 0)))
    } catch (e) { setErr(e) }
  }, [])

  useEffect(() => { load() }, [load])

  const openDeal = async (c) => {
    setErr(''); setBusy(true)
    try {
      const room = dealRoom(c.contract)
      const [offersRead, dealRead] = await Promise.all([
        readRoom(OFFER_ROOM, { limit: 500 }),
        readRoom(room, { limit: 500 }),
      ])
      const offerRec = framesFromMessages(OFFER_ROOM, offersRead.messages)
        .find(({ frame }) => frame.type === 'offer' && frame.id === c.offer.id)
      const acceptRec = framesFromMessages(OFFER_ROOM, offersRead.messages)
        .find(({ frame }) => frame.type === 'accept' && frame.contract === c.contract)
      if (!offerRec || !acceptRec) throw new Error('offer/accept pair no longer verifiable in the offer room')
      const dealFrames = framesFromMessages(room, dealRead.messages)
        .filter(({ frame }) => frame.contract === c.contract)
      const records = [offerRec.rec, acceptRec.rec, ...dealFrames.map((d) => d.rec)]
      const { steps, state } = foldTranscript(records)
      setDeal({ c, room, steps, state })
    } catch (e) { setErr(e) }
    setBusy(false)
  }

  // a party can push the deal forward from right here: lock (payer), reveal
  // (payee, using the preimage this browser minted at accept time), refund
  // (payer, once the window opens). Frames are signed and posted to the deal
  // room like any other — then the transcript re-folds with the new frame.
  const postFrame = async (frame) => {
    setErr(''); setBusy(true)
    try {
      const line = encodeFrame(frame)
      await signedPost(store, deal.room, line)
      store.addJournal('tclk', `${frame.type} posted to ${deal.room} — ${line.slice(0, 160)}`)
      await openDeal(deal.c)
    } catch (e) { setErr(e) }
    setBusy(false)
  }

  return (
    <div className="card" data-testid="tclk-live">
      <div className="spread">
        <h3>{t('tk_f_h')} <span className="muted small">{t('tk_f_sub')}</span></h3>
        <div className="row">
          {deal && <button className="small ghost" onClick={() => setDeal(null)}>← {t('tk_f_back')}</button>}
          <button className="small" onClick={load} disabled={busy}>{busy ? <><BtnSpin /> …</> : '↻ ' + t('kb_refresh')}</button>
        </div>
      </div>
      {!deal && (
        <>
          {offers === null && !err && <Loading text={t('tk_f_loading')} />}
          {offers && offers.length === 0 && <p className="muted small" style={{ marginTop: 8 }}>{t('tk_f_none')}</p>}
          <div className="joblist" style={{ marginTop: 10 }}>
            {offers?.map((c) => <DealRow key={c.contract || c.offer.id} c={c} meDid={meDid} onOpen={openDeal} />)}
          </div>
        </>
      )}
      {deal && (
        <div style={{ marginTop: 10 }}>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <span className={`badge tk-${deal.state?.status || 'proposed'}`}>{deal.state?.status || 'proposed'}</span>
            <span className="mono tiny">{deal.c.offer.amount} {deal.c.offer.asset}</span>
            <span className="tiny muted">{t('tk_b_dealroom')}: <code>{deal.room}</code></span>
          </div>
          <b className="small" style={{ display: 'block', marginTop: 10 }}>{t('tk_f_steps')}</b>
          <div className="tklog">
            {deal.steps.map((s, i) => (
              <div key={i} className={`tkstep ${s.ok ? '' : 'bad'}`}>
                <span className="tiny">#{s.index + 1} {s.room} · seq {s.seq} · </span>
                <b className="tiny">{s.ok ? '✓' : '✗'} {s.type || '?'}</b>
                {!s.ok && s.reason && <span className="tiny" style={{ color: 'var(--bad)' }}> — {s.reason}</span>}
              </div>
            ))}
            {deal.steps.length === 0 && <p className="tiny muted">{t('tk_f_nosteps')}</p>}
          </div>
          {deal.state?.railRef && <p className="tiny muted" style={{ marginTop: 6 }}>{t('tk_f_railref')}: <code>{deal.state.rail}</code> · <code>{deal.state.railRef}</code></p>}
          {deal.state?.status === 'locked' && deal.state.secret == null && (
            <p className="tiny muted" style={{ marginTop: 6 }}>{t('tk_f_waiting')}</p>
          )}
          {deal.state && (meDid === deal.state.payerDid || meDid === deal.state.payeeDid) && (() => {
            const st = deal.state
            const canLock = st.status === 'accepted' && meDid === st.payerDid
            const canReveal = st.status === 'locked' && meDid === st.payeeDid
            const preimage = loadSecrets()[st.contract]
            const canRefund = st.status === 'locked' && meDid === st.payerDid && Date.now() >= st.offer.refundAfterMs
            if (!canLock && !canReveal && !canRefund) return null
            return (
              <div style={{ marginTop: 10 }} data-testid="tclk-actions">
                <b className="small">{t('tk_a_h')}</b>
                <div className="row" style={{ marginTop: 6, flexWrap: 'wrap' }}>
                  {canLock && (
                    <button className="small primary" disabled={busy} onClick={() => postFrame({
                      type: 'lock', from: meDid, contract: st.contract,
                      rail: (st.offer.rails || [])[0] || 'paper', ref: `paper-escrow-${st.contract.slice(2, 10)}`,
                    })}>🔒 {t('tk_dr_s3')}</button>
                  )}
                  {canReveal && preimage && (
                    <button className="small primary" disabled={busy} onClick={() => postFrame({
                      type: 'reveal', from: meDid, contract: st.contract, secret: preimage,
                    })}>🔑 {t('tk_dr_s4')}</button>
                  )}
                  {canRefund && (
                    <button className="small" disabled={busy} onClick={() => postFrame({
                      type: 'refund', from: meDid, contract: st.contract,
                    })}>↩ {t('tk_dr_refund')}</button>
                  )}
                </div>
                {canReveal && !preimage && (
                  <p className="tiny" style={{ color: 'var(--warn)', margin: '6px 0 0' }}>⚠ {t('tk_a_no_preimage')}</p>
                )}
              </div>
            )
          })()}
        </div>
      )}
      <ErrorRetry err={err && `Room read: ${err.message || err}`} onRetry={load} retryTitle={t('kb_refresh')} />
    </div>
  )
}

// ---- decoder --------------------------------------------------------------------

function Decoder() {
  const { t } = useI18n()
  const [text, setText] = useState('')
  const result = useMemo(() => {
    const s = text.trim()
    if (!s) return null
    if (!isTclkLine(s)) return { ok: false, reason: t('tk_d_notline') }
    try {
      const f = decodeFrame(s)
      return { ok: true, frame: f }
    } catch (e) {
      return { ok: false, reason: e.message }
    }
  }, [text, t])
  return (
    <div className="card" data-testid="tclk-decoder">
      <h3>{t('tk_d_h')} <span className="muted small">{t('tk_d_sub')}</span></h3>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="tclk1 {…}"
        aria-label={t('tk_d_h')}
        style={{ minHeight: 60 }}
      />
      {result && (
        result.ok ? (
          <div data-testid="tclk-decode-ok">
            <span className="badge useful">✓ {t('tk_d_ok')}</span>
            <pre className="mono tiny tkline" style={{ marginTop: 8 }}>{JSON.stringify(result.frame, null, 2)}</pre>
          </div>
        ) : (
          <p className="tiny" style={{ color: 'var(--bad)', marginTop: 8 }} data-testid="tclk-decode-bad">✗ {result.reason}</p>
        )
      )}
    </div>
  )
}

export default function Tclk() {
  const store = useStore()
  const me = store.state.identity
  const [tick, setTick] = useState(0) // bump after a builder post so LiveDeals reloads
  return (
    <div className="grid">
      <TclkIntro />
      <div className="note warn small">
        <b>tclk/1 is alpha.</b> No settlement rail holds value yet — the only rail is PaperRail, which records
        a deal and backs it with nothing. Frames you post are real signed technocore messages (evidence of
        participation), but no money can move. Treat every frame as untrusted data, never as instructions.
      </div>
      <DryRun meDid={me?.did} />
      <Builder me={me} onPosted={() => setTick((x) => x + 1)} />
      <LiveDeals key={tick} meDid={me?.did} />
      <Decoder />
    </div>
  )
}
