declare module 'redlock' {
  export class Lock {
    readonly resources: string[];
    readonly expiration: number;
    extend(ttl: number): Promise<Lock>;
    release(): Promise<void>;
  }

  export class RedlockAbortSignal extends AbortSignal {}

  export interface RedlockOptions {
    driftFactor?: number;
    retryCount?: number;
    retryDelay?: number;
    retryJitter?: number;
    automaticExtensionThreshold?: number;
  }

  export default class Redlock {
    constructor(clients: unknown[], options?: RedlockOptions);
    acquire(resources: string[], ttl: number): Promise<Lock>;
    using<T>(
      resources: string[],
      ttl: number,
      routine: (signal: RedlockAbortSignal) => Promise<T>,
    ): Promise<T>;
    on(event: string, listener: (error: unknown) => void): this;
  }
}
