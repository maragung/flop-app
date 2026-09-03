// useContrib.jsx — React glue for the auto-detection engine: runs/caches the
// activity scan in the store and exposes the computed auto-checks to any page.
//
// Auto-detected completions are STICKY: the scan only sees the recent window
// of each room, so a task detected done yesterday would un-tick today once its
// messages scroll out. The first time a task is detected done it is recorded in
// state.autoDone (and travels with backups); mergeStickyChecks() folds that
// history back in. Only RECURRING_AUTOS (announcement checks) re-evaluate.
import { useCallback, useEffect, useState } from 'react'
import { useStore } from './store.jsx'
import { refreshActivity, computeAutoChecks, mergeStickyChecks, scanRoomsWith } from './contrib.js'

const STALE_MS = 15 * 60 * 1000

export function useContrib({ auto = false } = {}) {
  const store = useStore()
  const { identity, activity, autoDone } = store.state
  const [scanning, setScanning] = useState(false)
  const [scanErr, setScanErr] = useState('')

  const scan = useCallback(async () => {
    if (!identity?.did) return
    setScanning(true)
    setScanErr('')
    try {
      store.recordScan(await refreshActivity(identity.did, { rooms: scanRoomsWith(store.state) }))
    } catch (e) {
      setScanErr(e)
    }
    setScanning(false)
  }, [identity?.did]) // eslint-disable-line

  // background refresh when the cached scan is stale or belongs to another DID
  useEffect(() => {
    if (!auto || !identity?.did) return
    const stale = !activity || activity.did !== identity.did ||
      Date.now() - new Date(activity.at).getTime() > STALE_MS
    if (stale) scan().catch(() => {})
  }, [auto, identity?.did]) // eslint-disable-line

  const current = activity && activity.did === identity?.did ? activity : null
  const rawChecks = computeAutoChecks(store.state, current?.scan, current?.score)

  // record first-time detections once per scan (same-object bail-out keeps this cheap)
  const doneKey = Object.entries(rawChecks).filter(([, c]) => c.done).map(([k]) => k).join(',')
  useEffect(() => {
    if (!doneKey) return
    store.markAutoDones(doneKey.split(','))
  }, [doneKey]) // eslint-disable-line

  const autoChecks = mergeStickyChecks(rawChecks, autoDone)

  return {
    autoChecks,
    scanning,
    scanErr,
    scan,
    activity: current,
    hasIdentity: Boolean(identity?.did),
  }
}
