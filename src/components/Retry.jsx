// Retry.jsx — shared loading / error / retry UI. Every feature that fetches
// something renders these so a failed load always gets a visible ↻ reload
// button instead of a silent blank.
export function Loading({ text = 'Loading…' }) {
  return (
    <p className="small muted" style={{ margin: 0 }}>
      <span className="spin" aria-hidden="true">◌</span> {text}
    </p>
  )
}

export function ErrorRetry({ err, onRetry, retryTitle = 'Reload' }) {
  if (!err) return null
  return (
    <div className="error" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <span className="grow">⚠ {String(err.message || err)}</span>
      <button className="small" onClick={onRetry} title={retryTitle} aria-label={retryTitle}>↻ {retryTitle}</button>
    </div>
  )
}
