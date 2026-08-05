# CLAUDE.md — DasGateway E2E (`das-gateway-e2e`)

Guidance for Claude (and humans) when working in this repo. The project is a
**Playwright + TypeScript end-to-end suite** for the **Payment Options / DasGateway
internal admin portal**. It contains *only* the test suite — not the app under test.

> **North star:** new tests are authored by **debugging the live app in the
> browser first** (discover the real DOM, selectors, URL params, and network
> calls), *then* codifying what was observed into a Page Object + spec. Never
> guess selectors — verify them against the running app.

---

## 1. Stack & layout

- **Runner:** `@playwright/test` ^1.59, TypeScript ~6, ESM (`"type": "module"`).
- **Architecture:** Page Object Model (POM). Specs stay thin; all locators and
  flows live in `pages/`.
- **Target app:** `https://dev.paymentoptions.com/beta` (dev). `BASE_URL` is the
  single source of truth and its path prefix (`/beta`) is applied to every route.

```
playwright/
├── playwright.config.ts     # testDir, reporters, baseURL, viewport 1680×900
├── .env.example             # copy → .env, fill creds
├── fixtures/
│   ├── test-config.ts       # BASE_URL, route(), TEST_CONFIG, ACTION_LABELS
│   ├── onboarding/          # JSON fixtures + load.ts + types.ts
│   └── products/            # JSON fixtures + load.ts + types.ts
├── pages/                   # POMs, split by domain
│   ├── auth/  merchants/  transactions/  onboarding/  finance/  products/
├── utils/
│   ├── scroll.ts            # scrollUntilRowCount (infinite scroll + idle detect)
│   ├── retry.ts             # backoff retry helper
│   ├── logger.ts            # log.info/warn/fail — "[E2E] …" prefix
│   ├── validators.ts        # cross-surface transaction-action assertions
│   └── dasForm.ts           # drive components/das-form controls
├── tests/                   # specs, mirroring pages/ domains
└── reports/                 # html + junit.xml + artifacts (traces/screens/video)
```

## 2. Commands

```bash
npm test                 # runs the suite in --ui mode
npm run test:no-ui       # headless run (CI-style)
npm run test:e2e:report  # open the last HTML report

# override at runtime — no code change:
TRANSACTION_COUNT=100 npm run test:no-ui
BASE_URL=https://staging.example.com npm run test:no-ui
```

Run a single spec: `npx playwright test playwright/tests/<domain>/<file>.spec.ts --config=playwright/playwright.config.ts`.

Config notes: `fullyParallel: false`, `retries` 1 local / 2 CI, `timeout` 90s,
`expect` 10s, viewport widened to **1680×900** so right-anchored drawers
(PBL create 920px + AddItemPanel 584px) fit without clipping. Trace/screenshot/
video are `retain-on-failure`.

## 3. Environment (`.env`)

Copy `playwright/.env.example` → `.env` (loaded from `playwright/.env` **and**
repo-root `.env`). Keys: `TEST_USERNAME`/`TEST_PASSWORD` (most suites),
`TEST_PARTNER_USERNAME`/`TEST_PARTNER_PASSWORD` (partner/referral suites),
optional `BASE_URL`, `TEST_OTP` (1234), `TEST_GUEST_EMAIL_DOMAIN`,
`TRANSACTION_COUNT`/`MERCHANT_COUNT`/`STATEMENT_COUNT`. Never commit `.env`.

---

## 4. Authoring a new test — the workflow

1. **Explore in the browser.** Log into the dev app and walk the target flow.
   Capture the real `data-testid`s, roles/accessible names, class hooks, the URL
   params each action pushes, and the network endpoints (method + path) each
   mutation calls.
2. **Prefer a throwaway discovery spec** for anything table/filter-driven.
   `tests/transactions/_discover-columns.spec.ts` is the template: derive live
   values from the DOM, apply the control, and `console.log` the URL params +
   resulting rows. Prefix with `_`, note "delete after use", and remove it once
   the real spec is written.
3. **Write/extend the POM** under `pages/<domain>/` — constructor sets the
   locators, plus `goto()` and a `waitForInitialLoad()`/`waitForReady()`.
4. **Write the spec** under `tests/<domain>/`, thin, using `test.step` blocks.
5. **Verify** against the live app before declaring done; keep the HTML report/
   trace for failures.

## 5. POM conventions

- **Locator priority — always resilient, `.first()` at the end:**
  ```ts
  page.getByTestId('login-username')
    .or(page.getByLabel(/username|email/i))
    .or(page.locator('input[name="username"], input[type="email"]'))
    .first();
  ```
  testid first → role/accessible-name → structural fallback. The app is
  under-instrumented, so `.or()` fallback chains are the norm, not an exception.
- **Every POM has** `goto()` (navigates via `TEST_CONFIG.routes.*`) and a
  readiness gate that: polls for "rows present **or** empty state", then asserts
  `skeletonRows` reach `toHaveCount(0)`. Reuse this shape.
- **Infinite scroll:** load rows with `scrollUntilRowCount(page, {...TEST_CONFIG.scroll})`
  against the table's own scroll container; it stops at target count or after
  `idleAttemptsBeforeStop` no-progress scrolls.
- **Reading table cells:** middle-truncated values (e.g. transaction ref ids)
  are read from the element's `title` attribute, not visible text. Resolve column
  index from header text (`columnIndex(/das mid/i)`) so specs don't hardcode `<td>` positions.
- **Mutations assert the network call**, not just the UI:
  ```ts
  const [resp] = await Promise.all([
    page.waitForResponse(r => r.url().includes(ENDPOINT) && r.request().method() === 'POST'),
    chip.click(),
  ]);
  expect(resp.ok()).toBeTruthy();
  ```
- **Navigation vs drawer** (transactions): the first cell's ref-id span
  *navigates* to `/transactions/:id`; clicking any other cell opens the global
  drawer (`?drawer=details&id=…`). Keep those two entry points distinct.

## 6. Custom UI controls — `das-form` & portaled menus

The app's `components/das-form` and custom `Select`/`MultiSelect`/`DateRange`
are **not** native form controls. Rules that keep locators stable:

- DasForm renders every field with `id={field.name}` → target by `#fieldName`
  (`#STATUS`, `#productName`, `#currency`). Stable across i18n label changes.
- Select/MultiSelect/DateRange menus render into a **body-level portal**
  `[data-filter-portal="true"]`. The freshly opened menu is the **`.last()`**
  such portal (a closing menu's portal may linger during its animation).
- Select options are `<button>`s; MultiSelect options are
  `<label><input type=checkbox>…</label>` — often driven via the menu's built-in
  search box, then check the matching option. MultiSelect has **no Escape
  handler**; close it by re-clicking the trigger or an outside safe element.
- DateField uses react-datepicker (calendar portal `#das-datepicker-portal`);
  **manual typing is blocked** (`onChangeRaw` prevent-default) — pick via the
  calendar. Use the `utils/dasForm.ts` helpers (`selectDasFormOption`,
  `pickDasFormDate`) rather than re-implementing.
- The Advanced-Filters popover renders inline (not portaled); anchor rule rows
  by their `grid-cols-[1fr_1fr_40px]` container / the "Remove filter" button.

## 7. Spec conventions

- Wrap in `test.describe`; **self-skip** when prerequisites are missing:
  `test.skip(!HAS_CREDS, 'TEST_USERNAME / TEST_PASSWORD not set')`.
- Structure the body with `test.step('…', async () => {…})` so failures pinpoint
  the phase.
- **Self-seed from live data:** read a real value from row 0, filter by it, then
  assert every visible row agrees — cases stay non-empty without a fixed seed.
- **Empty data & missing permissions self-annotate** rather than hard-fail:
  assert the empty state and push a `test.info().annotations` note, then return.
- Mark heavy suites `test.slow()`.
- **Mutating vs read-only:** `statements-actions.spec.ts` (Approve / Wired
  Status / edit STATUS) **changes backend state** — run only against a disposable
  dev environment, and needs FINANCE/SETTLEMENT/SUPPORT/SYSADMIN permissions
  (self-skips otherwise). Filter/smoke suites are read-only.
- Logging via `utils/logger.ts` (`log.info/warn/fail`), always include the row's
  ref/id in the meta so a failure says *which* record on *which* surface broke.

## 8. Fixtures

- JSON fixtures live under `fixtures/<domain>/` with a `load.ts` (uses
  `readFileSync` + `JSON.parse`, **not** a JSON import — tsconfig has no
  `resolveJsonModule`) and a `types.ts`.
- GUEST onboarding: emails template `{{unique}}` → a per-run base-36 timestamp so
  reruns never hit "email already registered"; secrets fall back to `TEST_CONFIG`.

## 9. Recommended `data-testid`s (ask app team to add — removes brittleness)

| Area | testids |
|---|---|
| Login | `login-username`, `login-password`, `login-submit`, `login-error` |
| Data table | `transactions-table` / `statements-table`, `transactions-row` / `statements-row`, `skeleton-row`, `transactions-row-ref-link` |
| Txn details actions | `action-refund/capture/void/dispute/editStatus` |
| Txn drawer | `transaction-drawer`, `drawer-action-refund/capture/void/dispute/editStatus` |

## 10. Gotchas

- ESM project (`"type": "module"`) — use ESM imports; `import.meta.url` for paths.
- No `resolveJsonModule` → read fixtures with `readFileSync`, not `import x from '*.json'`.
- Transaction `capture` and `void` are **mutually exclusive** — both visible = a
  selector bug (asserted in `utils/validators.ts`).
- Drawer/details action visibility must **agree across surfaces**
  (`assertSurfacesAgree`) — both consume the same `selectTransactionActions`.
- Reset filters by **reload** (`resetFiltersViaReload`) — the filter slice isn't
  persisted but auth is, so it's cheaper/safer than removing rules one by one.
- Pin the Statements tab explicitly (`?tab=merchant`) so a stale `?tab=` can't leak in.
- Keep the viewport ≥1680 wide when adding drawer-based flows.

---

## 11. Patterns & ideas (Abhilash's notes)

Ongoing conventions and things to build. Add freely.

- Author tests **browser-debug-first**: verify selectors/params/endpoints against
  the live app before writing the POM.
- Use temporary `_discover-*.spec.ts` probes to map filterable columns → URL
  params, then delete them.
- Prefer testid-first locators; lobby the app team to add the testids in §9.
- _(add your own patterns / ideas here)_
