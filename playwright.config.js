/** @type {import('@playwright/test').PlaywrightTestConfig} */
module.exports = {
  testDir: 'test/e2e',
  timeout: 60_000,
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry'
  },
  reporter: [['list']]
};
