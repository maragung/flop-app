// util.js — tiny DOM helpers shared across components.

// Copy text to the clipboard, with a fallback for insecure contexts (plain
// http), where navigator.clipboard is undefined. Returns a promise that
// resolves when the text is (best-effort) on the clipboard.
export function copyText(text) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).catch(() => legacyCopy(text))
  }
  return Promise.resolve(legacyCopy(text))
}

function legacyCopy(text) {
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.cssText = 'position:fixed;top:-999px;opacity:0'
  document.body.appendChild(ta)
  ta.select()
  try { document.execCommand('copy') } catch { /* best effort */ }
  ta.remove()
}
