import { EventEmitter } from 'node:events';
import { retainPostgresClient } from '../packages/postgres/src/postgres-client-lease';
import type { PoolClient } from '../packages/postgres/src/postgres-driver-contract';

function fixture(): { raw: EventEmitter & { query: jest.Mock; release: jest.Mock }; lease: PoolClient } {
    const raw = Object.assign(new EventEmitter(), {
        query: jest.fn(async () => await Promise.resolve({ rows: [{ answer: 42 }], rowCount: 1 })),
        release: jest.fn(),
    });
    return { raw, lease: retainPostgresClient(raw as PoolClient) };
}

describe('checked-out Postgres client error ownership', () => {
    it('owns asynchronous driver errors and refuses subsequent SQL on the failed client', async () => {
        const { raw, lease } = fixture();
        const disconnected = new Error('connection terminated unexpectedly');
        expect(() => raw.emit('error', disconnected)).not.toThrow();
        await expect(lease.query('commit')).rejects.toBe(disconnected);
        expect(raw.query).not.toHaveBeenCalled();
        lease.release();
        expect(raw.release).toHaveBeenCalledWith(disconnected);
        expect(raw.listenerCount('error')).toBe(0);
    });

    it('preserves the first driver failure and forces removal even if release requests reuse', () => {
        const { raw, lease } = fixture();
        const first = new Error('first disconnect');
        raw.emit('error', first);
        raw.emit('error', new Error('secondary failure'));
        lease.release(false);
        expect(raw.release).toHaveBeenCalledWith(first);
    });

    it('passes normal queries through and hands error ownership back before removing its listener', async () => {
        const { raw, lease } = fixture();
        expect(await lease.query('select $1 as answer', [42])).toEqual({ rows: [{ answer: 42 }], rowCount: 1 });
        expect(raw.query).toHaveBeenCalledWith('select $1 as answer', [42]);
        const idleObserver = jest.fn();
        raw.release.mockImplementation(() => {
            expect(raw.listenerCount('error')).toBe(1);
            raw.on('error', idleObserver);
        });
        lease.release();
        expect(raw.listenerCount('error')).toBe(1);
        raw.emit('error', new Error('later idle error'));
        expect(idleObserver).toHaveBeenCalledTimes(1);
    });

    it('does not poison a connection for ordinary SQL errors', async () => {
        const { raw, lease } = fixture();
        raw.query.mockRejectedValueOnce(new Error('unique constraint'));
        await expect(lease.query('insert')).rejects.toThrow('unique constraint');
        await expect(lease.query('select')).resolves.toHaveProperty('rowCount', 1);
        lease.release();
        expect(raw.release).toHaveBeenCalledWith(undefined);
    });

    it('prevents reuse and double release of the lease', async () => {
        const { raw, lease } = fixture();
        lease.release(true);
        expect(raw.release).toHaveBeenCalledWith(true);
        await expect(lease.query('select')).rejects.toThrow('was released');
        expect(() => {
            lease.release(); 
        }).toThrow('more than once');
        expect(raw.release).toHaveBeenCalledTimes(1);
    });

    it('removes its listener even when driver release fails', () => {
        const { raw, lease } = fixture();
        raw.release.mockImplementation(() => {
            throw new Error('release failed');
        });
        expect(() => {
            lease.release(); 
        }).toThrow('release failed');
        expect(raw.listenerCount('error')).toBe(0);
    });

    it('does not accumulate listeners across leases of the same physical client', () => {
        const raw = fixture().raw;
        raw.removeAllListeners('error');
        for (let index = 0; index < 100; index += 1) {
            const lease = retainPostgresClient(raw as PoolClient);
            expect(raw.listenerCount('error')).toBe(1);
            lease.release();
            expect(raw.listenerCount('error')).toBe(0);
        }
    });
});
