type MonotonicClock = () => number;

const monotonicNow: MonotonicClock = () => performance.now();

/** Start a monotonic timer and return a function that reads its elapsed time. */
export function startElapsedTimer(now: MonotonicClock = monotonicNow): () => number {
    const startedAt = now();
    return () => now() - startedAt;
}
