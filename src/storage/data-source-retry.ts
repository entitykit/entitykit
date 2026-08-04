import type { DatabaseOperationOptions } from './database-connection';
import { OperationCanceledError } from '../errors/runtime-errors';
import { throwIfOperationAborted } from './operation-cancellation';
import { assertSynchronousCallbackResult } from '../synchronous-callback';

/** Bounded policy for retrying an entire caller-owned operation. */
export interface RetryPolicyOptions {
    /** The max attempts. */ readonly maxAttempts: number;
    /** The initial delay ms. */ readonly initialDelayMs?: number;
    /** The max delay ms. */ readonly maxDelayMs?: number;
    /** The backoff factor. */ readonly backoffFactor?: number;
    /** The jitter. */ readonly jitter?: boolean;
    /** The should retry. */ readonly shouldRetry?: (error: unknown) => boolean;
}

/** Options that configure retry execution. */ export interface RetryExecutionOptions extends DatabaseOperationOptions {
    /** Requests cancellation of retry attempts and backoff waits. */
    readonly signal?: AbortSignal;
}

/** Public contract for retry attempt. */ export interface RetryAttempt {
    /** The attempt. */ readonly attempt: number;
    /** The max attempts. */ readonly maxAttempts: number;
}

export interface ResolvedRetryPolicy {
    /** The max attempts. */ readonly maxAttempts: number;
    /** The initial delay ms. */ readonly initialDelayMs: number;
    /** The max delay ms. */ readonly maxDelayMs: number;
    /** The backoff factor. */ readonly backoffFactor: number;
    /** The jitter. */ readonly jitter: boolean;
    /** The should retry. */ readonly shouldRetry: (error: unknown) => boolean;
}

export function resolveRetryPolicy(
    configured: RetryPolicyOptions | undefined,
    providerClassifier: ((error: unknown) => boolean) | undefined,
): ResolvedRetryPolicy {
    const policy = configured ?? { maxAttempts: 1 };
    assertPositiveInteger('maxAttempts', policy.maxAttempts);
    const initialDelayMs = policy.initialDelayMs ?? 100;
    const maxDelayMs = policy.maxDelayMs ?? 5000;
    const backoffFactor = policy.backoffFactor ?? 2;
    assertNonNegativeInteger('initialDelayMs', initialDelayMs);
    assertNonNegativeInteger('maxDelayMs', maxDelayMs);
    if (!Number.isFinite(backoffFactor) || backoffFactor < 1) {
        throw new Error(`Retry backoffFactor must be at least 1, received ${String(backoffFactor)}.`);
    }
    if (maxDelayMs < initialDelayMs) {
        throw new Error('Retry maxDelayMs must be greater than or equal to initialDelayMs.');
    }
    if (policy.jitter !== undefined && typeof policy.jitter !== 'boolean') {
        throw new Error(
            `Retry jitter must be a boolean, received ${String(policy.jitter)}.`,
        );
    }
    if (policy.shouldRetry !== undefined && typeof policy.shouldRetry !== 'function') {
        throw new Error('Retry shouldRetry must be a function.');
    }
    return {
        maxAttempts: policy.maxAttempts,
        initialDelayMs,
        maxDelayMs,
        backoffFactor,
        jitter: policy.jitter ?? true,
        shouldRetry: policy.shouldRetry ?? providerClassifier ?? (() => false),
    };
}

export function retryDelayMs(policy: ResolvedRetryPolicy, failedAttempt: number): number {
    const exponential = Math.min(
        policy.maxDelayMs,
        policy.initialDelayMs * policy.backoffFactor ** (failedAttempt - 1),
    );
    return policy.jitter ? Math.floor(Math.random() * (exponential + 1)) : exponential;
}

export function evaluateRetryDecision(
    policy: ResolvedRetryPolicy,
    error: unknown,
): boolean {
    const decision: unknown = policy.shouldRetry(error);
    assertSynchronousCallbackResult(
        decision,
        'Retry shouldRetry callback',
        message => new TypeError(message),
    );
    if (typeof decision !== 'boolean') {
        throw new TypeError('Retry shouldRetry callback must return a boolean.');
    }
    return decision;
}

export async function abortableDelay(delayMs: number, signal?: AbortSignal): Promise<void> {
    throwIfOperationAborted(signal);
    if (delayMs === 0) {
        return;
    }
    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(done, delayMs);
        signal?.addEventListener('abort', aborted, { once: true });
        function cleanup(): void {
            clearTimeout(timer);
            signal?.removeEventListener('abort', aborted);
        }
        function done(): void {
            cleanup();
            resolve();
        }
        function aborted(): void {
            cleanup();
            reject(new OperationCanceledError(signal?.reason));
        }
    });
}

function assertPositiveInteger(name: string, value: number): void {
    if (!Number.isInteger(value) || value < 1) {
        throw new Error(`Retry ${name} must be a positive integer, received ${String(value)}.`);
    }
}

function assertNonNegativeInteger(name: string, value: number): void {
    if (!Number.isInteger(value) || value < 0) {
        throw new Error(`Retry ${name} must be a non-negative integer, received ${String(value)}.`);
    }
}
