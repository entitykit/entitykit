import type { DbContextOptionsBuilder, ModelBuilder } from '../packages/core/src';
import { DbContext, valueConverter } from '../packages/core/src';
import { Materializer } from '../packages/core/src/experimental';
import { ModelBuilder as ModelBuilderImplementation } from '../packages/core/src/model/model-builder';
import {
    sqliteProviderServices,
    sqliteValueReader,
} from '../packages/sqlite/src';
import { ChangeTracker } from '../packages/core/src/tracking/change-tracker';

class BooleanIdentityRow {
    public id = false;
}

class DateIdentityRow {
    public id = new Date(0);
}

class JsonTenantIdentityRow {
    public id = '';
    public tenantId: { region: string } = { region: '' };
}

class ConvertedBooleanIdentityRow {
    public id = 'disabled';
}

const convertedBooleanIdentity = valueConverter<string, boolean>({
    toProvider: value => value === 'enabled',
    fromProvider: value => value ? 'enabled' : 'disabled',
});

class ConvertedDateIdentityRow {
    public id = '';
}

const convertedDateIdentity = valueConverter<string, Date>({
    toProvider: value => new Date(value),
    fromProvider: value => value.toISOString(),
});

class SqliteBooleanIdentityRow {
    public id = false;
    public name = '';
}

class SqliteDateIdentityRow {
    public id = new Date(0);
    public name = '';
}

class SqliteJsonTenantIdentityRow {
    public id = '';
    public tenantId: { region: string } = { region: '' };
    public name = '';
}

class RowIdentitySqliteContext extends DbContext {
    public booleans = this.set(SqliteBooleanIdentityRow);
    public dates = this.set(SqliteDateIdentityRow);
    public tenants = this.set(SqliteJsonTenantIdentityRow);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:')
            .useTenantScope(() => ({ region: 'north' }));
    }

    protected override model(model: ModelBuilder): void {
        model.entity(SqliteBooleanIdentityRow, entity => {
            entity.toTable('row_boolean_identity_rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('boolean').isRequired();
            entity.property(row => row.name).hasColumnType('text').isRequired();
        });
        model.entity(SqliteDateIdentityRow, entity => {
            entity.toTable('row_date_identity_rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('timestamptz').isRequired();
            entity.property(row => row.name).hasColumnType('text').isRequired();
        });
        model.entity(SqliteJsonTenantIdentityRow, entity => {
            entity.toTable('row_json_tenant_identity_rows');
            entity.hasKey(row => row.id);
            entity.tenantKey(row => row.tenantId);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.tenantId).hasColumnName('tenant_id')
                .hasColumnType('json').isRequired();
            entity.property(row => row.name).hasColumnType('text').isRequired();
        });
    }
}

async function openRowIdentitySqlite(): Promise<RowIdentitySqliteContext> {
    const db = RowIdentitySqliteContext.create();
    await db.database.connection.query({
        text: db.database.createScript(), values: [],
    });
    await db.database.connection.query({
        text: `insert into row_boolean_identity_rows (id, name)
            values (?, ?)`,
        values: [1, 'boolean'],
    });
    await db.database.connection.query({
        text: `insert into row_date_identity_rows (id, name)
            values (?, ?)`,
        values: ['2026-08-11T12:30:00.000Z', 'date'],
    });
    await db.database.connection.query({
        text: `insert into row_json_tenant_identity_rows
            (id, tenant_id, name) values (?, ?, ?)`,
        values: ['shared', '{"region":"north"}', 'json'],
    });
    return db;
}

describe('materialized bound row identity', () => {
    it('normalizes SQLite boolean rows before identity registration', () => {
        const metadata = new ModelBuilderImplementation()
            .entity(BooleanIdentityRow, entity => {
                entity.toTable('boolean_identity_rows');
                entity.hasKey(row => row.id);
                entity.property(row => row.id)
                    .hasColumnType('boolean').isRequired();
            })
            .build()
            .getEntity(BooleanIdentityRow);
        const tracker = new ChangeTracker();
        const materializer = new Materializer(sqliteValueReader);

        const first = materializer.materialize(metadata, { id: 1 }, tracker);
        const second = materializer.materialize(metadata, { id: 1 }, tracker);

        expect(first.id).toBe(true);
        expect(second).toBe(first);
        expect(tracker.entry(first)?.originalBoundValues.id).toBe(true);
        expect(tracker.entries()).toHaveLength(1);
    });

    it('normalizes SQLite date rows before identity registration', () => {
        const metadata = new ModelBuilderImplementation()
            .entity(DateIdentityRow, entity => {
                entity.toTable('date_identity_rows');
                entity.hasKey(row => row.id);
                entity.property(row => row.id)
                    .hasColumnType('timestamptz').isRequired();
            })
            .build()
            .getEntity(DateIdentityRow);
        const tracker = new ChangeTracker();
        const materializer = new Materializer(sqliteValueReader);
        const stored = '2026-08-11T12:30:00.000Z';

        const first = materializer.materialize(metadata, { id: stored }, tracker);
        const second = materializer.materialize(metadata, { id: stored }, tracker);

        expect(first.id).toEqual(new Date(stored));
        expect(second).toBe(first);
        expect(tracker.entry(first)?.originalBoundValues.id)
            .toEqual(new Date(stored));
        expect(tracker.entries()).toHaveLength(1);
    });

    it('normalizes SQLite JSON tenants before identity registration', () => {
        const metadata = new ModelBuilderImplementation()
            .entity(JsonTenantIdentityRow, entity => {
                entity.toTable('json_tenant_identity_rows');
                entity.hasKey(row => row.id);
                entity.tenantKey(row => row.tenantId);
                entity.property(row => row.id)
                    .hasColumnType('text').isRequired();
                entity.property(row => row.tenantId)
                    .hasColumnType('json').isRequired();
            })
            .build()
            .getEntity(JsonTenantIdentityRow);
        const tracker = new ChangeTracker();
        const materializer = new Materializer(sqliteValueReader);

        const north = materializer.materialize(metadata, {
            id: 'shared', tenantId: '{"region":"north"}',
        }, tracker);
        const duplicate = materializer.materialize(metadata, {
            id: 'shared', tenantId: '{"region":"north"}',
        }, tracker);
        const south = materializer.materialize(metadata, {
            id: 'shared', tenantId: '{"region":"south"}',
        }, tracker);

        expect(duplicate).toBe(north);
        expect(south).not.toBe(north);
        expect(tracker.entry(north)?.originalBoundValues.tenantId)
            .toBe('{"region":"north"}');
        expect(tracker.entries()).toHaveLength(2);
    });

    it('normalizes SQLite booleans before a key converter runs', () => {
        const metadata = new ModelBuilderImplementation()
            .entity(ConvertedBooleanIdentityRow, entity => {
                entity.toTable('converted_boolean_identity_rows');
                entity.hasKey(row => row.id);
                entity.property(row => row.id).hasColumnType('boolean')
                    .hasConversion(convertedBooleanIdentity).isRequired();
            })
            .build()
            .getEntity(ConvertedBooleanIdentityRow);
        const tracker = new ChangeTracker();
        const materializer = new Materializer(sqliteValueReader);

        const first = materializer.materialize(metadata, { id: 1 }, tracker);
        const second = materializer.materialize(metadata, { id: 1 }, tracker);

        expect(first.id).toBe('enabled');
        expect(second).toBe(first);
        expect(tracker.entry(first)?.originalBoundValues.id).toBe(true);
        expect(tracker.entries()).toHaveLength(1);
    });

    it('normalizes SQLite timestamps before a key converter runs', () => {
        const metadata = new ModelBuilderImplementation()
            .entity(ConvertedDateIdentityRow, entity => {
                entity.toTable('converted_date_identity_rows');
                entity.hasKey(row => row.id);
                entity.property(row => row.id).hasColumnType('timestamptz')
                    .hasConversion(convertedDateIdentity).isRequired();
            })
            .build()
            .getEntity(ConvertedDateIdentityRow);
        const tracker = new ChangeTracker();
        const materializer = new Materializer(sqliteValueReader);
        const stored = '2026-08-11T12:30:00.000Z';

        const first = materializer.materialize(metadata, { id: stored }, tracker);
        const second = materializer.materialize(metadata, { id: stored }, tracker);

        expect(first.id).toBe(stored);
        expect(second).toBe(first);
        expect(tracker.entry(first)?.originalBoundValues.id)
            .toEqual(new Date(stored));
        expect(tracker.entries()).toHaveLength(1);
    });
});

describe('SQLite bound row identity', () => {
    it('resolves repeated boolean primary-key queries to one entry', async () => {
        const db = await openRowIdentitySqlite();

        const first = await db.booleans.find(true);
        const second = await db.booleans.find(true);

        expect(first?.name).toBe('boolean');
        expect(second).toBe(first);
        expect(db.changeTracker.entries()).toHaveLength(1);
        await db.dispose();
    });

    it('resolves repeated timestamp primary-key queries to one entry', async () => {
        const db = await openRowIdentitySqlite();
        const key = new Date('2026-08-11T12:30:00.000Z');

        const first = await db.dates.find(key);
        const second = await db.dates.find(key);

        expect(first?.name).toBe('date');
        expect(second).toBe(first);
        expect(db.changeTracker.entries()).toHaveLength(1);
        await db.dispose();
    });

    it('resolves repeated JSON-tenant queries to one entry', async () => {
        const db = await openRowIdentitySqlite();

        const first = await db.tenants.single();
        const second = await db.tenants.single();

        expect(first.name).toBe('json');
        expect(second).toBe(first);
        expect(db.changeTracker.entries()).toHaveLength(1);
        await db.dispose();
    });
});
