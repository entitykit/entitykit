import { DbContext, type EntityKitDataSource, type ModelBuilder } from '../../packages/core/src';
import { createSqliteDataSource } from '../../packages/sqlite/src';
import { createPostgresDataSource } from '../../packages/postgres/src';
import { createMySqlDataSource } from '../../packages/mysql/src';

class CheckedEvent {
    constructor(public id: string, public recordedAt: Date) {}
}
class CheckedTimestampContext extends DbContext {
    public readonly events = this.set(CheckedEvent);
    constructor(source: EntityKitDataSource, private readonly sqlType: string) {
        super(source);
    }
    protected override model(model: ModelBuilder): void {
        model.entity(CheckedEvent, entity => {
            entity.toTable('ek_checked_timestamp_rows').hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('varchar(64)').isRequired();
            entity.property(row => row.recordedAt).hasColumnName('recorded_at').hasColumnType(this.sqlType).isRequired();
            entity.materializeChecked(row => new CheckedEvent(
                row.required(event => event.id), row.required(event => event.recordedAt),
            ));
        });
    }
}

export function defineCheckedTimestampTests(provider: 'sqlite' | 'postgres' | 'mysql', url: () => string): void {
    const types = provider === 'mysql'
        ? ['datetime', 'datetime(0)', 'datetime(3)', 'datetime(6)', 'datetime(03)']
        : ['timestamptz', 'timestamptz(0)', 'timestamptz(3)', 'timestamptz(6)', 'timestamptz(03)'];
    it.each(types)('saves and checks tracked and untracked %s dates', async sqlType => {
        const source = provider === 'sqlite' ? createSqliteDataSource(url())
            : provider === 'postgres' ? createPostgresDataSource(url()) : createMySqlDataSource(url());
        try {
            await using context = new CheckedTimestampContext(source, sqlType);
            const cleanup = async (): Promise<void> => {
                await context.database.connection.query({ text: 'drop table if exists ek_checked_timestamp_rows', values: [] });
            };
            try {
                await cleanup();
                await context.database.ensureCreated();
                const date = new Date(sqlType.endsWith('(0)') || sqlType === 'datetime'
                    ? '2026-10-04T12:34:56.000Z' : '2026-10-04T12:34:56.123Z');
                context.events.create('recorded', date);
                expect(await context.saveChanges()).toBe(1);
                context.clearTracking();
                const tracked = await context.events.findOrThrow('recorded');
                const untracked = await context.events.asNoTracking().first();
                expect(tracked).toBeInstanceOf(CheckedEvent);
                expect(tracked.recordedAt).toBeInstanceOf(Date);
                expect(tracked.recordedAt).toEqual(date);
                expect(untracked).toEqual(tracked);
                expect(untracked).not.toBe(tracked);
                expect(context.entry(untracked)).toBeUndefined();
            } finally {
                await cleanup();
            }
        } finally {
            await source.dispose();
        }
    });
}
