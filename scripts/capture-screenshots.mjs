/** Captures clean product screenshots from the seeded demo (no content edits). */
import { chromium } from 'playwright-core';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const WEB = process.env.COEDIT_WEB_URL ?? 'http://localhost:3000';
const EDITOR_LINK = `${WEB}/s/demoEditorLink9d1f3b5a7c2e4f6b8d1a3c5e7f9b2d4a`;
const VIEWER_LINK = `${WEB}/s/demoViewerLink4f8a2c6e9b1d3f5a7c9e2b4d6f8a1c3e`;

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

const browser = await chromium.launch({
  executablePath: findChromium() ?? undefined,
  headless: true,
  args: ['--no-sandbox'],
});

async function join(context, link, name) {
  const page = await context.newPage();
  await page.goto(link, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Join the document' }).click();
  await page.waitForURL('**/s/**');
  await page.locator('.cm-content').waitFor({ timeout: 20_000 });
  await page.locator('.cm-content').filter({ hasText: 'Northstar launch brief' }).waitFor({
    timeout: 20_000,
  });
  return page;
}

const adaContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const samContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const ada = await join(adaContext, EDITOR_LINK, 'Ada Lovelace');
const sam = await join(samContext, EDITOR_LINK, 'Sam Rivera');
await sam.locator('.cm-content').click();
await sam.keyboard.press('Control+Home');
for (let index = 0; index < 9; index += 1) await sam.keyboard.press('ArrowDown');
await sam.keyboard.press('Shift+End');
await ada.locator('.cm-ySelectionInfo').filter({ hasText: 'Sam Rivera' }).waitFor({ timeout: 15_000 });
await ada.waitForTimeout(400);
await ada.screenshot({ path: 'docs/screenshots/editor.png' });

await ada.getByRole('tab', { name: /Versions/ }).click();
await ada.locator('.version-row').first().waitFor();
await ada.screenshot({ path: 'docs/screenshots/versions.png' });

// The share panel is account-only, so capture it from the owner's session.
const loginResponse = await fetch('http://127.0.0.1:8787/api/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'demo@coedit.dev', password: 'Password123!' }),
});
const login = await loginResponse.json();
const docsResponse = await fetch('http://127.0.0.1:8787/api/documents', {
  headers: { authorization: `Bearer ${login.token}` },
});
const docs = await docsResponse.json();
const launch = docs.documents.find((entry) => entry.title === 'Northstar launch brief');

const ownerContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const owner = await ownerContext.newPage();
await owner.goto(`${WEB}/login`, { waitUntil: 'domcontentloaded' });
await owner.getByRole('button', { name: 'Sign in' }).click();
await owner.waitForURL('**/documents', { timeout: 20_000 });
await owner.goto(`${WEB}/documents/${launch.id}`, { waitUntil: 'domcontentloaded' });
await owner.locator('.cm-content').waitFor({ timeout: 20_000 });
await owner.getByRole('tab', { name: /Share/ }).click();
await owner.locator('.share-row').first().waitFor();
await owner.screenshot({ path: 'docs/screenshots/share.png' });

const viewerContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const viewer = await join(viewerContext, VIEWER_LINK, 'Priya Nair');
await viewer.waitForTimeout(500);
await viewer.screenshot({ path: 'docs/screenshots/viewer.png' });

const landingContext = await browser.newContext({ viewport: { width: 1440, height: 980 } });
const landing = await landingContext.newPage();
await landing.goto(WEB, { waitUntil: 'domcontentloaded' });
await landing.waitForTimeout(800);
await landing.screenshot({ path: 'docs/screenshots/landing.png', fullPage: true });

const dashboardContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const dashboard = await dashboardContext.newPage();
await dashboard.goto(`${WEB}/login`, { waitUntil: 'domcontentloaded' });
await dashboard.getByRole('button', { name: 'Sign in' }).click();
await dashboard.waitForURL('**/documents', { timeout: 20_000 });
await dashboard.locator('.doc-card').first().waitFor();
await dashboard.screenshot({ path: 'docs/screenshots/dashboard.png' });

await Promise.all([
  adaContext.close(),
  samContext.close(),
  ownerContext.close(),
  viewerContext.close(),
  landingContext.close(),
  dashboardContext.close(),
]);
await browser.close();
console.log('Screenshots captured in docs/screenshots/');
