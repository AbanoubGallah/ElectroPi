# Electro Pi POS — QA Automation Assessment

Test automation framework for a multi-tenant, cloud-based Point of Sale and
inventory management platform. Submitted as part of a Senior QA Engineer
technical assessment.

**The written answers to all three parts are in
[`docs/Abanoub-Gallah-QA-Assessment-ElectroPi.pdf`](docs/Abanoub-Gallah-QA-Assessment-ElectroPi.pdf)**
(source: [`docs/ANSWERS.md`](docs/ANSWERS.md)).

| | |
|---|---|
| **Stack** | Playwright + TypeScript (strict) |
| **Pattern** | Page Object Model + Component Objects + Fixtures |
| **Tests** | 17 automated (8 API, 9 UI) — all passing |
| **Postman** | 9 requests / 38 assertions — verified under Newman |
| **CI** | 3 GitHub Actions workflows (PR gate, post-deploy, nightly) |

---

## Quick start

No environment, database or VPN required — a mock POS application is bundled and
Playwright starts it automatically.

```bash
npm ci
npx playwright install chromium
npx playwright test --project=api --project=ui-chromium
```

```bash
npx playwright show-report     # HTML report with traces, screenshots and steps
```

Other useful commands:

```bash
npm run test:api          # API suite only            (~5s)
npm run test:ui           # UI suite only             (~14s)
npm run test:smoke        # @smoke tag - the release-blocking subset
npm run test:headed       # watch the browser drive the flow
npm run test:debug        # Playwright Inspector, step through a test
npm run typecheck         # TypeScript strict check
npm run app               # run the mock POS app on its own (port 4173)
```

To run the same suite against a real environment, point it at one — no code
change:

```bash
BASE_URL=https://staging.electropi.example npx playwright test --project=ui-chromium
```

## Where each part of the assessment lives

| Assessment part | Code |
|---|---|
| 1.1 Framework choice | `docs/ANSWERS.md` § 1.1 |
| 1.2 Design pattern | `src/` layout — `pages/`, `pages/components/`, `fixtures/`, `api/`, `data/`, `config/` |
| **1.3 Implementation (the requested flow)** | **[`tests/ui/inventory-create-product.spec.ts`](tests/ui/inventory-create-product.spec.ts)** |
| 1.4 Stability / no hardcoded sleeps | `src/pages/InventoryPage.ts` (`waitUntilReady`, `save`), `src/pages/components/ToastComponent.ts`, `playwright.config.ts` |
| 2.1 API test scenarios | [`tests/api/inventory-items.spec.ts`](tests/api/inventory-items.spec.ts) |
| 2.2 Postman automation | [`postman/`](postman/) — collection + environment |
| 3.1 Database validation | [`sql/01_verify_item_in_electronics.sql`](sql/01_verify_item_in_electronics.sql), `sql/validate_logic.sh` |
| 3.2 / 3.3 CI/CD + execution strategy | [`.github/workflows/`](.github/workflows/) |

## Layout

```
src/
  config/env.ts              environment, credentials, named timeouts (one source of truth)
  api/                       service clients: AuthApi, InventoryApi, typed contracts
  pages/                     BasePage, LoginPage, InventoryPage
    components/              ToastComponent, SideNavComponent (shared app shell)
  fixtures/test-fixtures.ts  dependency injection, worker-scoped auth, guaranteed teardown
  data/products.ts           test-data factories (unique by construction)
  utils/logger.ts            step logging, annotated into the HTML report
tests/
  api/                       API suite  (--project=api)
  ui/                        UI suite   (--project=ui-chromium)
mock-app/                    the application under test (Node core modules only)
postman/                     Postman collection + environment (Newman-ready)
sql/                         verification queries + an executable logic check
docs/                        the written answers, and the PDF build
.github/workflows/           PR gate, post-deploy E2E, nightly
```

## The mock application

`mock-app/` is a small POS app (no dependencies beyond Node) that exists so this
repository is runnable by anyone. It deliberately reproduces the traits that make
the real product hard to test, so the stability techniques in the framework are
genuinely exercised rather than merely described:

- multi-tenancy — every token, record and query is tenant-scoped
- async data render — the grid and the category select arrive via `fetch`, behind a spinner
- network latency — configurable (`LATENCY_MS`, default 350 ms)
- optimistic UI — Save is disabled while the request is in flight
- transient toasts — the success toast auto-dismisses after 4 s
- RBAC — a cashier receives `403` on an inventory write

Endpoints: `POST /api/v1/auth/login`, `GET /api/v1/categories`,
`POST|GET /api/v1/inventory/items`, `GET|DELETE /api/v1/inventory/items/:id`,
plus `/health` for readiness.

Test users (mock only — real credentials come from CI secrets):

| User | Role | Tenant |
|---|---|---|
| `admin@alpha-store.io` | STORE_ADMIN | tenant-alpha |
| `cashier@alpha-store.io` | CASHIER | tenant-alpha |
| `admin@beta-store.io` | STORE_ADMIN | tenant-beta |

## Verifying it works

```bash
# Postman collection headless (9 requests, 38 assertions)
npm run app &
npx newman run postman/ElectroPi-POS.postman_collection.json \
  -e postman/ElectroPi-Local.postman_environment.json
```

```bash
# SQL verification logic against 4 fixtures, including 3 failure modes
bash sql/validate_logic.sh
```

```bash
# Proof there are no hidden timing assumptions: 6x the network latency,
# no code change, same result.
LATENCY_MS=2000 npx playwright test --project=ui-chromium --grep @smoke
```

```bash
# Flake detection: repeat the suite with retries off
npx playwright test --project=ui-chromium --repeat-each=5 --retries=0
```

## Rebuilding the PDF

```bash
python3 docs/build-pdf.py && node docs/build-pdf.mjs
```

Requires `markdown-it-py`. The PDF is rendered by the Playwright Chromium
already installed for the tests.

## Notes

- `.env` is not committed. Copy `.env.example` if you want to override defaults;
  every value falls back to the bundled mock app, so it is optional.
- Tags: `@smoke` (release-blocking), `@regression`, `@api`, `@security`,
  `@cross-browser` — these drive what runs at each pipeline stage.
