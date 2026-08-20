import { join } from 'node:path';
import {
    DbContext,
    type DbContextOptionsBuilder,
    type ModelBuilder,
    type SqliteConnectionConfig,
} from '../packages/core/src';
import type { EntityKitDataSource } from '../packages/core/src/adapter';
import { createSqliteDataSource } from '../packages/sqlite/src';
import { createManagedTempDirectory } from './support/managed-temp-directory';

class DataSourceRow {
    public id!: string;
    public label!: string;
}

class DataSourceContext extends DbContext {
    public rows = this.set(DataSourceRow);

    constructor(
        private readonly source: EntityKitDataSource<SqliteConnectionConfig>,
        public readonly requestId: string,
    ) {
        super();
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useDataSource(this.source);
    }

    protected override model(model: ModelBuilder): void {
        model.entity(DataSourceRow, entity => {
            entity.toTable('data_source_rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(row => row.label).hasColumnName('label').hasColumnType('text').isRequired();
        });
    }
}

class InvalidDataSourceContext extends DbContext {
    constructor(private readonly source: EntityKitDataSource<SqliteConnectionConfig>) {
        super();
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useDataSource(this.source);
    }

    protected override model(model: ModelBuilder): void {
        model.entity(DataSourceRow, entity => {
            entity.toTable('invalid_data_source_rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(row => row.label).hasColumnName('label').hasColumnType('text').isRequired();
            entity.tenantKey(row => row.label);
        });
    }
}

describe('EntityKitDataSource lifecycle', () => {
    let directory: string;

    beforeEach(() => {
        directory = createManagedTempDirectory('entitykit-source-');
    });

    it('shares application state across cheap short-lived contexts', async () => {
        const source = createSqliteDataSource(join(directory, 'app.db'));
        const first = source.createContext(DataSourceContext, 'request-1');
        expect(first.requestId).toBe('request-1');
        await first.database.connection.query({
            text: 'create table data_source_rows (id text primary key, label text not null)',
            values: [],
        });
        first.rows.add(Object.assign(new DataSourceRow(), { id: 'one', label: 'First' }));
        await first.saveChanges();
        await first.dispose();

        const second = DataSourceContext.create(source, 'request-2');
        expect(await second.rows.count()).toBe(1);
        await second.dispose();
        await source.dispose();
    });

    it('makes shutdown ordering mistakes visible and disposes idempotently', async () => {
        const source = createSqliteDataSource(join(directory, 'shutdown.db'));
        const context = source.createContext(DataSourceContext, 'active');

        await expect(source.dispose()).rejects.toThrow(/1 connection lease.*Dispose their DbContexts/);
        await context.dispose();
        await expect(source.dispose()).resolves.toBeUndefined();
        await expect(source.dispose()).resolves.toBeUndefined();
        expect(() => source.createContext(DataSourceContext, 'late'))
            .toThrow('EntityKitDataSource was disposed');
    });

    it('refuses to release a direct lease while its transaction is active', async () => {
        const source = createSqliteDataSource(join(directory, 'direct-lease.db'));
        const lease = source.createConnection();

        await lease.transaction(async () => {
            await expect(lease.dispose?.()).rejects.toThrow(
                'Cannot dispose a data-source connection lease while a database operation is active',
            );
        });

        await lease.dispose?.();
        await expect(source.dispose()).resolves.toBeUndefined();
    });

    it('holds a direct lease until its row stream is closed', async () => {
        const source = createSqliteDataSource(join(directory, 'stream-lease.db'));
        const lease = source.createConnection();
        await lease.query({
            text: 'create table rows (id text primary key)',
            values: [],
        });
        await lease.query({
            text: 'insert into rows (id) values (?), (?)',
            values: ['one', 'two'],
        });
        const iterator = lease.stream?.<{ id: string }>({
            text: 'select id from rows order by id',
            values: [],
        }, { batchSize: 1 })[Symbol.asyncIterator]();
        if (!iterator) {
            throw new Error('SQLite must support query streaming.');
        }

        await expect(iterator.next()).resolves.toEqual({
            done: false,
            value: { id: 'one' },
        });
        await expect(lease.dispose?.()).rejects.toThrow(
            'Cannot dispose a data-source connection lease while a database operation is active',
        );
        await iterator.return?.();

        await expect(lease.dispose?.()).resolves.toBeUndefined();
        await expect(source.dispose()).resolves.toBeUndefined();
    });

    it('does not start a deferred row stream after its lease is disposed', async () => {
        const source = createSqliteDataSource(join(directory, 'deferred-stream.db'));
        const lease = source.createConnection();
        const rows = lease.stream?.({ text: 'select 1 as value', values: [] });
        if (!rows) {
            throw new Error('SQLite must support query streaming.');
        }

        await lease.dispose?.();
        await expect(rows[Symbol.asyncIterator]().next()).rejects.toThrow(
            'The data-source connection lease was disposed.',
        );
        await expect(source.dispose()).resolves.toBeUndefined();
    });

    it('does not acquire a connection when model validation fails', async () => {
        const source = createSqliteDataSource(join(directory, 'invalid.db'));

        expect(() => source.createContext(InvalidDataSourceContext))
            .toThrow(/tenant key.*no tenant scope is configured/);
        await expect(source.dispose()).resolves.toBeUndefined();
    });
});
