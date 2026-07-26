/**
 * Playwright E2E scaffold: auth → add game.
 *
 * Setup (once):
 *   npm i -D @playwright/test
 *   npx playwright install chromium
 *
 * Run (server must be up on BASE_URL):
 *   set E2E_EMAIL=...& set E2E_PASSWORD=...& npm run test:e2e
 */
const { test, expect } = require('@playwright/test');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;

test.describe('auth → add game', () => {
  test.skip(!EMAIL || !PASSWORD, 'Set E2E_EMAIL and E2E_PASSWORD');

  test('login and open home catalog', async ({ page }) => {
    await page.goto(BASE + '/auth.html');
    await page.fill('#loginEmail', EMAIL);
    await page.fill('#loginPassword', PASSWORD);
    await page.click('#loginBtn');
    await page.waitForURL(/home\.html/);
    await expect(page.locator('#appNav, .navbar').first()).toBeVisible();
  });
});
