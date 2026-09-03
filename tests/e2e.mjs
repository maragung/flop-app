// e2e.mjs — the FLOP Toolkit regression suite (140 checks) via playwright-core.
//
// Usage:
//   npm install                 # playwright-core is a devDependency
//   npm run dev &               # or any server with the app on it
//   npm run test:e2e            # defaults to http://localhost:5173/
//
// Override for CI / other machines:
//   APP_URL=http://localhost:14421/ PW_CHROME=/usr/bin/chromium npm run test:e2e
//
// The suite runs against the LIVE dev server and the real technocore / kibble
// backends (board + chat reads). Sections 5–6 do local-only key round-trips
// (create, encrypt, download, import, wrong-passphrase) — nothing is posted.
import { chromium } from 'playwright-core'

const EXE = process.env.PW_CHROME || '/home/dev/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'
const URL = process.env.APP_URL || 'http://localhost:5173/'
const errors = []
let pass = 0, fail = 0
const ok = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`) } else { fail++; console.log(`  ✗ ${name}`) } }

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] })
const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 1400 }, permissions: ['clipboard-read', 'clipboard-write'] })
const page = await ctx.newPage()
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })

await page.goto(URL, { waitUntil: 'networkidle' })

// ---- 1. language dropdown ----
console.log('1. language dropdown')
const langSel = page.locator('.langsel')
ok('dropdown present with 25 options', await langSel.locator('option').count() === 25)
await langSel.selectOption('id')
await page.waitForTimeout(300)
ok('nav switches to Indonesian', (await page.locator('.navtabs button').first().textContent()).trim() === 'Dasbor')
// full-translation languages switch the tab CONTENT instantly too (i18n-ui merge)
await page.evaluate(() => { window.location.hash = 'guide' })
await page.waitForTimeout(500)
ok('Guide tab content switches to Indonesian instantly', (await page.locator('main').textContent()).includes('Tracker Kontribusiku'))
await page.evaluate(() => { window.location.hash = 'kibble' })
await page.waitForTimeout(500)
ok('Kibble tab content switches to Indonesian instantly', (await page.locator('main').textContent()).includes('papan kerja-berguna'))
await langSel.selectOption('ja')
await page.waitForTimeout(400)
ok('Japanese switches tab content without a reload', (await page.locator('main').textContent()).includes('有益な仕事のボード'))
await page.evaluate(() => { window.location.hash = 'journal' })
await page.waitForTimeout(400)
ok('Journal heading is Japanese', (await page.locator('main').textContent()).includes('コントリビューション記録'))
await page.evaluate(() => { window.location.hash = 'dashboard' })
await langSel.selectOption('en')
await page.waitForTimeout(300)
await langSel.selectOption('ar')
await page.waitForTimeout(300)
ok('RTL applied for Arabic', await page.evaluate(() => document.documentElement.dir === 'rtl'))
ok('Arabic tab label', (await page.locator('.navtabs button').first().textContent()).trim() === 'لوحة التحكم')
await langSel.selectOption('en')
await page.waitForTimeout(300)
ok('back to LTR English', await page.evaluate(() => document.documentElement.dir === 'ltr' && document.documentElement.lang === 'en'))
// the two other RTL languages flip direction too
await langSel.selectOption('fa')
await page.waitForTimeout(300)
ok('RTL applied for Farsi', await page.evaluate(() => document.documentElement.dir === 'rtl'))
await langSel.selectOption('ur')
await page.waitForTimeout(300)
ok('RTL applied for Urdu', await page.evaluate(() => document.documentElement.dir === 'rtl'))
// one of the 12 newly fully-translated languages renders the whole tab content
await langSel.selectOption('it')
await page.waitForTimeout(300)
await page.evaluate(() => { window.location.hash = 'guide' })
await page.waitForTimeout(500)
ok('Italian fully translates the guide tab', (await page.locator('main').textContent()).includes('Il mio tracker dei contributi'))
await page.evaluate(() => { window.location.hash = 'dashboard' })
await langSel.selectOption('en')
await page.waitForTimeout(300)
ok('language persists in localStorage', await page.evaluate(() => JSON.parse(localStorage.getItem('flop-toolkit-v1')).settings.lang) === 'en')

// ---- 2. theme toggle ----
console.log('2. theme toggle')
ok('default dark', await page.evaluate(() => !document.documentElement.dataset.theme || document.documentElement.dataset.theme === 'dark'))
await page.locator('.iconbtn').click()
await page.waitForTimeout(200)
ok('light after toggle', await page.evaluate(() => document.documentElement.dataset.theme === 'light'))
const bgLight = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
ok('body bg is light', bgLight === 'rgb(238, 242, 249)')
await page.locator('.iconbtn').click()
await page.waitForTimeout(200)
ok('back to dark', await page.evaluate(() => document.documentElement.dataset.theme === 'dark'))
await page.screenshot({ path: '/tmp/pwtest/shot-tokenomics-dark.png' })

// ---- 3. tokenomics page ----
console.log('3. tokenomics page')
await page.locator('.navtabs button', { hasText: 'Tokenomics' }).click()
await page.waitForTimeout(400)
ok('hero title', await page.locator('.toktitle').textContent() === '$FLOP Tokenomics')
ok('tagline', (await page.locator('.toktag').textContent()).includes('No VC allocation'))
ok('6 stat tiles', await page.locator('.toky .stat').count() === 6)
ok('supply chart svg', await page.locator('.tokchart').count() === 1)
ok('halving markers H1..H5', await page.locator('.halvinglab').count() === 5)
ok('donut with 6 segments', await page.locator('.tokdonut .seg').count() === 6)
ok('legend rows', await page.locator('.legendrow').count() === 6)
ok('genesis bars', await page.locator('.barrow').count() === 4)
ok('halving table 6 rows', await page.locator('.toktable tbody tr').count() === 6)
ok('draft disclaimer', (await page.locator('.note.warn').last().textContent()).includes('Draft'))
// hover the chart -> tooltip
await page.locator('.tokchart').hover({ position: { x: 400, y: 150 } })
await page.waitForTimeout(200)
ok('chart tooltip on hover', await page.locator('.charttip').count() === 1)
// donut hover -> center shows segment (hover a real ring point: ~15° clockwise of 12 o'clock, radius ~72)
{
  const donut = page.locator('.tokdonut')
  await donut.scrollIntoViewIfNeeded()
  const dbox = await donut.boundingBox()
  await page.mouse.move(dbox.x + 90 + 72 * Math.cos((-75 * Math.PI) / 180), dbox.y + 90 + 72 * Math.sin((-75 * Math.PI) / 180))
  await page.waitForTimeout(200)
}
ok('donut hover shows 3.5bn', (await page.locator('.centerbig').textContent()).includes('3.5'))
await page.screenshot({ path: '/tmp/pwtest/shot-tokenomics.png', fullPage: true })

// ---- 4. guide: auto-detecting contribution tasks ----
console.log('4. guide tasks')
await page.locator('.navtabs button', { hasText: 'Airdrop Guide' }).click()
await page.waitForTimeout(300)
const firstTask = page.locator('.checkitem .linkbtn').first()
ok('task is a clickable link button', (await firstTask.textContent()).includes('Generate one unique DID'))
await firstTask.click()
await page.waitForTimeout(300)
ok('clicking task navigates to Identity tab', await page.locator('.navtabs button.active').textContent() === 'Identity')
await page.locator('.navtabs button', { hasText: 'Airdrop Guide' }).click()
await page.waitForTimeout(300)
ok('auto task shows todo before it happens', (await page.locator('.checkitem .badge').first().textContent()).includes('todo'))
const firstManual = page.locator('.checkitem input[type=checkbox]').first()
await firstManual.check()
await page.waitForTimeout(200)
ok('manual task done badge after tick', (await firstManual.locator('xpath=..').locator('.badge').textContent()).includes('done'))
// evidence field appears on undone evidence tasks
ok('evidence URL fields offered', await page.locator('input[placeholder*="evidence URL"]').count() >= 5)

// ---- 5. identity: create (required passphrase) + PEM downloads ----
console.log('5. identity PEM')
await page.locator('.navtabs button', { hasText: 'Identity' }).click()
await page.waitForTimeout(200)
// short passphrase rejected
await page.locator('input[placeholder="encrypts your key file backup"]').fill('short')
await page.locator('input[placeholder="repeat it"]').fill('short')
await page.locator('button', { hasText: 'Generate key pair' }).click()
await page.waitForTimeout(300)
ok('short passphrase rejected', (await page.locator('.error').last().textContent()).includes('at least 12'))
// mismatch rejected
await page.locator('input[placeholder="encrypts your key file backup"]').fill('hunter2starlong')
await page.locator('input[placeholder="repeat it"]').fill('differentpassphr')
await page.locator('button', { hasText: 'Generate key pair' }).click()
await page.waitForTimeout(300)
ok('passphrase mismatch rejected', (await page.locator('.error').last().textContent()).includes('do not match'))
// proper creation
await page.locator('input[placeholder="encrypts your key file backup"]').fill('hunter2starlong')
await page.locator('input[placeholder="repeat it"]').fill('hunter2starlong')
await page.locator('button', { hasText: 'Generate key pair' }).click()
// busy state: the button itself must show a spinner + progress label
const genBtn = page.locator('button.primary').first()
ok('busy button shows progress label', (await genBtn.textContent()).includes('Deriving'))
ok('busy button shows spinner icon', await genBtn.locator('.spin').count() === 1)
await page.waitForTimeout(800)
ok('identity created (didbadge on)', await page.locator('.didbadge.on').count() === 1)
// creating the identity completes the 'did' task -> global toast, whatever tab is open
await page.locator('.tasktoast').waitFor({ state: 'visible', timeout: 10000 })
ok('task-completion toast appears', (await page.locator('.tasktoast').textContent()).includes('completed'))
ok('toast names the completed task', (await page.locator('.tasktoast').textContent()).includes('Generate one unique DID'))
// signing self-test -> the tracker's 'verify' task must tick itself
await page.locator('button', { hasText: 'Run signing self-test' }).click()
await page.waitForTimeout(400)
ok('signing self-test passes', (await page.locator('.note').last().textContent()).includes('Self-test passed'))
await page.locator('.navtabs button', { hasText: 'Airdrop Guide' }).click()
await page.waitForTimeout(500)
ok('tracker is named My Contribution tracker', (await page.locator('h3', { hasText: 'My Contribution tracker' }).count()) === 1)
ok('auto tasks tick after real actions', (await page.locator('.checkitem').first().locator('.badge').textContent()).includes('auto'))
const autodots = await page.locator('.autodot.on').count()
ok('did + verify auto-detected (2+ green autodots)', autodots >= 2)
// sticky auto-completion: a task detected done earlier must STAY done once the
// scan's recent window no longer sees it (inject an autoDone record, reload)
await page.evaluate(() => {
  const st = JSON.parse(localStorage.getItem('flop-toolkit-v1'))
  st.autoDone = { ...(st.autoDone || {}), intro: new Date().toISOString() }
  localStorage.setItem('flop-toolkit-v1', JSON.stringify(st))
})
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(800)
const introRow = page.locator('.checkitem', { hasText: 'Post a signed introduction in /r/lobby' })
ok('sticky auto task stays done after reload', (await introRow.locator('.badge').textContent()).includes('auto'))
ok('sticky detail says kept from earlier detection', (await introRow.textContent()).includes('kept from earlier detection'))
await page.locator('.navtabs button', { hasText: 'Identity' }).click()
await page.waitForTimeout(300)
const fs = await import('node:fs')
// plain pem download
const [dl1] = await Promise.all([
  page.waitForEvent('download'),
  page.locator('button', { hasText: 'plain .pem' }).click(),
])
const f1 = await dl1.path()
const pem1 = fs.readFileSync(f1, 'utf8')
ok('plain pem downloaded, named by nick', dl1.suggestedFilename() === 'anon-identity.pem')
ok('plain pem is PKCS#8 ed25519', pem1.includes('-----BEGIN PRIVATE KEY-----') && pem1.length > 100)
// encrypted pem download (one click — passphrase remembered from creation)
const [dl2] = await Promise.all([
  page.waitForEvent('download'),
  page.locator('button', { hasText: 'Download encrypted .pem' }).click(),
])
await page.waitForTimeout(1500)
const f2 = await dl2.path()
const pem2 = fs.readFileSync(f2, 'utf8')
ok('encrypted pem downloaded', pem2.includes('-----BEGIN ENCRYPTED PRIVATE KEY-----'))
fs.writeFileSync('/tmp/frombrowser-enc.pem', pem2)
fs.writeFileSync('/tmp/frombrowser-plain.pem', pem1)

// ---- 6. import the encrypted PEM back ----
console.log('6. pem import')
const didBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('flop-toolkit-v1')).identity.did)
// remove identity then import pem (dialog handler must be registered BEFORE the confirm())
// — swappable so later sections can test confirm-refused paths (DID-rotation guard)
let dialogHandler = (d) => d.accept()
page.on('dialog', (d) => dialogHandler(d))
await page.locator('button', { hasText: 'Remove from this browser' }).click()
await page.waitForTimeout(300)
await page.locator('textarea').first().fill(pem2)
await page.locator('input[placeholder="passphrase used to encrypt the file"]').fill('hunter2starlong')
await page.locator('button', { hasText: 'Import key' }).click()
await page.waitForTimeout(800)
const didAfter = await page.evaluate(() => JSON.parse(localStorage.getItem('flop-toolkit-v1')).identity?.did)
ok('encrypted PEM import restores same DID', didAfter === didBefore)
// wrong passphrase import rejected
await page.evaluate(() => { localStorage.clear() })
await page.reload({ waitUntil: 'networkidle' })
await page.locator('.navtabs button', { hasText: 'Identity' }).click()
await page.waitForTimeout(300)
await page.locator('textarea').first().fill(pem2)
await page.locator('input[placeholder="passphrase used to encrypt the file"]').fill('wrong passphras')
await page.locator('button', { hasText: 'Import key' }).click()
await page.waitForTimeout(800)
ok('wrong passphrase import rejected', (await page.locator('.error').last().textContent()).includes('Wrong passphrase'))

// ---- 6b. file-based import ----
console.log('6b. file import')
await page.setInputFiles('input[type=file]', '/tmp/frombrowser-enc.pem')
await page.waitForTimeout(400)
ok('key file loads into the import box', (await page.locator('textarea').first().inputValue()).includes('BEGIN ENCRYPTED PRIVATE KEY'))
ok('loaded filename is shown', (await page.locator('text=/frombrowser-enc.pem/').count()) >= 1)
await page.locator('input[placeholder="passphrase used to encrypt the file"]').fill('hunter2starlong')
await page.locator('button', { hasText: 'Import key' }).click()
await page.waitForTimeout(800)
ok('encrypted PEM file import restores same DID', (await page.evaluate(() => JSON.parse(localStorage.getItem('flop-toolkit-v1')).identity?.did)) === didBefore)
// .txt export -> seed line extracted automatically
const seedHex = await page.evaluate(() => JSON.parse(localStorage.getItem('flop-toolkit-v1')).identity.seedHex)
fs.writeFileSync('/tmp/frombrowser-identity.txt',
  `FLOP Toolkit — did:key identity\nDID: ${didBefore}\nPrivate key (seed, 32 bytes hex): ${seedHex}\nCreated: ${new Date().toISOString()}\n`)
await page.evaluate(() => { localStorage.clear() })
await page.reload({ waitUntil: 'networkidle' })
await page.locator('.navtabs button', { hasText: 'Identity' }).click()
await page.waitForTimeout(300)
await page.setInputFiles('input[type=file]', '/tmp/frombrowser-identity.txt')
await page.waitForTimeout(400)
ok('.txt export: seed hex auto-extracted', (await page.locator('textarea').first().inputValue()) === seedHex)
await page.locator('button', { hasText: 'Import key' }).click()
await page.waitForTimeout(800)
ok('.txt file import restores same DID', (await page.evaluate(() => JSON.parse(localStorage.getItem('flop-toolkit-v1')).identity?.did)) === didBefore)
// restore the fresh-state precondition for the sections below
await page.evaluate(() => { localStorage.clear() })
await page.reload({ waitUntil: 'networkidle' })

// ---- 7. kibble + chat error/retry UI exists, board loads ----
console.log('7. live boards')
await page.locator('.navtabs button', { hasText: 'Kibble Board' }).click()
let boardLoaded = true
try { await page.locator('.job').first().waitFor({ state: 'visible', timeout: 30000 }) } catch { boardLoaded = false }
ok('board loaded jobs', boardLoaded && (await page.locator('.job').count()) > 0)
ok('refresh button present', await page.locator('button', { hasText: 'Refresh' }).count() === 1)
// the step-by-step guide card (kb_g_* keys) — 6 numbered steps + collapse toggle
ok('guide card present', await page.locator('[data-testid="kibble-guide"]').count() === 1)
ok('guide shows 6 numbered steps', await page.locator('[data-testid="kibble-guide"] .kbstep').count() === 6)
ok('guide step badges count 1..6',
  (await page.locator('[data-testid="kibble-guide"] .stepn').allTextContents()).join(',') === '1,2,3,4,5,6')
await page.locator('[data-testid="kibble-guide"] button', { hasText: 'Hide guide' }).click()
const hidden = (await page.locator('[data-testid="kibble-guide"] .kbstep').count()) === 0
await page.locator('[data-testid="kibble-guide"] button', { hasText: 'Show guide' }).click()
ok('guide hide/show toggle collapses and restores steps',
  hidden && (await page.locator('[data-testid="kibble-guide"] .kbstep').count()) === 6)
await page.locator('.navtabs button', { hasText: 'Agent Chat' }).click()
let chatLoaded = true
try { await page.locator('.msg').first().waitFor({ state: 'visible', timeout: 30000 }) } catch { chatLoaded = false }
ok('chat messages loaded', chatLoaded && (await page.locator('.msg').count()) > 0)
ok('chat reload button present', await page.locator('button', { hasText: 'Reload' }).count() >= 1)

// ---- 8. mobile tabbar ----
console.log('8. mobile')
const mp = await ctx.newPage()
mp.on('pageerror', (e) => errors.push(`mobile pageerror: ${e.message}`))
await mp.setViewportSize({ width: 390, height: 800 })
await mp.goto(URL, { waitUntil: 'networkidle' })
await mp.waitForTimeout(500)
const tabs = await mp.locator('.tabbar-mobile button').allTextContents()
ok('mobile tabbar shows 10 tabs', tabs.length === 10)
ok('mobile tokenomics short label', tabs.some((x) => x.includes('Tokenomics')))
await mp.screenshot({ path: '/tmp/pwtest/shot-mobile.png' })

// ---- 9. hash routing + dynamic title + copy DID ----
console.log('9. hash routing & title')
await page.locator('.navtabs button', { hasText: 'Kibble Board' }).click()
await page.waitForTimeout(300)
ok('tab click sets the URL hash', page.url().endsWith('#kibble'))
ok('document.title follows the tab', (await page.title()).includes('Kibble Board'))
ok('aria-current marks the active tab', await page.locator('.navtabs button.active').getAttribute('aria-current') === 'page')
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(400)
ok('reload keeps the tab (hash routing)', (await page.locator('.navtabs button.active').textContent()) === 'Kibble Board')
await page.goBack()
await page.waitForTimeout(400)
ok('browser back returns to previous tab', (await page.locator('.navtabs button.active').textContent()) === 'Agent Chat')
// copy DID (section 6 wiped state — create a fresh identity first)
await page.locator('.navtabs button', { hasText: 'Identity' }).click()
await page.waitForTimeout(300)
await page.locator('input[placeholder="encrypts your key file backup"]').fill('hunter2starlong')
await page.locator('input[placeholder="repeat it"]').fill('hunter2starlong')
await page.locator('button', { hasText: 'Generate key pair' }).click()
await page.locator('.didbadge.on').waitFor({ state: 'visible', timeout: 15000 })
// scan-on-open: a reload with an identity must repopulate the activity scan by itself
await page.reload({ waitUntil: 'domcontentloaded' })
let autoScanned = true
try {
  await page.waitForFunction(
    () => { const s = JSON.parse(localStorage.getItem('flop-toolkit-v1')); return s && s.activity && s.activity.scan },
    null, { timeout: 45000, polling: 1000 },
  )
} catch { autoScanned = false }
ok('scan runs automatically on app open', autoScanned)
await page.locator('.didbadge.on').click()
await page.waitForTimeout(300)
ok('topbar DID badge copies on click', (await page.locator('.didbadge.on').textContent()).includes('copied'))
// navigator.clipboard only exists in secure contexts — the app copies via a
// legacy fallback on plain-HTTP origins, so only read back when the API is there
const clipText = await page.evaluate(() => (navigator.clipboard?.readText ? navigator.clipboard.readText() : null)).catch(() => null)
ok('clipboard holds the full DID (readback skipped on insecure origins)', clipText === null || clipText.startsWith('did:key:z6Mk'))
await page.locator('.navtabs button', { hasText: 'Dashboard' }).click()
await page.waitForTimeout(300)
ok('dashboard title after navigation', (await page.title()).startsWith('Dashboard'))

// scan button shows a spinner while a scan is running
await page.locator('.navtabs button', { hasText: 'Airdrop Guide' }).click()
let spinOk = false
try {
  const rescan = page.locator('button', { hasText: 'Re-scan my live activity' })
  await rescan.waitFor({ state: 'visible', timeout: 30000 })
  await rescan.click()
  await page.waitForTimeout(150)
  const busyBtn = page.locator('button', { hasText: 'Scanning…' }).first()
  spinOk = (await busyBtn.textContent()).includes('Scanning') && (await busyBtn.locator('.spin').count()) === 1
} catch { spinOk = false }
ok('scan button shows spinner while scanning', spinOk)

// dashboard stats / readiness after wipe (fresh state)
await page.locator('.navtabs button').first().click()
await page.waitForTimeout(2500)
ok('dashboard board stats loaded', await page.locator('.stat b', { hasText: /\d/ }).count() > 0)

// ---- 10. backup restore shows a busy state ----
console.log('10. backup restore')
await page.locator('.navtabs button', { hasText: 'Backup' }).click()
await page.waitForTimeout(300)
// a valid backup payload built from the live state
const backupJson = await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('flop-toolkit-v1'))
  return JSON.stringify({ app: 'flop-toolkit', version: 1, exportedAt: new Date().toISOString(), state: s })
})
await page.locator('textarea').first().fill(backupJson)
const restoreBtn = page.locator('button', { hasText: 'Restore from pasted JSON' })
let restoreBusy = false
try {
  await restoreBtn.click()
  // NB: the button's own label changes to 'Restoring…', so query the DOM directly
  restoreBusy = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('Restoring'))
    return Boolean(b && b.querySelector('.spin'))
  })
} catch { restoreBusy = false }
ok('restore button shows spinner while restoring', restoreBusy)
await page.waitForTimeout(1200)
ok('legacy plain backup restores (Restored ✓)', (await page.locator('.note', { hasText: 'Restored ✓' }).count()) === 1)
ok('state survives the plain round-trip (identity back)', await page.evaluate(() => Boolean(JSON.parse(localStorage.getItem('flop-toolkit-v1')).identity)))

// encrypted export: passphrase-gated, key never in plain text
const resPassInput = page.locator('input[placeholder="passphrase the backup was exported with"]')
const didBeforeEnc = await page.evaluate(() => JSON.parse(localStorage.getItem('flop-toolkit-v1')).identity.did)
// the export passphrase inputs are prefilled with the identity's key-file passphrase
const [dl3] = await Promise.all([
  page.waitForEvent('download'),
  page.locator('button', { hasText: 'Download .json' }).click(),
])
await page.waitForTimeout(1500)
const encBackup = fs.readFileSync(await dl3.path(), 'utf8')
ok('export is JSON with keyEnc marker', (() => { try { return JSON.parse(encBackup).keyEnc.includes('PBES2') } catch { return false } })())
ok('exported key is an encrypted PEM', encBackup.includes('-----BEGIN ENCRYPTED PRIVATE KEY-----'))
ok('no plain seedHex in the backup', !encBackup.includes('seedHex'))
ok('no stored passphrase leaked into the backup', !encBackup.includes('hunter2starlong'))
// restore it back: no passphrase -> refused; wrong -> refused; right -> works
await page.locator('textarea').first().fill(encBackup)
await page.locator('button', { hasText: 'Restore from pasted JSON' }).click()
await page.waitForTimeout(1200)
ok('encrypted restore without passphrase is refused', (await page.locator('.error').last().textContent()).includes('enter the passphrase'))
await resPassInput.fill('totally wrong pass')
await page.locator('button', { hasText: 'Restore from pasted JSON' }).click()
await page.waitForTimeout(1500)
ok('wrong passphrase is refused', (await page.locator('.error').last().textContent()).includes('Wrong passphrase'))
await resPassInput.fill('hunter2starlong')
await page.locator('button', { hasText: 'Restore from pasted JSON' }).click()
await page.waitForTimeout(1500)
ok('encrypted restore with the right passphrase works', (await page.locator('.note', { hasText: 'Restored ✓' }).count()) >= 1)
ok('restored identity is the same DID', (await page.evaluate(() => JSON.parse(localStorage.getItem('flop-toolkit-v1')).identity?.did)) === didBeforeEnc)
ok('restored identity has a working key again', await page.evaluate(() => Boolean(JSON.parse(localStorage.getItem('flop-toolkit-v1')).identity?.seedHex)))

// ---- 11. kibble "needs my attest" filter (three-party rule helper) ----
console.log('11. needs-attest filter')
await page.locator('.navtabs button', { hasText: 'Kibble Board' }).click()
let attFilter = page.locator('button', { hasText: 'needs my attest' })
try { await attFilter.waitFor({ state: 'visible', timeout: 30000 }) } catch {}
ok('needs-attest filter appears once an identity exists', await attFilter.count() === 1)
await attFilter.click()
await page.waitForTimeout(500)
ok('filter toggles to checked/primary', (await attFilter.getAttribute('class')).includes('primary') && (await attFilter.textContent()).includes('✓'))
// wait until the board itself has loaded (jobs or the no-match note), then assert
try {
  await page.waitForFunction(
    () => document.querySelectorAll('.job').length > 0
      || [...document.querySelectorAll('.joblist')].some((n) => n.textContent.includes('No jobs match.')),
    null, { timeout: 30000, polling: 500 },
  )
} catch {}
// every surviving job is delivered and neither poster nor worker is YOU
const filtered = await page.evaluate(() => {
  const jobs = [...document.querySelectorAll('.job')]
  const nomatch = [...document.querySelectorAll('.joblist, .card')].some((n) => n.textContent.includes('No jobs match.'))
  return {
    n: jobs.length,
    allDelivered: jobs.every((j) => j.querySelector('.badge').className.includes('delivered')),
    noneMine: jobs.every((j) => !j.textContent.includes('YOU')),
    nomatch,
  }
})
ok('filtered list shows only delivered jobs', filtered.n === 0 || filtered.allDelivered)
ok('filtered list never shows my own jobs', filtered.n === 0 || filtered.noneMine)
ok('filter result is jobs or the no-match note', (filtered.n > 0) !== filtered.nomatch)

// ---- 12. chat pre-send quality gate (anti-farming guardrail) ----
console.log('12. quality gate')
await page.locator('.navtabs button', { hasText: 'Agent Chat' }).click()
await page.waitForTimeout(500)
const compose = page.locator('textarea').first()
await compose.fill('gm')
await page.waitForTimeout(300)
ok('greeting-only post triggers the quality warning', (await page.locator('.note.warn').filter({ hasText: 'Quality check' }).count()) === 1)
await page.locator('button', { hasText: 'Send' }).first().click()
await page.waitForTimeout(400)
ok('send is gated behind Send anyway (nothing posted)', (await page.locator('button', { hasText: 'Send anyway' }).count()) === 1 && (await page.locator('div.note').filter({ hasText: 'Sent ✓' }).count()) === 0)
await page.locator('button', { hasText: 'Keep editing' }).click()
await page.waitForTimeout(200)
ok('keep editing closes the confirm bar', (await page.locator('button', { hasText: 'Send anyway' }).count()) === 0)
await compose.fill('A meaningful test message that is long enough to clear the one hundred and forty character threshold of the quality gate, which this sentence comfortably exceeds by a wide margin.')
await page.waitForTimeout(300)
ok('a 140+ character message clears the warning', (await page.locator('.note.warn').filter({ hasText: 'Quality check' }).count()) === 0)
ok('suggested rooms include the FLOP rooms', (await page.locator('.roompick button', { hasText: 'flop_governance' }).count()) === 1 && (await page.locator('.roompick button', { hasText: 'flop_labs' }).count()) === 1)
// unchecking "sign as my DID" must warn the post is unattributable
const signBox = page.locator('label', { hasText: 'sign as my DID' }).locator('input')
ok('sign-as-DID checkbox defaults to checked', await signBox.isChecked())
await signBox.click()
await page.waitForTimeout(200)
ok('unsigned mode warns the post is not attributable', (await page.locator('p').filter({ hasText: 'NOT attributable to your DID' }).count()) === 1)
await signBox.click()
await page.waitForTimeout(200)

// ---- 13. testnet readiness (GPU check + spend→unlock calculator) ----
console.log('13. testnet readiness')
await page.locator('.navtabs button', { hasText: 'Airdrop Guide' }).click()
await page.waitForTimeout(600)
const gpuBtn = page.locator('button', { hasText: 'Detect my GPU' })
ok('GPU detect button present', await gpuBtn.count() === 1)
await gpuBtn.click()
await page.waitForTimeout(300)
const det = await page.evaluate(() => [...document.querySelectorAll('span')].map((s) => s.textContent).find((x) => x.includes('Detected renderer:')) || '')
ok('GPU detection renders a renderer string', /Detected renderer: (?!$)/.test(det) && det.length > 'Detected renderer: '.length + 2)
const spendInput = page.locator('input[type="number"]')
ok('spend calculator input present', await spendInput.count() === 1)
await spendInput.fill('300')
await page.waitForTimeout(300)
ok('spend calculator computes the 3:1 unlock', (await page.locator('b').filter({ hasText: 'unlocks ≈ 100' }).count()) === 1)
// the how-contributions-will-be-counted card, with all four sections
ok('contribution-counting card heading present', (await page.locator('h3').filter({ hasText: 'How contributions will likely be counted' }).count()) === 1)
for (const sub of ['Confirmed by the teaser', 'Inferred from systems they already run', 'How they will recognize you', 'Honest unknowns']) {
  ok(`card section "${sub}" present`, (await page.locator('b').filter({ hasText: sub }).count()) >= 1)
}

// ---- 14. evidence report, DID-rotation guard, next best move ----
console.log('14. report & rotation guard')
// journal: add an evidence entry, then export it as the Phase-5 report
await page.locator('.navtabs button', { hasText: 'Journal' }).click()
await page.waitForTimeout(300)
await page.locator('input[placeholder*="Title — e.g."]').fill('E2E test evidence entry')
await page.locator('input[placeholder*="Public evidence URL"]').fill('https://github.com/maragung/flop-app')
await page.locator('button', { hasText: 'Add entry' }).click()
await page.waitForTimeout(300)
ok('journal evidence entry added', (await page.locator('.journalitem', { hasText: 'E2E test evidence entry' }).count()) === 1)
ok('evidence report buttons appear', (await page.locator('button', { hasText: 'Copy evidence report' }).count()) === 1 && (await page.locator('button', { hasText: 'Download report (.md)' }).count()) === 1)
await page.locator('button', { hasText: 'Copy evidence report' }).click()
await page.waitForTimeout(400)
ok('copy report flashes copied', (await page.locator('button', { hasText: 'copied ✓' }).count()) === 1)
const [dl4] = await Promise.all([
  page.waitForEvent('download'),
  page.locator('button', { hasText: 'Download report (.md)' }).click(),
])
ok('report downloads as flop-evidence-report.md', dl4.suggestedFilename() === 'flop-evidence-report.md')
const report = fs.readFileSync(await dl4.path(), 'utf8')
ok('report carries DID + the evidence URL', report.includes('# FLOP contribution evidence report') && report.includes(didBeforeEnc) && report.includes('https://github.com/maragung/flop-app'))

// DID-rotation guard: removing the identity arms it; a different DID is refused, the same key restores
await page.locator('.navtabs button', { hasText: 'Identity' }).click()
await page.waitForTimeout(300)
const rotSeed = await page.evaluate(() => JSON.parse(localStorage.getItem('flop-toolkit-v1')).identity.seedHex)
const rotDid = await page.evaluate(() => JSON.parse(localStorage.getItem('flop-toolkit-v1')).identity.did)
fs.writeFileSync('/tmp/rotation-identity.txt', `FLOP Toolkit — did:key identity\nDID: ${rotDid}\nPrivate key (seed, 32 bytes hex): ${rotSeed}\nCreated: ${new Date().toISOString()}\n`)
await page.locator('button', { hasText: 'Remove from this browser' }).click()
await page.waitForTimeout(400)
ok('removal arms the rotation warning', (await page.locator('button', { hasText: 'Generate key pair' }).count()) === 1 && (await page.locator('div.note').filter({ hasText: 'An identity was removed from this browser' }).count()) === 1)
// a DIFFERENT key with the confirm refused → blocked (the section-5 PEM is another DID)
dialogHandler = (d) => d.dismiss()
await page.setInputFiles('input[type=file]', '/tmp/frombrowser-plain.pem')
await page.waitForTimeout(400)
await page.locator('button', { hasText: 'Import key' }).click()
await page.waitForTimeout(800)
ok('different-DID import is refused when not confirmed', await page.evaluate(() => !JSON.parse(localStorage.getItem('flop-toolkit-v1')).identity))
// the SAME key needs no confirm and clears the warning
dialogHandler = (d) => d.accept()
await page.setInputFiles('input[type=file]', '/tmp/rotation-identity.txt')
await page.waitForTimeout(400)
await page.locator('button', { hasText: 'Import key' }).click()
await page.waitForTimeout(800)
ok('same-key restore brings the DID back', await page.evaluate(() => JSON.parse(localStorage.getItem('flop-toolkit-v1')).identity?.did) === rotDid)
ok('restore clears the rotation warning', (await page.locator('div.note').filter({ hasText: 'An identity was removed from this browser' }).count()) === 0)

// dashboard: the next-best-move coach card
await page.locator('.navtabs button', { hasText: 'Dashboard' }).click()
await page.waitForTimeout(500)
ok('next best move card present', await page.locator('.card', { hasText: 'Next best move' }).count() === 1)
ok('next best move shows a CTA button', (await page.locator('.card', { hasText: 'Next best move' }).locator('button').count()) === 1)

// footer: builder credit, GitHub repo link, and the builder's public DID (click-to-copy)
ok('footer links the flop-app GitHub repo', (await page.locator('.appfoot a[href="https://github.com/maragung/flop-app"]').count()) === 1)
ok('footer shows the builder DID', (await page.locator('.appfoot .didfoot').textContent()).includes('did:key:z6MkeZAT641SbbXmAUqP8yZe2UqpFnRLC9XihYkQR2EherwJ'))
await page.locator('.appfoot .didfoot').click()
await page.waitForTimeout(300)
ok('footer DID is click-to-copy', (await page.locator('.appfoot .didfoot').textContent()).includes('copied ✓'))

// ---- 15. share-on-X: unique tweet per completed task, DID at the bottom ----
console.log('15. share on X')
await page.locator('.navtabs button', { hasText: 'Airdrop Guide' }).click()
await page.waitForTimeout(500)
const shareBtns = page.locator('.checkitem .sharebtn')
ok('completed tasks show a share-on-X button', await shareBtns.count() >= 1)
await page.evaluate(() => { window.__opens = []; window.open = (u) => { window.__opens.push(u); return null } })
await shareBtns.first().click()
await page.waitForTimeout(200)
await shareBtns.first().click()
await page.waitForTimeout(200)
const twUrls = await page.evaluate(() => window.__opens)
const twTexts = twUrls.map((u) => decodeURIComponent(u.replace('https://x.com/intent/tweet?text=', '')))
const myDid = await page.evaluate(() => JSON.parse(localStorage.getItem('flop-toolkit-v1')).identity.did)
ok('share opens the X intent with the DID at the bottom', twUrls.length === 2 && twUrls[0].startsWith('https://x.com/intent/tweet?text=') && twTexts.every((x) => x.trim().endsWith(myDid)))
ok('two shares of the same task never compose the same tweet', twTexts[0] !== twTexts[1])
ok('tweet stays inside the 278-char cap', twTexts.every((x) => x.length <= 278))

// ---- 16. tclk tab: dry run, decoder, builder ----
console.log('16. tclk')
await page.locator('.navtabs button', { hasText: 'tclk Deals' }).click()
await page.waitForTimeout(500)
ok('tclk intro card present', await page.locator('[data-testid="tclk-intro"]').count() === 1)
ok('tab click sets the tclk hash', page.url().endsWith('#tclk'))
// dry run: the full offer → accept → lock → reveal walk on the real state machine
const dr = page.locator('[data-testid="tclk-dryrun"]')
ok('dry run starts with no status badge', (await dr.locator('.badge.tk-proposed, .badge.tk-accepted, .badge.tk-locked, .badge.tk-claimed').count()) === 0)
await dr.locator('button', { hasText: 'post offer' }).click()
await page.waitForTimeout(100)
ok('offer → proposed', (await dr.locator('.badge.tk-proposed').count()) === 1)
await dr.locator('button', { hasText: 'accept + mint lock' }).click()
await page.waitForTimeout(100)
ok('accept → accepted', (await dr.locator('.badge.tk-accepted').count()) === 1)
await dr.locator('button', { hasText: 'lock on paper' }).click()
await page.waitForTimeout(100)
ok('lock → locked', (await dr.locator('.badge.tk-locked').count()) === 1)
await dr.locator('button', { hasText: 'try a wrong secret' }).click()
await page.waitForTimeout(100)
const wrongTxt = (await dr.locator('[data-testid="tclk-dryrun-log"] .tkstep.bad').allTextContents()).join(' ')
ok('wrong secret is rejected and the deal stays locked',
  (await dr.locator('.badge.tk-locked').count()) === 1 && wrongTxt.includes('✗'))
await dr.locator('button', { hasText: 'reveal secret' }).click()
await page.waitForTimeout(100)
ok('real secret → claimed', (await dr.locator('.badge.tk-claimed').count()) === 1)
// decoder: garbage in → rejection; a real frame from the dry-run log → decoded
const dec = page.locator('[data-testid="tclk-decoder"]')
await dec.locator('textarea').fill('this is not a tclk line')
ok('decoder rejects a non-tclk line', (await dec.locator('[data-testid="tclk-decode-bad"]').textContent()).includes('tclk1'))
const offerLine = (await dr.locator('.tkline').first().textContent()).trim()
await dec.locator('textarea').fill(offerLine)
ok('decoder decodes a real tclk1 frame',
  (await dec.locator('[data-testid="tclk-decode-ok"]').count()) === 1 &&
  (await dec.locator('[data-testid="tclk-decode-ok"] pre').textContent()).includes('"type": "offer"'))
// builder: identity exists by this point in the suite — build a real offer frame
const bld = page.locator('[data-testid="tclk-builder"]')
ok('builder shows no missing-identity warning', (await bld.locator('p.tiny').count()) === 0)
await bld.locator('button', { hasText: 'Build offer' }).click()
await page.waitForTimeout(200)
const builtLine = (await bld.locator('[data-testid="tclk-offer-line"]').textContent()).trim()
ok('builder emits a tclk1 offer line', builtLine.startsWith('tclk1 ') && builtLine.includes('"type":"offer"'))
// live deals: the fold card renders (rows depend on the public room's content)
ok('live deals card present', await page.locator('[data-testid="tclk-live"]').count() === 1)

console.log(`\n${pass} passed, ${fail} failed`)
if (errors.length) { console.log('PAGE ERRORS:'); errors.forEach((e) => console.log('  ' + e)) }
else console.log('no page errors')

await browser.close()
process.exit(fail || errors.length ? 1 : 0)
