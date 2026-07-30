import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { environment } from '../../environments/environment';

export interface LiveQueryEvent {
  op: 'create' | 'update' | 'delete' | 'enter' | 'leave';
  object: any;
}

interface LQSubscription {
  requestId: number;
  subject: Subject<LiveQueryEvent>;
  className: string;
  where: Record<string, unknown>;
}

@Injectable({ providedIn: 'root' })
export class LiveQueryService {
  private ws: WebSocket | null = null;
  private subscriptions = new Map<number, LQSubscription>();
  private pendingSubscriptions: LQSubscription[] = [];
  private nextRequestId = 1;
  private connected = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;

  subscribe(
    className: string,
    where: Record<string, unknown> = {},
  ): { events$: Observable<LiveQueryEvent>; requestId: number } {
    const requestId = this.nextRequestId++;
    const subject = new Subject<LiveQueryEvent>();
    const sub: LQSubscription = { requestId, subject, className, where };
    this.subscriptions.set(requestId, sub);

    if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
      this.sendSubscribe(sub);
    } else {
      this.pendingSubscriptions.push(sub);
      if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
        this.connect();
      }
    }

    return { events$: subject.asObservable(), requestId };
  }

  unsubscribe(requestId: number): void {
    const sub = this.subscriptions.get(requestId);
    if (!sub) return;

    sub.subject.complete();
    this.subscriptions.delete(requestId);

    if (this.ws?.readyState === WebSocket.OPEN && this.connected) {
      this.ws.send(JSON.stringify({ op: 'unsubscribe', requestId }));
    }

    this.pendingSubscriptions = this.pendingSubscriptions.filter(
      (s) => s.requestId !== requestId,
    );

    if (this.subscriptions.size === 0) {
      this.disconnect();
    }
  }

  private connect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.intentionalClose = false;
    this.ws = new WebSocket(environment.wsUrl);

    this.ws.onopen = () => {
      const sessionToken = localStorage.getItem('sessionToken');
      this.ws!.send(
        JSON.stringify({
          op: 'connect',
          applicationId: environment.parseAppId,
          ...(sessionToken ? { sessionToken } : {}),
        }),
      );
    };

    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      switch (data.op) {
        case 'connected':
          this.connected = true;
          for (const sub of this.pendingSubscriptions) {
            this.sendSubscribe(sub);
          }
          this.pendingSubscriptions = [];
          break;

        case 'create':
        case 'update':
        case 'delete':
        case 'enter':
        case 'leave': {
          const sub = this.subscriptions.get(data.requestId);
          if (sub) {
            sub.subject.next({ op: data.op, object: data.object });
          }
          break;
        }

        case 'error':
          console.error('[LiveQuery] Error:', data);
          break;
      }
    };

    this.ws.onclose = () => {
      this.connected = false;
      // Only reconnect if close was not intentional and there are active subscriptions
      if (!this.intentionalClose && this.subscriptions.size > 0) {
        this.pendingSubscriptions = [...this.subscriptions.values()];
        this.reconnectTimer = setTimeout(() => this.connect(), 3000);
      }
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  private disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.intentionalClose = true;
    this.connected = false;
    this.ws?.close();
    this.ws = null;
  }

  private sendSubscribe(sub: LQSubscription): void {
    const sessionToken = localStorage.getItem('sessionToken');
    this.ws?.send(
      JSON.stringify({
        op: 'subscribe',
        requestId: sub.requestId,
        query: { className: sub.className, where: sub.where },
        ...(sessionToken ? { sessionToken } : {}),
      }),
    );
  }
}
