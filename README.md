# Fullstack Template

Parse Server 9.9.0 + Angular 21 + PrimeNG + Tailwind CSS monorepo with AI-assisted code generation via Claude Code.

## What's Included

### Backend
- **Parse Server** with TypeScript decorator system (`@ParseClass`, `@ParseField`, `@CloudFunction`)
- **Authentication** — username/password login
- **User management** — CRUD, role assignment
- **File handling** — auto WebP conversion, thumbnails, blurHash
- **LiveQuery** — real-time WebSocket subscriptions
- **Swagger** — auto-generated API documentation
- **Cron** — scheduled jobs via `@Cron` decorator
- **Seed** — auto-creates roles and admin user on first start

### Frontend
- **Angular 21** with signals, OnPush change detection, lazy-loaded routes
- **PrimeNG 21** component library + Tailwind CSS 4
- **Reusable data-table** — pagination, search, table/grid views, preview panel, Excel export
- **Multi-language** — English + Arabic with RTL/LTR auto-switching
- **Dark/light theme** — persisted to localStorage
- **Auth guards** — role-based route protection
- **Global search** — config-driven search across entities

### AI Code Generation
- **7 Skills** in `.claude/skills/` — coding rules and templates for backend, frontend, forms, UI, naming, workflow
- **6 Agents** in `.claude/agents/` — orchestrator, backend-engineer, frontend-engineer, api-architect, code-reviewer, testing-subagent
- Tell Claude Code: *"Create Employee with fields: name, email, department"* and it generates the full stack

## Start a New Project

### Option A: Standalone Script (Recommended)

Save `create-project.js` from this repo, then run it from any directory:

```bash
node create-project.js
```

It will ask for your project name, clone the template into a new folder with that name, configure everything, and install dependencies.

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
- Optionally removes the Employee example entity
- Disconnects from the template repo, initializes fresh git
- Installs all dependencies

Then:
```bash
cd your-project-name
npm run dev
```

### Prerequisites
- Node.js 20+
- pnpm (`npm install -g pnpm`)
- MongoDB (local or Atlas)
- Claude Code CLI (for AI code generation)

## Project Structure

```
├── .claude/
│   ├── agents/              # AI agent definitions
│   └── skills/              # AI skill rules + code templates
├── backend/
│   └── src/cloudCode/
│       ├── decorator/       # Core decorator system (DO NOT MODIFY)
│       ├── utils/           # Helpers, ACL, middleware (DO NOT MODIFY)
│       ├── database/        # Schema, seed, indexes
│       ├── models/          # Parse models (@ParseClass)
│       ├── modules/         # Cloud functions per entity
│       └── swagger/         # Auto-generated API docs
├── frontend/
│   └── src/app/
│       ├── components/      # Shared components (data-table, dialogs)
│       ├── pages/           # Route pages (auth, dashboard, users, ...)
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
Follow the Employee example entity as a reference:
- Backend: `models/Employee.ts` + `modules/Employee/functions.ts`
- Frontend: `models/Employee.ts` + `services/dataService/employee-service.ts` + `pages/employees/`

## Configuration

### Backend (.env)
See `backend/.env.example` for all options with descriptions.

### Frontend (environments)
- `frontend/src/environments/environment.ts` — local dev
- `frontend/src/environments/environment.prod.ts` — production

Both must have matching `parseAppId` and `parseApiKey` with the backend `.env`.

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
| Backend | Parse Server | 9.9.0 |
| Backend | Express | 5.x |
| Backend | TypeScript | 5.x |
| Database | MongoDB | 7.x |
| Frontend | Angular | 21 |
| Frontend | PrimeNG | 21 |
| Frontend | Tailwind CSS | 4 |
| AI | Claude Code | Skills + Agents |
