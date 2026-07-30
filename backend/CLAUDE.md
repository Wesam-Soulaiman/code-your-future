# Backend Conventions

Parse Server 9.9.0 + Express 5 + TypeScript. MongoDB database.

## Toolkit Package (@90soft/parse-server-kit)

Cloud Code is built on the `@90soft/parse-server-kit` package. ALL decorators, helpers, and constants are imported from it — NEVER from local `decorator/` or `utils/helper`/`utils/constants` paths (those were removed in the migration).

- Decorators: `ParseClass`, `ParseField`, `CloudFunction`, `Route`, trigger decorators (`BeforeSave`, `AfterSave`, …), `Cron`
- Base model: `BaseModel`
- Local utils that remain (import from `../../utils/...`): `handleImage` (`handleImageLogic`, `handleImageArrayLogic`), `handleFile`, `imageProcessing`, `fileAdapter`, `sharedGetFields`, `config/parseConfig`

```ts
import {ParseClass, ParseField, BaseModel} from '@90soft/parse-server-kit';
import {CloudFunction, Route, catchError, UserRoles, getUserRoles} from '@90soft/parse-server-kit';
```

## Error Handling

- MUST use `catchError()` from `@90soft/parse-server-kit` for ALL async operations
- NEVER use `try/catch` with `await` — the only exceptions are:
  - Synchronous code (e.g., `JSON.parse`, `Buffer` ops)
  - Whole-function error boundaries that must never throw (e.g., notification dispatchers)
- Pattern:
```ts
const [err, result] = await catchError(asyncOperation());
if (err) { throw new Parse.Error(...); }
```

## Helpers (from @90soft/parse-server-kit)

- `catchError<T>(promise)` — wraps async in `[error, result]` tuple
- `getUserRoles(user)` — get role names for a single user (1 query)
- `getUsersRoles(users)` — batch-load roles for multiple users (avoids N+1)
- `generateRandomString(len)`, `generateRandomPassword(len)`

## Constants (from @90soft/parse-server-kit)

- `UserRoles` enum — MUST import, NEVER hardcode role strings. Members: `UserRoles.ADMIN` (`'SuperAdmin'`), `UserRoles.EMPLOYEE` (`'Employee'`)
- `MAX_QUERY_LIMIT` (10000) — MUST use for all `.limit()` calls on unbounded queries

## Parse Server 9.9.0 Notes

- `protectedFieldsTriggerExempt: true` — Cloud Code triggers can access protected fields
- `requestComplexity.batchRequestLimit: 50` — caps batch sub-requests
- `User.logInWith()` MUST use `useMasterKey: true` — 9.6.0+ enforces Create CLP on auth signup

## LiveQuery

- Configure which classes support LiveQuery in `parseConfig.ts` under `liveQuery.classNames`
- Each LiveQuery class needs a `beforeSubscribe` hook in `main.ts` (see commented example)
- CLP should include `requiresAuthentication: true` on `find`/`get` for LiveQuery classes
- `beforeSubscribe` hooks allow any authenticated user, reject unauthenticated
- This bypasses Parse Server 9.9.0's broken role resolution in LiveQuery CLP enforcement
- Object-level ACL still controls which records each user receives
- Frontend sends `sessionToken` in both `connect` and `subscribe` WebSocket messages
- NEVER rely on role-based CLP alone for LiveQuery — always use `beforeSubscribe` + ACL

## ACL System

ACL patterns for your project:

- **Owner-only**: Only the creating user can read/write
- **Role-based**: Use Parse Roles to grant read/write to groups
- **Mixed**: Owner has write, role has read

Define CLP and the default object `ACL` declaratively in the `@ParseClass({ clp, ACL })` decorator (see `models/Employee.ts`). For dynamic per-record ACL, use `implementACL()` from `@90soft/parse-server-kit` inside the cloud function, or a `beforeSave` trigger when ACL must be set on every save path.

## File Structure

- Models: `backend/src/cloudCode/models/{ModelName}.ts`
- Functions: `backend/src/cloudCode/modules/{ModelName}/functions.ts`
- Config: `backend/src/cloudCode/utils/config/parseConfig.ts`
- Seed data: `backend/src/cloudCode/database/seed.ts`
- Auto-loaded via dynamic imports — NEVER create or update index files

## Result Mapping

Parse Server REST API wraps cloud function responses in `{result: ...}`. The frontend HTTP interceptor unwraps this automatically. Backend cloud functions MUST return the actual data directly — no wrapping needed.
