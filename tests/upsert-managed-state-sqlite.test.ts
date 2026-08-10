import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import { DbContext } from '../src';
import { sqliteProviderServices } from '../src/providers/sqlite';

class ManagedStateRow {
    public id = '';
    public sku = '';
    public externalCode = '';
    public version = 0;
    public etag = '';
    public createdAt = '';
    public updatedAt = '';
    public createdBy = '';
    public updatedBy = '';
    public deletedAt: string | null = null;
    public serverStamp = '';
    public label = '';
}

class ManagedStateContext extends DbContext {
    public rows = this.set(ManagedStateRow);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(ManagedStateRow, entity => {
            entity.toTable('managed_state_rows');
            entity.hasKey(row => row.id);
            entity.hasAlternateKey(row => row.externalCode);
            entity.hasIndex(row => row.sku).isUnique();
            entity.audit({
                createdAt: row => row.createdAt,
                updatedAt: row => row.updatedAt,
                createdBy: row => row.createdBy,
                updatedBy: row => row.updatedBy,
            });
            entity.softDelete(row => row.deletedAt, 'deleted');
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.sku).hasColumnType('text').isRequired();
            entity.property(row => row.externalCode).hasColumnName('external_code')
                .hasColumnType('text').isRequired();
            entity.property(row => row.version).hasColumnType('integer').isRequired().isVersion();
            entity.property(row => row.etag).hasColumnType('text').isRequired().isConcurrencyToken();
            entity.property(row => row.createdAt).hasColumnName('created_at')
                .hasColumnType('text').isRequired();
            entity.property(row => row.updatedAt).hasColumnName('updated_at')
                .hasColumnType('text').isRequired();
            entity.property(row => row.createdBy).hasColumnName('created_by')
                .hasColumnType('text').isRequired();
            entity.property(row => row.updatedBy).hasColumnName('updated_by')
                .hasColumnType('text').isRequired();
            entity.property(row => row.deletedAt).hasColumnName('deleted_at')
                .hasColumnType('text');
            entity.property(row => row.serverStamp).hasColumnName('server_stamp')
                .hasColumnType('text').isRequired()
                .hasDefaultSql('\'server-default\'').valueGeneratedOnAdd();
            entity.property(row => row.label).hasColumnType('text').isRequired();
        });
    }
}

function incoming(overrides: Partial<ManagedStateRow>): ManagedStateRow {
    return Object.assign(new ManagedStateRow(), {
        id: 'incoming-id',
        sku: 'shared-sku',
        externalCode: 'incoming-external',
        version: 99,
        etag: 'incoming-etag',
        createdAt: 'incoming-created-at',
        updatedAt: 'incoming-updated-at',
        createdBy: 'incoming-created-by',
        updatedBy: 'incoming-updated-by',
        deletedAt: null,
        label: 'incoming-label',
        ...overrides,
    });
}

async function open(): Promise<ManagedStateContext> {
    const db = ManagedStateContext.create();
    await db.database.connection.query({
        text: db.database.createScript(),
        values: [],
    });
    return db;
}

describe('SQLite default upsert managed state', () => {
    it('updates business values without rewriting immutable or managed state', async () => {
        const db = await open();
        await db.database.connection.query({
            text: `insert into managed_state_rows
                (id, sku, external_code, version, etag, created_at, updated_at,
                    created_by, updated_by, deleted_at, server_stamp, label)
                values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            values: [
                'stored-id', 'shared-sku', 'stored-external', 5, 'stored-etag',
                'stored-created-at', 'stored-updated-at', 'stored-created-by',
                'stored-updated-by', 'stored-deleted-at', 'stored-server', 'old-label',
            ],
        });

        await expect(db.rows.upsert([incoming({})], {
            conflictProperties: ['sku'],
        })).resolves.toBe(1);

        const stored = await db.database.connection.query({
            text: 'select * from managed_state_rows where sku = ?',
            values: ['shared-sku'],
        });
        expect(stored.rows).toEqual([{
            id: 'stored-id',
            sku: 'shared-sku',
            external_code: 'stored-external',
            version: 5,
            etag: 'stored-etag',
            created_at: 'stored-created-at',
            updated_at: 'stored-updated-at',
            created_by: 'stored-created-by',
            updated_by: 'stored-updated-by',
            deleted_at: 'stored-deleted-at',
            server_stamp: 'stored-server',
            label: 'incoming-label',
        }]);
        await db.dispose();
    });

    it('still inserts caller state while hydrating generated values', async () => {
        const db = await open();
        const inserted = incoming({
            id: 'new-id',
            sku: 'new-sku',
            externalCode: 'new-external',
            deletedAt: 'caller-deleted-at',
        });

        await expect(db.rows.upsert([inserted], {
            conflictProperties: ['sku'],
        })).resolves.toBe(1);

        expect(inserted.serverStamp).toBe('server-default');
        const stored = await db.database.connection.query({
            text: 'select * from managed_state_rows where id = ?',
            values: ['new-id'],
        });
        expect(stored.rows).toEqual([{
            id: 'new-id',
            sku: 'new-sku',
            external_code: 'new-external',
            version: 99,
            etag: 'incoming-etag',
            created_at: 'incoming-created-at',
            updated_at: 'incoming-updated-at',
            created_by: 'incoming-created-by',
            updated_by: 'incoming-updated-by',
            deleted_at: 'caller-deleted-at',
            server_stamp: 'server-default',
            label: 'incoming-label',
        }]);
        await db.dispose();
    });
});
