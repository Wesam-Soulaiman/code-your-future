# Frontend Conventions

Angular 21 + PrimeNG + Tailwind CSS. Signals-first, OnPush change detection.

## Type Safety

- NEVER use `any` — all signals, parameters, and return types MUST have proper types
- Frontend interfaces live in `app/models/{ModelName}.ts`
- `ParseDate` type: `string | { __type: string; iso: string }` — Parse Server Date fields can return either format
- Service methods MUST have typed return values (e.g., `Observable<Order>`, not `Observable<any>`)

## Status & Role Constants

For entities with status workflows, create a constants file in `app/utils/` and NEVER hardcode status/role codes as string literals.

```ts
// Example: app/utils/order-constants.ts
export enum OrderStatusCode {
  PENDING = '1',
  APPROVED = '2',
  SHIPPED = '3',
}

// Usage in components:
import { OrderStatusCode } from '../../utils/order-constants';
if (code === OrderStatusCode.PENDING) { ... }
```

## Result Mapping

The HTTP interceptor (or ApiService) unwraps Parse Server's `{result: ...}` wrapper automatically. NEVER use `.pipe(map(res => res.result))` in service methods. Type the Observable with the actual return type directly:

```ts
// GOOD
getOrders(): Observable<Order[]> { ... }

// BAD
getOrders(): Observable<{result: Order[]}> { ... }
```

## LiveQuery (WebSocket)

- Service: `app/services/live-query.service.ts` — singleton, manages WebSocket connection
- MUST send `sessionToken` in both `connect` and `subscribe` messages
- Components subscribe via `liveQueryService.subscribe(className, where)` and unsubscribe on destroy
- Use `merge()` + `debounceTime()` to batch multiple LiveQuery events into a single reload

## Component Patterns

- MUST use `ChangeDetectionStrategy.OnPush` on all components
- MUST use `signal()` for component state — type every signal (e.g., `signal<Order | null>(null)`)
- MUST use `inject()` for dependency injection — no constructor injection
- Use `takeUntilDestroyed(destroyRef)` for subscription cleanup in components
- Root singleton services (`providedIn: 'root'`) with one-shot HTTP calls don't need cleanup

## File Structure

- Models: `app/models/{ModelName}.ts`
- Services: `app/services/dataService/{model}-service.ts`
- Pages: `app/pages/{feature}/{feature}.component.ts`
- Shared: `app/components/shared/`
- Utils: `app/utils/`
- i18n: `public/i18n/{lang}.json`

## Multi-Language

- English and Arabic supported (RTL/LTR auto-switching)
- All UI strings use translation keys via `@ngx-translate`
- i18n files: `public/i18n/en.json` and `public/i18n/ar.json`
