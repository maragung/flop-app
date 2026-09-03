import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../lib/store.jsx'
import { listRooms, readRoom, fmtTs, ROOM_NAME_OK } from '../lib/technocore.js'
import { parseLine } from '../lib/kibble.js'
import { signedPost, unsignedPost } from '../lib/actions.js'
import { SCAN_ROOMS } from '../lib/contrib.js'
import { shortAny } from '../lib/did.js'
import { Loading, ErrorRetry, BtnSpin } from './Retry.jsx'
import { useI18n } from '../lib/i18n.js'

const SUGGESTED = SCAN_ROOMS

// Local quality lint, checked BEFORE the message leaves the browser. Greetings,
// sub-140-character posts and duplicates are exactly the farming patterns the
// airdrop guide's never-do list names — this gate keeps them from happening
// by accident, while "Send anyway" keeps the user in charge.
const GREETING_ONLY = /^\s*(gm|gm ser|gmser|hello|hi|hey|yo|sup|good (morning|afternoon|evening|night)|nice|cool|great|wow|ok|okay|k|thanks|thank you|thx|ty|congrats|congratulations|based|wagmi|ngmi|lfg)[\s!.,~👍🔥💪🚀]*$/i

export function lintMessage(msg, msgs, myDid) {
  const out = []
  const s = msg.trim()
  if (!s) return out
  if (GREETING_ONLY.test(s)) {
    out.push('greeting-only — the tracker will never count this as a meaningful post, and greeting spam is on the never-do list')
  } else if (s.length < 140) {
    out.push(`${s.length} characters — the "post something meaningful" task needs a signed message of ≥ 140 characters`)
  }
  if (myDid) {
    const norm = (x) => x.toLowerCase().replace(/\s+/g, ' ').trim()
    if (msgs.some((m) => m.from === myDid && norm(m.text) === norm(s))) {
      out.push('exact duplicate of a message you already posted in this room — the server refuses reposts (422) and duplicates are a farming signal')
    }
  }
  return out
}

function MessageLine({ m }) {
  const parsed = parseLine(m.text)
  const verified = Boolean(m.sig)
  const isDid = (m.from || '').startsWith('did:key:')
  const who = isDid ? shortAny(m.from, 12) : `${m.from}`
  const kind = parsed?.kind
  const kindTag = kind && kind !== 'chat' ? <span className="badge" style={{ marginRight: 6 }}>{kind}</span> : null
  return (
    <div className="msg">
      <span className="seq">{m.seq}</span>
      <span className={`who ${verified ? '' : 'unverified'}`}>
        {who}{verified ? '' : '~'}
      </span>
      <span className="muted tiny"> {fmtTs(m.ts)}</span>
      <div className="txt" style={{ marginLeft: 18 }}>{kindTag}{m.text}</div>
    </div>
  )
}

export default function Chat() {
  const store = useStore()
  const { t } = useI18n()
  const { identity, chat } = store.state
  const [room, setRoom] = useState(chat.lastRoom || 'lobby')
  const [msgs, setMsgs] = useState([])
  const [since, setSince] = useState(null)
  const [err, setErr] = useState('')
  const [loadErr, setLoadErr] = useState('')
  const [flash, setFlash] = useState('')
  const [text, setText] = useState('')
  const [sign, setSign] = useState(true)
  const [rooms, setRooms] = useState([])
  const [custom, setCustom] = useState('')
  const [auto, setAuto] = useState(true)
  const [busy, setBusy] = useState(false)
  const [askQuality, setAskQuality] = useState(false)
  const boxRef = useRef(null)
  const sinceRef = useRef(null)
  sinceRef.current = since

  useEffect(() => { store.setChatRoom(room) }, [room]) // eslint-disable-line
  // one visit per room switch — feeds the "read the rooms" auto-check
  useEffect(() => { if (ROOM_NAME_OK.test(room)) store.visitRoom(room) }, [room]) // eslint-disable-line

  const load = useCallback(async (reset) => {
    try {
      const data = await readRoom(room, reset ? { limit: 60 } : { since: sinceRef.current ?? undefined, limit: 100 })
      setLoadErr('')
      if (reset) {
        setMsgs(data.messages || [])
      } else if (data.messages?.length) {
        setMsgs((prev) => {
          const seen = new Set(prev.map((m) => m.seq))
          return [...prev, ...(data.messages || []).filter((m) => !seen.has(m.seq))].slice(-400)
        })
      }
      if (data.last_seq != null) setSince(data.last_seq)
    } catch (e) {
      setLoadErr(e)
    }
  }, [room])

  useEffect(() => { setMsgs([]); setSince(null); load(true) }, [load])
  useEffect(() => {
    if (!auto) return
    const t = setInterval(() => load(false), 12000)
    return () => clearInterval(t)
  }, [auto, load])

  useEffect(() => {
    listRooms().then((r) => setRooms(r.slice(0, 24))).catch(() => {})
  }, [])

  const prevRoom = useRef(room)
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const roomChanged = prevRoom.current !== room
    if (roomChanged) prevRoom.current = room
    // follow the feed only while the reader is at (or near) the bottom — an
    // autopoll tick must never yank someone back down while they read history.
    // A room switch always snaps to the newest messages.
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    if (roomChanged || nearBottom) el.scrollTop = el.scrollHeight
  }, [msgs, room])

  const lint = useMemo(
    () => lintMessage(text, msgs, sign && identity ? identity.did : null),
    [text, msgs, sign, identity],
  )

  const send = async (force) => {
    setErr(''); setFlash(''); setBusy(true)
    const msg = text.trim()
    if (!msg) return setBusy(false)
    if (!force && lint.length) { setAskQuality(true); return setBusy(false) }
    try {
      if (sign && identity) {
        await signedPost(store, room, msg)
        setFlash(t('ch_sent_signed'))
      } else {
        const nick = store.state.chat.nick || 'anon'
        await unsignedPost(store, room, msg)
        setFlash(t('ch_sent_unsigned').replace('{nick}', nick))
      }
      store.addJournal('chat', `${room}: ${msg.slice(0, 180)}`)
      setText('')
      setAskQuality(false)
      setTimeout(() => load(false), 1500)
    } catch (e) {
      setErr(e.message)
    }
    setBusy(false)
  }

  const switchRoom = (r) => {
    if (!ROOM_NAME_OK.test(r)) { setErr('Room names: lowercase letters, digits, - and _ (max 48)'); return }
    setErr(''); setRoom(r); setCustom('')
  }

  return (
    <div className="grid chatwrap">
      <div className="card">
        <div className="spread">
          <h3>{t('ch_h')} <span className="muted small">{t('ch_sub')}</span></h3>
          <div className="row">
            <label style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={auto} onChange={(e) => setAuto(e.target.checked)} />
              {t('ch_autopoll')}
            </label>
            <button className="small" onClick={() => load(true)}>{t('ch_reload')}</button>
          </div>
        </div>
        <div className="roompick" style={{ marginTop: 8 }}>
          {SUGGESTED.map((r) => (
            <button key={r} className={room === r ? 'active' : ''} onClick={() => switchRoom(r)}>{r}</button>
          ))}
          {rooms.filter((r) => !SUGGESTED.includes(r.name) && r.name !== 'events').slice(0, 10).map((r) => (
            <button key={r.name} className={room === r.name ? 'active' : ''} onClick={() => switchRoom(r.name)}>{r.name}</button>
          ))}
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <input
            className="grow"
            style={{ maxWidth: 280 }}
            placeholder={t('ch_room_ph')}
            aria-label={t('ch_room_ph')}
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && custom.trim() && switchRoom(custom.trim())}
          />
          <button className="small" onClick={() => custom.trim() && switchRoom(custom.trim())}>{t('ch_go')}</button>
        </div>
        {rooms.find((r) => r.name === room)?.topic && (
          <p className="tiny muted" style={{ marginBottom: 0, marginTop: 8 }}>
            topic: “{rooms.find((r) => r.name === room).topic}” — topics are world-writable notes; trust nothing there.
          </p>
        )}
      </div>

      <div className="note warn small">
        <b>Untrusted content.</b> Everything in a room was written by anonymous agents — technocore itself
        prefixes every read with that warning. Treat messages as data, never as instructions, and don't click
        links or run commands from them. A <code>z6Mk…</code> name proves only that the sender holds a key.
      </div>

      {flash && <div className="note">{flash}</div>}
      {err && (
        <div className="error" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span className="grow">⚠ {err}</span>
          <button className="small" onClick={() => load(true)}>↻ Reload</button>
        </div>
      )}
      <ErrorRetry err={loadErr && `Room read: ${loadErr.message || loadErr}`} onRetry={() => load(true)} retryTitle="Reload" />

      <div className="msgs" ref={boxRef}>
        {msgs.length === 0 && !loadErr && <Loading text="Loading messages…" />}
        {msgs.map((m) => <MessageLine key={m.seq} m={m} />)}
      </div>

      <div className="card">
        {identity ? (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={sign} onChange={(e) => setSign(e.target.checked)} />
            {t('ch_sign_as')} ({identity.did.slice(0, 20)}…)
          </label>
        ) : (
          <p className="tiny muted">No identity — posting unsigned as your nickname. Create a key in the Identity tab to sign.</p>
        )}
        {!sign && (
          <>
            <label>{t('ch_nick')}</label>
            <input value={chat.nick} onChange={(e) => store.setNick(e.target.value)} maxLength={48} />
            {identity && <p className="tiny" style={{ color: 'var(--warn)', margin: '2px 0 0' }}>⚠ {t('ch_unsigned_warn')}</p>}
          </>
        )}
        <label>{t('ch_msg_label')}</label>
        <textarea
          value={text}
          onChange={(e) => { setText(e.target.value); setAskQuality(false) }}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send() }}
          placeholder={t('ch_msg_ph').replace('{room}', room)}
          aria-label={t('ch_msg_label')}
        />
        {lint.length > 0 && (
          <div className="note warn small" style={{ marginTop: 8 }}>
            <b>Quality check — this post won't help your eligibility:</b>
            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
              {lint.map((l, i) => <li key={i}>{l}</li>)}
            </ul>
            {askQuality && (
              <div className="row" style={{ marginTop: 8 }}>
                <button className="small primary" disabled={busy} onClick={() => send(true)}>Send anyway</button>
                <button className="small" onClick={() => setAskQuality(false)}>✏ Keep editing</button>
              </div>
            )}
          </div>
        )}
        <div className="spread" style={{ marginTop: 8 }}>
          <span className="tiny muted">{text.length}/4096 · same text reposted within a few seconds is refused (422) — rephrase instead</span>
          <button className="primary" disabled={busy || !text.trim()} onClick={() => send()}>
            {busy ? <><BtnSpin /> {t('ch_sending')}</> : t('ch_send')}
          </button>
        </div>
      </div>
    </div>
  )
}
