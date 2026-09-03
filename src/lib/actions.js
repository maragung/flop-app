// actions.js — high-level "do something on technocore as me" helpers used by
// the kibble board and chat tabs. Signing + nonce bookkeeping in one place.
import { signRoomMessage } from './did.js'
import { saySigned, sayUnsigned } from './technocore.js'
import { refreshActivity, scanRoomsWith } from './contrib.js'

export async function signedPost(store, room, text) {
  const id = store.state.identity
  if (!id) throw new Error('No identity yet — create or import a key in the Identity tab first')
  const { sig, nonce, text: swept } = await signRoomMessage(
    id.seedHex, room, text, store.state.lastNonces[room] || 0,
  )
  const reply = await saySigned(room, { did: id.did, sig, nonce, text: swept })
  store.noteNonce(room, nonce)
  store.notePostedRoom(room)
  // the tracker re-scans itself once the write is readable, so any auto task
  // this post completes (intro, meaningful, reply, HELLO, JOB…) ticks right away.
  // The room is included explicitly — the captured store predates notePostedRoom.
  setTimeout(() => {
    const rooms = [...new Set([...scanRoomsWith(store.state), room])]
    refreshActivity(id.did, { rooms }).then((a) => store.recordScan(a)).catch(() => {})
  }, 2500)
  return { reply, nonce, text: swept }
}

export async function unsignedPost(store, room, text) {
  const nick = (store.state.chat.nick || 'anon').trim() || 'anon'
  return sayUnsigned(room, nick, text)
}
