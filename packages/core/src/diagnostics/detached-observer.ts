import { isPromiseLike } from '../promise-like';

/** Invoke an observer without allowing synchronous or asynchronous failure to escape. */
export function invokeDetachedObserver(observer: () => unknown): void {
    try {
        const result = observer();
        if (isPromiseLike(result)) {
            void Promise.resolve(result).catch(() => undefined);
        }
    } catch {
        // Detached observers cannot participate in the work they observe.
    }
}
