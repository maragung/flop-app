// useContrib.jsx — React glue for the auto-detection engine: runs/caches the
// activity scan in the store and exposes the computed auto-checks to any page.
import { useCallback, useEffect, useState } from 'react'
import { useStore } from './store.jsx'
import { scanActivity, fetchScoreTerms, computeAutoChecks } from './contrib.js'

const STALE_MS = 15 * 60 * 1000

export function useContrib({ auto = false } = {}) {
  const store = useStore()
  const { identity, activity } = store.state
  const [scanning, setScanning] = useState(false)
  const [scanErr, setScanErr] = useState('')

  const scan = useCallback(async () => {
    if (!identity?.did) return
    setScanning(true)
    setScanErr('')
    try {
      const [scan, score] = await Promise.all([
        scanActivity(identity.did),
        fetchScoreTerms(identity.did),
      ])
      store.setActivity({ at: new Date().toISOString(), did: identity.did, scan, score })
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
  const autoChecks = computeAutoChecks(store.state, current?.scan, current?.score)

  return {
    autoChecks,
    scanning,
    scanErr,
    scan,
    activity: current,
    hasIdentity: Boolean(identity?.did),
  }
}
