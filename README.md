# Code Your Future

Batch-based training platform. Parse Server 9.x + Angular 21 + PrimeNG + Tailwind CSS
monorepo, built on the 90soft full-stack template with AI-assisted code generation via
Claude Code.

- Authoritative product behaviour: [docs/PRODUCT_REQUIREMENTS.md](docs/PRODUCT_REQUIREMENTS.md)
- Architecture: [docs/TEMPLATE_ARCHITECTURE.md](docs/TEMPLATE_ARCHITECTURE.md)
- What is implemented today: [docs/CURRENT_STATE.md](docs/CURRENT_STATE.md)
- Delivery plan: [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md)

## What's Included

### Backend
- **Parse Server** with TypeScript decorator system (`@ParseClass`, `@ParseField`, `@CloudFunction`)
- **Admin authentication** — password login, session restoration, logout
- **Deny-by-default access** — explicit CLP on every class; a schema guard aborts startup
  if a class omits access metadata, and neutralises public-wildcard ACL fallbacks
- **Private file infrastructure** — `File` and `IMG` are server-controlled only; raw file
  routes are closed
- **Master key boundaries** — localhost-only by default, reserved for trusted startup work
- **Safe logging** — one recursive redaction boundary covering Parse Server's logs too
- **File handling** — auto WebP conversion, thumbnails, blurHash
- **LiveQuery** — real-time WebSocket subscriptions (no class enabled yet)
- **Swagger** — auto-generated API documentation
- **Cron** — scheduled jobs via `@Cron` decorator
- **Seed** — idempotently creates the `Admin` and `Student` roles and the Admin account
- **Tests** — `node:test`, no extra dependency

### Frontend
- **Angular 21** with signals, OnPush change detection, lazy-loaded routes
- **PrimeNG 21** component library + Tailwind CSS 4
- **Reusable data-table** — pagination, search, table/grid views, preview panel, Excel export
- **Multi-language** — English + Arabic with exact key parity and RTL/LTR auto-switching,
  initialised at bootstrap so unauthenticated screens render correctly
- **Dark/light theme** — persisted to localStorage
- **Auth guards** — role-set-aware route protection (`Admin` / `Student`)
- **Tests** — Vitest via the Angular unit-test builder

### AI Code Generation
Skills and agents ship through the **`90soft-toolkit`** plugin (see `CLAUDE.md`), not from
this repository.

## Start a New Project

### Option A: Standalone Script (Recommended)

Save `create-project.js` from this repo, then run it from any directory:

```bash
node create-project.js
```

It will ask for your project name, clone the template into a new folder with that name, configure everything, and install dependencies.

**Admin credential.** The generator has **no default Admin password** — a weak or
placeholder value aborts the run. Supply one of:

- `CYF_ADMIN_PASSWORD` in the environment (non-interactive), or
- the masked interactive prompt (input is not echoed).

Requirements: at least 12 characters, no surrounding whitespace, and not a
well-known placeholder. The password is written only to the generated
`backend/.env` (git-ignored) and is **never printed** — not to the console, not in
the completion summary, and not into any shell command. An existing
`backend/.env` is never overwritten; the generator stops instead.

### Option B: Manual Clone

```bash
# Clone into your project name
git clone https://git.90-soft.com/90_soft/fullstack-template.git my-project
cd my-project

# Disconnect from template, init fresh
git remote remove origin
git init

# Setup backend
cd backend && cp .env .env.backup && pnpm install && cd ..

# Setup frontend
cd frontend && pnpm install --shamefully-hoist && cd ..

# Run
pnpm run dev
```

### What the setup script does

- Asks for project name → clones template into that folder
- Generates secure random keys (masterKey, restAPIKey, javascriptKey)
- Creates `backend/.env` with your values
- Updates all config files (package.json, angular.json, environments, CI/CD)
- Disconnects from the template repo, initializes fresh git
- Installs all dependencies

Then:
```bash
cd your-project-name
npm run dev
```

### Prerequisites
- Node.js 20+
- pnpm 10.33.0 — pinned via `packageManager`, so Corepack selects it automatically
- MongoDB (local or Atlas)
- Claude Code CLI (for AI code generation)

## Project Structure

```
├── docs/                    # Product requirements, architecture, plan, state, handoff
├── backend/
│   ├── test/                # node:test suites
│   └── src/cloudCode/
│       ├── utils/           # auth, config, constants, dto, logging helpers
│       ├── database/        # seeding + legacy-role migration
│       ├── models/          # Parse models (@ParseClass)
│       └── modules/         # Cloud functions per entity
├── frontend/
│   └── src/app/
│       ├── components/      # Shared components (data-table, dialogs)
│       ├── pages/           # Route pages (auth, dashboard)
│       ├── services/        # API services, auth, theme, i18n
│       ├── models/          # TypeScript interfaces
│       └── config/          # Roles
├── CLAUDE.md                # AI workflow instructions
├── GENERATE.md              # Entity generation spec template
├── PROJECT.md               # Living project documentation
└── .gitlab-ci.yml           # CI/CD pipeline (build + deploy)
```

## Adding a New Entity

### Option A: With Claude Code (Recommended)
```
"Create Product with fields: name (String, required), price (Number), category (String), active (Boolean)"
```
Claude Code will generate all files (backend model + functions, frontend interface + service + pages + routes + nav + i18n).

### Option B: With GENERATE.md
1. Fill in `GENERATE.md` with your entity spec
2. Tell Claude Code: *"Generate from GENERATE.md"*

### Option C: Manually
- Backend: `models/{Name}.ts` + `modules/{Name}/functions.ts`
- Frontend: `models/{Name}.ts` + `services/dataService/{name}-service.ts` + `pages/{names}/`

Every new `@ParseClass` **must** declare an explicit `clp` — startup aborts otherwise, by
design (see `utils/config/schemaGuard.ts`).

## Configuration

### Backend (.env)
See `backend/.env.example` for all options with descriptions.

Additional environment variables read by the backend (none are secrets):

| Variable | Purpose | Default |
|---|---|---|
| `PORT` | HTTP port | `1337` |
| `NODE_ENV` | `production` enables the strict CORS rule below | unset (treated as development) |
| `CORS_ORIGINS` | **Comma-separated exact browser origins allowed to call the API.** Scheme, host, and port must match. | unset |
| `MASTER_KEY_IPS` | Comma-separated IPs/CIDRs allowed to use the master key | `127.0.0.1,::1` |
| `LOG_LEVEL` | `error`, `warn`, `info`, or `debug` | `info` |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` / `ADMIN_EMAIL` | Seeds the initial Admin account. **If `ADMIN_PASSWORD` is unset, seeding skips with a warning — no default password is ever invented.** | none |

#### CORS policy — fails closed

There is **no wildcard fallback on any code path**:

- `CORS_ORIGINS` set → exactly those origins are allowed, in development and production.
- Not set, and `NODE_ENV !== 'production'` → a narrow built-in localhost list
  (`http://localhost:4200`, `http://127.0.0.1:4200`, and the backend's own origin).
- Not set, **in production** → **nothing is allowed.** Every cross-origin browser
  request is refused and an error is logged at startup. Set `CORS_ORIGINS` before
  deploying.

Requests with no `Origin` header (server-to-server tools, health probes, curl)
continue to work — CORS is a browser mechanism and does not apply to them.
Credentials are explicitly disabled: this API authenticates with the
`X-Parse-Session-Token` header, not cookies. Methods and headers are explicit
allow-lists, never wildcards. No production domain is hardcoded anywhere.

### Frontend (environments)
- `frontend/src/environments/environment.ts` — local dev
- `frontend/src/environments/environment.prod.ts` — production

Both must have matching `parseAppId` and `parseApiKey` with the backend `.env`.

`parseApiKey` is the Parse **REST API key** — a *client* key, in the same family as
`javascriptKey`. Parse client keys identify the application; they do not authorise
anything. All authority comes from the session token plus live role membership on
top of deny-by-default CLP. It is therefore **public client configuration, not a
secret**, and is expected to ship in the browser bundle. The **Master Key** is a
different thing entirely: it lives only in `backend/.env`, is restricted to
localhost by default, and must never appear in frontend source. A test
(`security.credentials.spec.ts`) enforces that no master key, database URI, OAuth
client secret, or Admin password reaches the frontend.

### CI/CD (.gitlab-ci.yml)
Set these variables in GitLab → Settings → CI/CD → Variables:

| Variable | Type | Description |
|---|---|---|
| `SSH_PRIVATE_KEY` | File | SSH key for deployment server |
| `STAGING_SERVER_IP` | Variable | Server IP address |
| `STAGING_SERVER_USER` | Variable | SSH username (e.g., `root`) |
| `COMPOSE_DIR` | Variable | Docker compose directory on server |
| `BACKEND_DEPLOY_DIR` | Variable | Backend code directory on server |
| `BACKEND_CONTAINER` | Variable | Docker container name |
| `FRONTEND_BUILD_NAME` | Variable | Angular project name (from angular.json) |
| `FRONTEND_DEPLOY_DIR` | Variable | Frontend static files directory on server |

## Deployment

The CI/CD pipeline runs on push to `dev` branch:
1. **Build backend** — compiles TypeScript
2. **Build frontend** — `ng build --production` with auto-incrementing version
3. **Deploy backend** — rsync to server, Docker rebuild if package.json changed
4. **Deploy frontend** — rsync static files to web server directory

## Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Backend | Parse Server | 9.x |
| Backend | Express | 5.x |
| Backend | TypeScript | 5.x |
| Database | MongoDB | 7.x |
| Frontend | Angular | 21 |
| Frontend | PrimeNG | 21 |
| Frontend | Tailwind CSS | 4 |
| AI | Claude Code | Skills + Agents |
