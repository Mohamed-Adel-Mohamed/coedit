/**
 * End-to-end browser verification with two independent sessions on the same
 * editor share link. Run the dev servers first (npm run dev), then:
 *
 *   node scripts/verify-ui.mjs
 */
import { chromium } from 'playwright-core';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const WEB = process.env.COEDIT_WEB_URL ?? 'http://localhost:3000';
const EDITOR_LINK = `${WEB}/s/demoEditorLink9d1f3b5a7c2e4f6b8d1a3c5e7f9b2d4a`;
const LANDING = WEB;

function findChromium() {
  if (process.env.CHROMIUM_PATH && existsSync(process.env.CHROMIUM_PATH)) {
    return process.env.CHROMIUM_PATH;
  }
  const cache = path.join(homedir(), '.cache', 'ms-playwright');
  if (!existsSync(cache)) return null;
  for (const entry of readdirSync(cache)) {
    if (!entry.startsWith('chromium-')) continue;
    for (const relative of ['chrome-linux64/chrome', 'chrome-linux/chrome']) {
      const candidate = path.join(cache, entry, relative);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

const executablePath = findChromium();
if (!executablePath) {
  console.error('No Chromium found. Set CHROMIUM_PATH or install Playwright browsers.');
  process.exit(1);
}

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox'],
});

const errors = [];

async function joinAs(context, name) {
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(`[${name}] pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('Failed to load resource')) {
      errors.push(`[${name}] console: ${message.text()}`);
    }
  });
  await page.goto(EDITOR_LINK, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Join the document' }).click();
  await page.waitForURL(`**/s/**`, { timeout: 15_000 });
  await page.locator('.cm-content').waitFor({ state: 'visible', timeout: 15_000 });
  return page;
}

const contextA = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const contextB = await browser.newContext({ viewport: { width: 1440, height: 900 } });

const marker = `E2E-${Date.now().toString(36)}`;
const note = `Browser-verified note ${marker}`;

try {
  const a = await joinAs(contextA, 'Ada Live');
  const b = await joinAs(contextB, 'Sam Live');

  // Both replicas load the seeded document over the websocket.
  await a.locator('.cm-content').filter({ hasText: 'Northstar launch brief' }).waitFor({ timeout: 15_000 });
  await b.locator('.cm-content').filter({ hasText: 'Northstar launch brief' }).waitFor({ timeout: 15_000 });
  console.log('✓ both sessions loaded the CRDT document');

  // Type at the end of A's editor and wait for B to receive it.
  await a.locator('.cm-content').click();
  await a.keyboard.press('Control+End');
  await a.keyboard.insertText(`\n\n${marker}\n`);
  await b.locator('.cm-content').filter({ hasText: marker }).waitFor({ timeout: 15_000 });
  console.log('✓ A → B live CRDT convergence');

  // Presence: B should show A's server-issued display name.
  await b.locator('.presence .avatar[title*="Ada Live"]').waitFor({ timeout: 15_000 });
  console.log('✓ presence and cursor identity propagated');

  // Comments: select text in B, write a comment, wait for A to receive the hint.
  await b.locator('.cm-content').click();
  await b.keyboard.press('Control+Home');
  for (let index = 0; index < 9; index += 1) await b.keyboard.press('Shift+ArrowRight');
  await b.locator('.comment-composer textarea').fill(note);
  await b.getByRole('button', { name: 'Comment', exact: true }).click();
  await a.locator('.comment-card').filter({ hasText: note }).waitFor({ timeout: 15_000 });
  console.log('✓ comment created on B appeared on A');

  await a.screenshot({ path: 'docs/screenshots/editor.png' });
  await a.getByRole('tab', { name: /Versions/ }).click();
  await a.locator('.version-row').first().waitFor();
  await a.screenshot({ path: 'docs/screenshots/versions.png' });

  const landingContext = await browser.newContext({ viewport: { width: 1440, height: 980 } });
  const landing = await landingContext.newPage();
  await landing.goto(LANDING, { waitUntil: 'networkidle' });
  await landing.screenshot({ path: 'docs/screenshots/landing.png', fullPage: true });
  await landingContext.close();

  const dashboardContext = await browser.newContext({ viewport: { width: 1440, height: 940 } });
  const dashboard = await dashboardContext.newPage();
  await dashboard.goto(`${WEB}/login`, { waitUntil: 'domcontentloaded' });
  await dashboard.getByRole('button', { name: 'Sign in' }).click();
  await dashboard.waitForURL('**/documents', { timeout: 15_000 });
  await dashboard.locator('.doc-card').first().waitFor();
  await dashboard.screenshot({ path: 'docs/screenshots/dashboard.png' });
  await dashboardContext.close();

  console.log('✓ screenshots written to docs/screenshots/');
} finally {
  await contextA.close();
  await contextB.close();
  await browser.close();
}

if (errors.length > 0) {
  console.error('\nBrowser errors:');
  for (const error of errors) console.error(error);
  process.exitCode = 1;
} else {
  console.log('✓ no page errors or console errors');
}
