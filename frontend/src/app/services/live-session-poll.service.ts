import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { Observable, Subscription, timer } from 'rxjs';

import {
  LIVE_FAILURES_BEFORE_DISCONNECTED,
  LIVE_POLL_MS,
} from '../utils/live-slides-constants';

/** What the page tells the person about its link to the server. */
export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'lost';

/**
 * Keeping a live page in step with the server ⟨CP6⟩.
 *
 * ── Why this is a poll and not a socket ─────────────────────────────────────
 * This repository has a `LiveQueryService`, and it was evaluated first. It is
 * not usable here, for a reason that is about the data rather than the
 * transport:
 *
 *   - it is **dormant** — `liveQuery.classNames` in `parseConfig.ts` is empty,
 *     so no class is published today;
 *   - enabling one would mean relaxing that class's CLP from deny-all to
 *     `requiresAuthentication`, which is exactly the weakening this checkpoint
 *     forbids;
 *   - and LiveQuery delivers **raw Parse objects**. Every subscriber to
 *     `LiveResponse` would receive every `textAnswer` in the room, including
 *     other Students'. There is no server-side transform in the protocol to
 *     prevent it.
 *
 * So the update channel is an authenticated poll of one authoritative endpoint
 * that returns a **sanitized DTO** chosen for the caller's role. Every event the
 * checkpoint asks for — session started, slide changed, question locked,
 * response submitted, session completed, connection lost and restored — is a
 * change in that answer, and each arrives within one interval.
 *
 * ── Reconnecting needs no special path ──────────────────────────────────────
 * Because every tick fetches the whole authoritative state, recovery is simply
 * the next successful tick. There is no replay, no event backlog, no duplicate
 * submission, and no page refresh: a Student whose wifi dropped for a minute
 * gets the current slide and their own submission state, correct, on the next
 * response.
 *
 * ── What it costs ──────────────────────────────────────────────────────────
 * A slide change is visible within `LIVE_POLL_MS` rather than instantly. For
 * people sitting in the same room as the screen, that is not a meaningful
 * difference — and it is the honest trade for not shipping a channel that could
 * leak an answer.
 */
@Injectable()
export class LiveSessionPollService {
  private destroyRef = inject(DestroyRef);
  private subscription: Subscription | null = null;
  private failures = 0;

  /** What to show in the connection indicator. */
  readonly connection = signal<ConnectionState>('connecting');

  constructor() {
    // Belt and braces: a component that forgets to stop the poll still stops it
    // when it is destroyed, so a closed tab is not still asking.
    this.destroyRef.onDestroy(() => this.stop());
  }

  /**
   * Poll `fetch` until stopped.
   *
   * Runs immediately and then every `LIVE_POLL_MS`. A tick that is still in
   * flight is never overlapped: `timer` is resubscribed only after the previous
   * request settles, so a slow network produces a slower poll rather than a
   * queue of pending requests.
   */
  start<T>(fetch: () => Observable<T>, onState: (state: T) => void): void {
    this.stop();
    this.failures = 0;
    this.connection.set('connecting');

    const tick = (delay: number): void => {
      this.subscription = timer(delay).subscribe(() => {
        fetch().subscribe({
          next: (state) => {
            this.failures = 0;
            this.connection.set('connected');
            onState(state);
            tick(LIVE_POLL_MS);
          },
          error: () => {
            this.failures += 1;
            // One failure is a dropped packet; saying so would make the banner
            // flicker through a normal lecture. Two in a row is a real problem.
            this.connection.set(
              this.failures >= LIVE_FAILURES_BEFORE_DISCONNECTED ? 'lost' : 'reconnecting',
            );
            // Keep trying. The room's wifi comes back, and when it does the
            // next successful tick restores the whole authoritative state.
            tick(LIVE_POLL_MS);
          },
        });
      });
    };

    tick(0);
  }

  /** Stop polling. Called on destroy, on route change, and when a session ends. */
  stop(): void {
    this.subscription?.unsubscribe();
    this.subscription = null;
  }

  /** True when the page is not currently in touch with the server. */
  get offline(): boolean {
    const state = this.connection();
    return state === 'lost' || state === 'reconnecting';
  }
}
