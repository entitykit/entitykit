import { join } from 'node:path';
import { SqliteReusableConnectionSource } from '../packages/sqlite/src/sqlite-reusable-connection-source';
import { createManagedTempDirectory } from './support/managed-temp-directory';

describe('SQLite provider lease lifetime', () => {
    it('refuses stale lease operations after the native handle has another owner', async () => {
        const source = new SqliteReusableConnectionSource(
            join(createManagedTempDirectory('entitykit-lease-'), 'app.db'), 1,
        );
        const first = source.createConnection();
        const deferred = first.stream?.({ text: 'select 1 as value', values: [] });
        if (!deferred) throw new Error('SQLite stream missing');
        await expect(source.dispose()).rejects.toThrow('active leases');
        await first.dispose?.();
        await first.dispose?.();
        const second = source.createConnection();
        try {
            await second.transaction(async () => {
                expect(second.isInTransaction).toBe(true);
                expect(first.isInTransaction).toBe(false);
                await expect(first.query({ text: 'select 1', values: [] })).rejects.toThrow('lease was disposed');
                await expect(deferred[Symbol.asyncIterator]().next()).rejects.toThrow('lease was disposed');
                const work = jest.fn(() => 1);
                await expect(first.transaction(work)).rejects.toThrow('lease was disposed');
                await expect(first.session?.(work)).rejects.toThrow('lease was disposed');
                expect(work).not.toHaveBeenCalled();
                await expect(source.dispose()).rejects.toThrow('active leases');
            });
        } finally {
            await second.dispose?.();
            await source.dispose();
        }
        await source.dispose();
        expect(() => source.createConnection()).toThrow('source was disposed');
    });
});
