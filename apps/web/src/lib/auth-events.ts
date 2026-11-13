/**
 * Cross-Tab Authentication Synchronization
 *
 * Uses BroadcastChannel to instantly synchronize session invalidation / logout
 * across multiple open browser tabs without polling or reload loops.
 */

export type AuthEvent =
  | { type: 'LOGOUT'; role?: string }
  | { type: 'SESSION_EXPIRED'; role?: string }
  | { type: 'LOGIN'; role: string }
  | { type: 'SESSION_REFRESHED'; role: string; user?: unknown }
  | { type: 'VENDOR_FOLLOW_CHANGED'; userId: string; vendorId: string; vendorSlug: string; following: boolean };

type AuthEventListener = (event: AuthEvent) => void;

class AuthBroadcastManager {
  private channel: BroadcastChannel | null = null;
  private listeners = new Set<AuthEventListener>();

  constructor() {
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      try {
        this.channel = new BroadcastChannel('nuts_auth_bus');
        this.channel.onmessage = (messageEvent) => {
          if (messageEvent?.data?.type) {
            this.notifyListeners(messageEvent.data as AuthEvent);
          }
        };
      } catch {
        this.channel = null;
      }
    }
  }

  public broadcast(event: AuthEvent): void {
    if (this.channel) {
      try {
        this.channel.postMessage(event);
      } catch {
        // Fallback or ignore
      }
    }
  }

  public publish(event: AuthEvent): void {
    this.broadcast(event);
    this.notifyListeners(event);
  }

  public subscribe(listener: AuthEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(event: AuthEvent): void {
    this.listeners.forEach((listener) => {
      try {
        listener(event);
      } catch {
        // Ignore listener error
      }
    });
  }
}

export const authBroadcast = new AuthBroadcastManager();
