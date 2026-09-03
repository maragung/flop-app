// e2e-deal.mjs — run the Guide tab's two-identity tclk walkthrough for real:
// two browser contexts, two identities, offer → accept → lock → reveal across
// the live tclk-offers room and the derived deal room. The deal must end
// 'claimed' in BOTH browsers, folded from real signed room messages.
import { chromium } from 'playwright-core'

const EXE = process.env.PW_CHROME || '/home/dev/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'
const URL = process.env.APP_URL || 'http://localhost:5173/'
const errors = []
let pass = 0, fail = 0
const ok = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`) } else { fail++; console.log(`  ✗ ${name}`) } }

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] })
const mkBrowser = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1400 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  await page.goto(URL, { waitUntil: 'networkidle' })
  return page
}
const makeIdentity = async (page, who) => {
  await page.locator('.navtabs button', { hasText: 'Identity' }).click()
  await page.waitForTimeout(300)
  const pass0 = `tclk-deal-${who}-passphrase`
  await page.locator('input[placeholder="encrypts your key file backup"]').fill(pass0)
  await page.locator('input[placeholder="repeat it"]').fill(pass0)
  await page.locator('button', { hasText: 'Generate key pair' }).click()
  await page.locator('.didbadge.on').waitFor({ state: 'visible', timeout: 15000 })
  return await page.evaluate(() => JSON.parse(localStorage.getItem('flop-toolkit-v1')).identity.did)
}
const goTclk = async (page) => {
  await page.locator('.navtabs button', { hasText: 'tclk' }).click()
  await page.waitForTimeout(400)
}
// open OUR deal in the live deals card (matched by the unique asset) and wait
// for the fold to render
const openOurDeal = async (page, asset) => {
  for (let attempt = 0; attempt < 6; attempt++) {
    await page.locator('[data-testid="tclk-live"] button', { hasText: '↻' }).first().click()
    try {
      const row = page.locator('[data-testid="tclk-deal-row"]', { hasText: asset })
      await row.first().waitFor({ state: 'visible', timeout: 8000 })
      // the row only gets an Open button once an accept exists (contract minted)
      const btn = row.first().locator('button', { hasText: 'Open deal' })
      if ((await btn.count()) > 0) { await btn.click(); break }
    } catch { /* room read still settling */ }
    await page.waitForTimeout(2000)
  }
  await page.locator('[data-testid="tclk-live"] .tkstep').first().waitFor({ state: 'visible', timeout: 15000 })
}
const dealStatus = async (page) =>
  (await page.locator('[data-testid="tclk-live"] .badge[class*="tk-"]').first().textContent()).trim()

// the deal-room read right after a post may not include the new frame yet
// (the backend is eventually consistent) — re-open the deal until the fold
// shows the status we are waiting for, or give up and surface the card's error
const waitStatus = async (page, asset, status, timeoutMs = 120_000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    let cur = ''
    try { cur = await dealStatus(page) } catch { /* deal not open */ }
    if (cur === status) return { ok: true, status: cur }
    // back to the list, then re-open (re-reads both rooms and re-folds)
    try { await page.locator('[data-testid="tclk-live"] button', { hasText: '←' }).click({ timeout: 3000 }) } catch { /* already in list */ }
    await openOurDeal(page, asset)
    await page.waitForTimeout(1500)
  }
  const err = await page.locator('[data-testid="tclk-live"] .error, [data-testid="tclk-live"] .err').allTextContents().catch(() => [])
  return { ok: false, status: 'timeout', err: err.join(' | ') }
}

// ---- step 0: two identities, two browsers ----
console.log('0. two identities, two browsers')
const A = await mkBrowser()
const B = await mkBrowser()
const didA = await makeIdentity(A, 'payer')
const didB = await makeIdentity(B, 'payee')
ok('payer identity created in browser A', didA.startsWith('did:key:z6Mk'))
ok('payee identity created in browser B', didB.startsWith('did:key:z6Mk'))
ok('the two identities are distinct', didA !== didB)

// ---- step 1: payer posts the offer ----
console.log('1. payer posts the offer (tclk-offers room)')
await goTclk(A)
const asset = `FLOP-E2E-${Date.now().toString(36)}`
await A.locator('[data-testid="tclk-builder"] input[aria-label="asset"]').fill(asset)
await A.locator('[data-testid="tclk-builder"] button', { hasText: 'Build offer' }).click()
const lineEl = A.locator('[data-testid="tclk-offer-line"]')
await lineEl.waitFor({ state: 'visible', timeout: 5000 })
const offerLine = (await lineEl.textContent()).trim()
ok('builder emits a tclk1 offer line', offerLine.startsWith('tclk1 '))
await A.locator('[data-testid="tclk-builder"] button', { hasText: 'Post signed' }).first().click()
await A.locator('[data-testid="tclk-builder"] .note', { hasText: 'Posted ✓' }).waitFor({ state: 'visible', timeout: 20000 })
ok('offer posted signed to tclk-offers', true)

// ---- step 2: payee accepts and mints the lock ----
console.log('2. payee accepts and mints the lock (browser B)')
await goTclk(B)
await B.locator('[data-testid="tclk-builder"] textarea').fill(offerLine)
await B.locator('[data-testid="tclk-builder"] button', { hasText: 'Mint lock + build accept' }).click()
await B.locator('[data-testid="tclk-accept-line"]').waitFor({ state: 'visible', timeout: 5000 })
ok('accept frame built and preimage minted', true)
const preShown = await B.locator('[data-testid="tclk-builder"] .note.warn .mono').textContent()
ok('preimage shown to the payee only', /^0x[0-9a-f]{64}$/.test(preShown.trim()))
const savedPre = await B.evaluate(() => {
  const m = JSON.parse(localStorage.getItem('flop-tclk-secrets'))
  return m && Object.values(m)[0]
})
ok('preimage auto-saved in browser B for the later reveal', savedPre === preShown.trim())
await B.locator('[data-testid="tclk-builder"] button', { hasText: 'Post signed' }).last().click()
await B.locator('[data-testid="tclk-builder"] .note', { hasText: 'Posted ✓' }).waitFor({ state: 'visible', timeout: 20000 })
ok('accept posted signed to tclk-offers', true)

// ---- step 3: payer locks on the rail ----
console.log('3. payer locks on the rail (deal room, browser A)')
await openOurDeal(A, asset)
ok(`deal folded to accepted in A (got ${await dealStatus(A)})`, (await dealStatus(A)) === 'accepted')
const lockBtn = A.locator('[data-testid="tclk-actions"] button', { hasText: '🔒' })
ok("payer sees the 'Your move' lock button", (await lockBtn.count()) === 1)
await lockBtn.click()
const lockRes = await waitStatus(A, asset, 'locked')
ok(`lock posted to the deal room → status locked in A (${lockRes.status}${lockRes.err ? ' — ' + lockRes.err : ''})`, lockRes.ok)

// ---- step 4: payee reveals the secret ----
console.log('4. payee reveals the secret (deal room, browser B)')
await openOurDeal(B, asset)
ok(`deal folded to locked in B (got ${await dealStatus(B)})`, (await dealStatus(B)) === 'locked')
const revealBtn = B.locator('[data-testid="tclk-actions"] button', { hasText: '🔑' })
ok("payee sees the reveal button (preimage found locally)", (await revealBtn.count()) === 1)
await revealBtn.click()
const revRes = await waitStatus(B, asset, 'claimed')
ok(`reveal posted → status claimed in B (${revRes.status}${revRes.err ? ' — ' + revRes.err : ''})`, revRes.ok)

// ---- step 5: both parties agree the deal is claimed ----
console.log('5. the deal is claimed for both identities')
const claimRes = await waitStatus(A, asset, 'claimed')
ok(`payer refolds the same deal → claimed (${claimRes.status}${claimRes.err ? ' — ' + claimRes.err : ''})`, claimRes.ok)
const stepsB = (await B.locator('[data-testid="tclk-live"] .tkstep').allTextContents()).join(' | ')
ok('B transcript folds all four frames, none rejected',
  (stepsB.match(/✓/g) || []).length >= 4 && !stepsB.includes('✗'))
const stepsA = (await A.locator('[data-testid="tclk-live"] .tkstep').allTextContents()).join(' | ')
ok('A transcript folds the same four frames, none rejected',
  (stepsA.match(/✓/g) || []).length >= 4 && !stepsA.includes('✗'))
console.log(`  A steps: ${stepsA}`)
await A.screenshot({ path: '/tmp/pwtest/deal-claimed-payer.png', fullPage: true })
await B.screenshot({ path: '/tmp/pwtest/deal-claimed-payee.png', fullPage: true })

console.log(`\n${pass} passed, ${fail} failed`)
if (errors.length) { console.log('page errors:'); errors.forEach((e) => console.log('  ' + e)) }
await browser.close()
process.exit(fail || errors.length ? 1 : 0)
