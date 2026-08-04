import { assertSynchronousCallbackResult } from '../src/synchronous-callback';

describe('synchronous callback contract', () => {
    const createError = (message: string): Error => new Error(message);

    it('allows undefined and fluent return values', () => {
        expect(() => {
            assertSynchronousCallbackResult(undefined, 'Configuration', createError);
            assertSynchronousCallbackResult({ fluent: true }, 'Configuration', createError);
        }).not.toThrow();
    });

    it('rejects native promises with a focused error', () => {
        expect(() => {
            assertSynchronousCallbackResult(
                Promise.resolve(),
                'Configuration',
                createError,
            );
        }).toThrow(
            'Configuration must be synchronous and must not return a Promise.',
        );
    });

    it('detects custom thenables', () => {
        const thenable = { then: (): void => {
            // The guard must use shape, not native Promise identity.
        } };

        expect(() => {
            assertSynchronousCallbackResult(
                thenable,
                'Configuration',
                createError,
            );
        }).toThrow('must be synchronous');
    });

    it('consumes a rejected promise after reporting the contract error', async () => {
        const unhandled: unknown[] = [];
        const observeUnhandled = (reason: unknown): void => {
            unhandled.push(reason);
        };
        process.on('unhandledRejection', observeUnhandled);
        try {
            expect(() => {
                assertSynchronousCallbackResult(
                    Promise.reject(new Error('callback failed')),
                    'Configuration',
                    createError,
                );
            }).toThrow('must be synchronous');
            await new Promise<void>(resolve => setImmediate(resolve));

            expect(unhandled).toEqual([]);
        } finally {
            process.off('unhandledRejection', observeUnhandled);
        }
    });
});
