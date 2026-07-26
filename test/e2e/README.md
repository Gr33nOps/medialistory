# End-to-end (Playwright scaffold)

Optional browser coverage. Not part of default `npm test` CI.

## Setup

```bash
npm i -D @playwright/test
npx playwright install chromium
```

## Run

Start the app (`npm start`), then:

```bash
# Windows PowerShell
$env:E2E_EMAIL="you@example.com"
$env:E2E_PASSWORD="your-password"
npm run test:e2e
```

Spec: `auth-add-game.spec.js` - login → land on `home.html`.

Extend later: open a game modal → Add to List → assert My List row.

## Manual checklist (no Playwright)

1. Open `/` → Get started → register/login  
2. Land on `home.html` (or `?next=` target)  
3. Open a game → Add to List  
4. Open My List → confirm status/score  
5. Following → search/follow a user  
6. Profile → export via `GET /api/user/export`
