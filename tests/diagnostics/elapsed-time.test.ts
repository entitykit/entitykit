import { startElapsedTimer } from '../../packages/core/src/diagnostics/runtime/elapsed-time';

describe('elapsed time', () => {
    it('measures from a monotonic clock', () => {
        const readings = [42, 49.5];
        const elapsed = startElapsedTimer(() => readings.shift() ?? Number.NaN);

        expect(elapsed()).toBe(7.5);
    });
});
