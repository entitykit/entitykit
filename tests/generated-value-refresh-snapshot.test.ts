import type {
    DatabaseOperationOptions,
    DatabaseQueryResult,
    DbContextOptionsBuilder,
    ModelBuilder,
    SqlStatement,
    ValueConverter,
} from '../packages/core/src';
import { DbContext, EntityState, valueConverter } from '../packages/core/src';
import type { SqlDialect } from '../packages/core/src/adapter';
import { mySqlDialect } from '../packages/mysql/src/mysql-dialect';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

const prefixed = (prefix: string): ValueConverter<string, string> =>
    valueConverter({
        toProvider: value => value.slice(prefix.length),
        fromProvider: value => `${prefix}${value}`,
    });

class RefreshedEntity {
    public tenantId!: string;
    public id!: string;
    public name!: string;
    public updatedAt!: Date;
}

class InsertedEntity {
    public id!: number;
    public name!: string;
    public createdAt!: Date;
}

class RefreshContext extends DbContext {
    public refreshed = this.set(RefreshedEntity);
    public inserted = this.set(InsertedEntity);

    constructor(
        private readonly connection: RecordingDatabaseConnection,
        private readonly sqlDialect: SqlDialect = mySqlDialect,
    ) {
        super();
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(this.connection, {
            provider: this.sqlDialect.name,
            dialect: this.sqlDialect,
        });
    }

    protected override model(model: ModelBuilder): void {
        model.entity(RefreshedEntity, entity => {
            entity.toTable('refreshed_entities');
            entity.hasKey(item => [item.tenantId, item.id]);
            entity.property(item => item.tenantId).hasColumnName('tenant_id')
                .hasColumnType('text').isRequired()
                .hasConversion(prefixed('tenant_'));
            entity.property(item => item.id).hasColumnName('id')
                .hasColumnType('text').isRequired()
                .hasConversion(prefixed('item_'));
            entity.property(item => item.name).hasColumnName('name')
                .hasColumnType('text').isRequired();
            entity.property(item => item.updatedAt).hasColumnName('updated_at')
                .hasColumnType('timestamp').isRequired()
                .valueGeneratedOnAddOrUpdate();
        });
        model.entity(InsertedEntity, entity => {
            entity.toTable('inserted_entities');
            entity.hasKey(item => item.id);
            entity.property(item => item.id).hasColumnName('id')
                .hasColumnType('integer').isRequired().valueGeneratedOnAdd();
            entity.property(item => item.name).hasColumnName('name')
                .hasColumnType('text').isRequired();
            entity.property(item => item.createdAt).hasColumnName('created_at')
                .hasColumnType('timestamp').isRequired().valueGeneratedOnAdd();
        });
    }
}

class DelayedQueryConnection extends RecordingDatabaseConnection {
    private releaseQuery!: () => void;
    private markStarted!: () => void;
    public readonly queryStarted: Promise<void> = new Promise(resolve => {
        this.markStarted = resolve;
    });
    private readonly released: Promise<void> = new Promise(resolve => {
        this.releaseQuery = resolve;
    });

    public release(): void {
        this.releaseQuery();
    }

    public override async query<
        TRow extends Record<string, unknown> = Record<string, unknown>,
    >(
        statement: SqlStatement,
        options?: DatabaseOperationOptions,
    ): Promise<DatabaseQueryResult<TRow>> {
        this.markStarted();
        await this.released;
        return super.query<TRow>(statement, options);
    }
}

describe('generated-value refresh identity snapshots', () => {
    it('uses captured composite converted keys after a live update mutation', async () => {
        const connection = new DelayedQueryConnection();
        const db = RefreshContext.create(connection);
        const original = new Date('2026-08-03T10:00:00.000Z');
        const refreshed = new Date('2026-08-03T11:00:00.000Z');
        const item = Object.assign(new RefreshedEntity(), {
            tenantId: 'tenant_a', id: 'item_7', name: 'before', updatedAt: original,
        });
        db.refreshed.attach(item);
        item.name = 'after';
        connection.queueResult({ rowCount: 1 });
        connection.queueResult({ rows: [{ updated_at: refreshed }], rowCount: 1 });

        const saving = db.saveChanges();
        await connection.queryStarted;
        item.tenantId = 'tenant_b';
        item.id = 'item_99';
        connection.release();
        await saving;

        expect(connection.statements).toEqual([
            {
                text: 'update `refreshed_entities` set `name` = ? where `tenant_id` = ? and `id` = ?',
                values: ['after', 'a', '7'],
            },
            {
                text: 'select `updated_at` from `refreshed_entities` where `tenant_id` = ? and `id` = ?',
                values: ['a', '7'],
            },
        ]);
        expect(db.entry(item)?.originalValues).toMatchObject({
            tenantId: 'tenant_a', id: 'item_7', updatedAt: refreshed,
        });
        expect(db.entry(item)?.state).toBe(EntityState.Modified);
    });

    it('refuses a generated insert key that the entity accessor rewrites', async () => {
        const connection = new RecordingDatabaseConnection();
        const db = RefreshContext.create(connection);
        const existing = Object.assign(new InsertedEntity(), {
            id: 999,
            name: 'existing',
            createdAt: new Date('2026-08-03T09:00:00.000Z'),
        });
        db.inserted.attach(existing);
        const target = Object.assign(new InsertedEntity(), {
            id: 0, name: 'inserted',
        });
        const item = new Proxy(target, {
            set(entity, property, value) {
                const written = Reflect.set(entity, property, value);
                if (property === 'id' && value === 42) entity.id = 999;
                return written;
            },
        });
        db.inserted.add(item);
        connection.queueResult({ rowCount: 1, insertId: 42 });
        connection.queueResult({
            rows: [{ created_at: new Date('2026-08-03T12:00:00.000Z') }],
            rowCount: 1,
        });

        await expect(db.saveChanges()).rejects.toThrow(
            'Property \'InsertedEntity.id\' refused its assigned value.',
        );

        expect(connection.transactionEvents).toEqual(['begin', 'rollback']);
        expect(item.id).toBe(0);
        expect(db.entry(item)?.state).toBe(EntityState.Added);
    });

    it('reports a persisted generated-key collision during hydration', async () => {
        const connection = new RecordingDatabaseConnection();
        const db = RefreshContext.create(connection);
        const existing = Object.assign(new InsertedEntity(), {
            id: 42,
            name: 'existing',
            createdAt: new Date('2026-08-03T09:00:00.000Z'),
        });
        db.inserted.attach(existing);
        const item = Object.assign(new InsertedEntity(), {
            id: 0,
            name: 'inserted',
        });
        db.inserted.add(item);
        connection.queueResult({ rowCount: 1, insertId: 42 });
        connection.queueResult({
            rows: [{ created_at: new Date('2026-08-03T12:00:00.000Z') }],
            rowCount: 1,
        });

        await expect(db.saveChanges()).rejects.toThrow(
            'An instance of \'InsertedEntity\' with key \'42\' is already tracked.',
        );

        expect(connection.transactionEvents).toEqual(['begin', 'rollback']);
        expect(item.id).toBe(0);
        expect(db.entry(item)?.state).toBe(EntityState.Added);
    });
});
