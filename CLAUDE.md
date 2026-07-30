# Claude Code Instructions

Parse Server 9.9.0 backend + Angular 21 frontend monorepo.

## Per-Directory Conventions

- `backend/CLAUDE.md` — Backend conventions (Parse Server, error handling, auth, ACL, business rules)
- `frontend/CLAUDE.md` — Frontend conventions (Angular, type safety, constants, component patterns)

## Skills & Agents — delivered via plugin

Skills and agents are NOT stored in this repo. They ship through the **`90soft-toolkit`** plugin from the **`90soft`** marketplace (`http://git.90-soft.com/90_soft/claude-plugins-90soft.git`), declared in `.claude/settings.json` (`extraKnownMarketplaces` + `enabledPlugins` + `autoUpdate`).

**One-time install per machine** (registration alone does NOT install):
```
claude plugin marketplace add http://git.90-soft.com/90_soft/claude-plugins-90soft.git
claude plugin install 90soft-toolkit@90soft
```
After that, `autoUpdate` applies new versions on Claude Code restart.

To change a skill or agent, edit it in the **plugin repo**, bump the `version`, and push — do NOT recreate local `.claude/skills/` or `.claude/agents/` here.

## Skills

The plugin provides 7 skills, auto-discovered by Claude Code. Each has a `SKILL.md` with rules and a `resources/` folder with code examples.

**NEVER modify skills — they live in the `90soft-toolkit` plugin.**

## Agents

The plugin provides specialized subagents for the entity generation workflow.

| Agent | Role |
|---|---|
| `orchestrator` | Routes tasks, owns 6-step workflow, NEVER writes code |
| `backend-engineer` | Writes backend model + cloud functions (2 files) |
| `frontend-engineer` | Writes frontend interface + service + pages (6 new + 4 modified) |
| `api-architect` | Designs API contracts, verifies backend-frontend alignment |
| `code-reviewer` | Validates generated code against all MUST/NEVER rules |
| `testing-subagent` | Writes/runs tests after generation (parked — Vitest setup pending) |

**NEVER modify agents — they live in the `90soft-toolkit` plugin.**

## Workflow

For entity generation tasks, MUST follow this order:

1. **Review** — Explore agent scans codebase for conflicts
2. **Ask** — Orchestrator gathers requirements from user (main thread)
3. **Contract** — api-architect designs API contract
4. **Generate** — backend-engineer + frontend-engineer run in parallel
5. **Validate** — code-reviewer checks all rules
6. **Document** — Orchestrator updates PROJECT.md

NEVER skip step 5 for generation types 1-4.
Exception: small changes (<4 files) handled in main thread skip steps 3 and 5.

> Testing (testing-subagent) is currently parked — NOT part of the mandatory flow. Re-enable once the Vitest test setup is wired.

## Quick Commands

- "Create [Entity] with fields..." → orchestrator, Type 1
- "Generate from GENERATE.md" → orchestrator, read spec, Type 1
- "Add [field] to [Entity]" → orchestrator, Type 2
- "Add [relation] to [Entity]" → orchestrator, Type 3
- "Review [Entity]" → code-reviewer directly
- "Test [Entity]" → testing-subagent directly

## Key Files

- `PROJECT.md` — Living business document. MUST update after every code change. Current state only — NEVER add changelog.
- `GENERATE.md` — Entity spec template. Read when user says "generate from GENERATE.md".

## Protected Files — NEVER Modify

### Backend
- `backend/src/cloudCode/utils/`
- `backend/src/cloudCode/database/`
- `backend/src/cloudCode/models/User.ts`
- `backend/src/cloudCode/models/IMG.ts`
- `backend/src/cloudCode/models/File.ts`
- `backend/src/cloudCode/modules/User/`

### Config
- `.claude/settings.json` — plugin auto-enrollment (marketplace + enabled plugins); change only to manage the `90soft-toolkit` rollout
- Skills & agents — managed in the `90soft-toolkit` plugin repo, NOT here
