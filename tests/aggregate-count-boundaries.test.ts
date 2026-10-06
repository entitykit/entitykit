import { createDb } from './aggregate-query-model/support';
import { createDb as createJoinedDb } from './joined-projection/support';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

const safe: ReadonlyArray<readonly [unknown, number]> = [
    [0, 0], ['0', 0], [0n, 0], [null, 0], [undefined, 0],
    [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
    [String(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER],
    [BigInt(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER],
];
const invalid: ReadonlyArray<readonly [unknown, typeof Error]> = [
    ['9007199254740993', RangeError], [9007199254740992n, RangeError],
    [9007199254740992, RangeError], [-1, RangeError], [-1n, RangeError], [1.5, RangeError],
    ['-1', TypeError], ['1.5', TypeError], ['', TypeError], ['bad', TypeError],
    ['1e3', TypeError], [NaN, RangeError], [Infinity, RangeError], [true, TypeError],
];

describe('aggregate count numeric boundaries', () => {
    it.each(safe)('accepts safe or empty provider count %p', async (value, expected) => {
        const connection = new RecordingDatabaseConnection();
        const db = createDb(connection);
        connection.queueResult({ rows: [{ total: value }] });
        try {
            await expect(db.orders.aggregate(aggregate => ({ total: aggregate.count() })).single())
                .resolves.toEqual({ total: expected });
        } finally {
            await db.dispose();
        }
    });

    it.each(invalid)('rejects invalid provider count %p', async (value, error) => {
        const connection = new RecordingDatabaseConnection();
        const db = createDb(connection);
        connection.queueResult({ rows: [{ total: value }] });
        try {
            await expect(db.orders.aggregate(aggregate => ({ total: aggregate.count() })).single()).rejects.toBeInstanceOf(error);
            expect(db.changeTracker.entries()).toHaveLength(0);
        } finally {
            await db.dispose();
        }
    });

    it.each(['grouped', 'joined', 'grouped-joined'] as const)('rejects an oversized %s count', async kind => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rows: [{ category: 'active', total: '9007199254740993' }] });
        if (kind === 'grouped') {
            const db = createDb(connection);
            try {
                await expect(db.orders.groupBy(order => ({ category: order.customerEmail }))
                    .select(group => ({ category: group.key.category, total: group.count() })).toArray())
                    .rejects.toBeInstanceOf(RangeError);
            } finally {
                await db.dispose();
            }
        } else {
            const db = createJoinedDb(connection);
            try {
                const joined = db.posts.join('author', db.authors, ({ root, author }) => root.authorId.eq(author.id));
                const query = kind === 'joined'
                    ? joined.aggregate(aggregate => ({ total: aggregate.count(({ author }) => author.id) }))
                    : joined.groupBy(({ author }) => ({ category: author.status }))
                        .select(group => ({ category: group.key.category, total: group.count() }));
                await expect(query.toArray()).rejects.toBeInstanceOf(RangeError);
            } finally {
                await db.dispose();
            }
        }
    });
});
