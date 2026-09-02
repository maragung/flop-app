// e2e.mjs — the FLOP Toolkit regression suite (50 checks) via playwright-core.
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
await langSel.selectOption('ar')
await page.waitForTimeout(300)
ok('RTL applied for Arabic', await page.evaluate(() => document.documentElement.dir === 'rtl'))
ok('Arabic tab label', (await page.locator('.navtabs button').first().textContent()).trim() === 'لوحة التحكم')
await langSel.selectOption('en')
await page.waitForTimeout(300)
ok('back to LTR English', await page.evaluate(() => document.documentElement.dir === 'ltr' && document.documentElement.lang === 'en'))
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
page.on('dialog', (d) => d.accept())
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
ok('mobile tabbar shows 9 tabs', tabs.length === 9)
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
ok('clipboard holds the full DID', (await page.evaluate(() => navigator.clipboard.readText())).startsWith('did:key:z6Mk'))
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

console.log(`\n${pass} passed, ${fail} failed`)
if (errors.length) { console.log('PAGE ERRORS:'); errors.forEach((e) => console.log('  ' + e)) }
else console.log('no page errors')

await browser.close()
process.exit(fail || errors.length ? 1 : 0)
