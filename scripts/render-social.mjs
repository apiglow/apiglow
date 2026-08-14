// Renders brand/apiglow-social.svg to brand/apiglow-social-1280x640.png, the
// repository social preview. 1280×640 at 1×, the size GitHub crops to — the
// card is text at final size, so a 2× shot downscaled would only soften it.
// Chromium comes from the e2e toolchain; nothing here ships.
import { chromium } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))
// No D-Bus session bus for headless Chromium — see playwright.config.js.
process.env.DBUS_SESSION_BUS_ADDRESS = '/dev/null'
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 640 } })
  await page.goto(`file://${join(root, 'brand', 'apiglow-social.svg')}`)
  // The pitch line is the only thing a font touches, and it is set at the size
  // the card ships at — shooting before it swaps in would bake the fallback.
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: join(root, 'brand', 'apiglow-social-1280x640.png') })
} finally {
  await browser.close()
}
console.log('brand/apiglow-social-1280x640.png rendered')
