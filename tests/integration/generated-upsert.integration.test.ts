import type {
    DbContextOptionsBuilder,
    ModelBuilder,
    PropertyBuilder,
} from '../../packages/core/src';
import { DbContext } from '../../packages/core/src';
import { mySqlProviderServices } from '../../packages/mysql/src';
import { postgresProviderServices } from '../../packages/postgres/src';
import { requireDefined } from '../support/require-defined';

class GeneratedProviderRow {
    public id = 0;
    public sku = '';
    public label = '';
    public createdAt?: Date;
}

class MySqlGeneratedDefaultRow {
    public id = '';
    public label = '';
    public createdAt?: Date;
}

abstract class GeneratedUpsertProviderContext extends DbContext {
    public rows = this.set(GeneratedProviderRow);

    protected abstract configureProvider(
        options: DbContextOptionsBuilder,
    ): void;

    protected abstract configureIdentity(
        property: PropertyBuilder<number>,
    ): void;

    protected override configure(options: DbContextOptionsBuilder): void {
        this.configureProvider(options);
    }

    protected override model(model: ModelBuilder): void {
        model.entity(GeneratedProviderRow, entity => {
            entity.toTable('generated_upsert_provider_rows');
            entity.hasKey(row => row.id);
            const id = entity.property(row => row.id)
                .hasColumnType('integer').isRequired();
            this.configureIdentity(id);
            entity.property(row => row.sku).hasColumnType('text')
                .hasMaxLength(255).isRequired();
            entity.property(row => row.label).hasColumnType('text').isRequired();
            entity.property(row => row.createdAt).hasColumnName('created_at')
                .hasColumnType('timestamp').isRequired()
                .hasDefaultSql('current_timestamp(3)').valueGeneratedOnAdd();
            entity.hasIndex(row => row.sku).isUnique();
        });
    }
}

class PostgresGeneratedUpsertContext extends GeneratedUpsertProviderContext {
    protected override configureProvider(
        options: DbContextOptionsBuilder,
    ): void {
        options.useProvider(
            postgresProviderServices,
            requireDefined(process.env.DATABASE_URL),
        );
    }

    protected override configureIdentity(
        property: PropertyBuilder<number>,
    ): void {
        property.useIdentityColumn();
    }
}

class MySqlGeneratedUpsertContext extends GeneratedUpsertProviderContext {
    public defaults = this.set(MySqlGeneratedDefaultRow);

    protected override configureProvider(
        options: DbContextOptionsBuilder,
    ): void {
        options.useProvider(
            mySqlProviderServices,
            requireDefined(
                process.env.MYSQL_URL ?? process.env.MYSQL_DATABASE_URL,
            ),
        );
    }

    protected override configureIdentity(
        property: PropertyBuilder<number>,
    ): void {
        property.useAutoIncrement();
    }

    protected override model(model: ModelBuilder): void {
        super.model(model);
        model.entity(MySqlGeneratedDefaultRow, entity => {
            entity.toTable('mysql_generated_default_rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text')
                .isRequired();
            entity.property(row => row.label).hasColumnType('text')
                .isRequired();
            entity.property(row => row.createdAt).hasColumnName('created_at')
                .hasColumnType('timestamp').isRequired()
                .hasDefaultSql('current_timestamp(3)').valueGeneratedOnAdd();
        });
    }
}

function row(sku: string, label: string): GeneratedProviderRow {
    return Object.assign(new GeneratedProviderRow(), { sku, label });
}

const naturalKeyOptions = {
    conflictProperties: ['sku'] as const,
    updateProperties: ['label'] as const,
};

const postgresEnabled = process.env.RUN_POSTGRES_TESTS === 'true' &&
    Boolean(process.env.DATABASE_URL);
(postgresEnabled ? describe : describe.skip)(
    'Postgres generated-value upsert',
    () => {
        let db: PostgresGeneratedUpsertContext;

        beforeEach(async () => {
            db = PostgresGeneratedUpsertContext.create();
            await db.database.connection.query({
                text: 'drop table if exists generated_upsert_provider_rows cascade',
                values: [],
            });
            await db.database.connection.query({
                text: db.database.createScript(),
                values: [],
            });
        });

        afterEach(async () => {
            await db.database.connection.query({
                text: 'drop table if exists generated_upsert_provider_rows cascade',
                values: [],
            });
            await db.dispose();
        });

        it('hydrates generated values through natural-key inserts and conflicts', async () => {
            const inserted = row('sku-one', 'before');
            await expect(db.rows.upsert([inserted], naturalKeyOptions))
                .resolves.toBe(1);
            expect(inserted.id).toBeGreaterThan(0);
            expect(inserted.createdAt).toBeInstanceOf(Date);

            const updated = row('sku-one', 'after');
            await expect(db.rows.upsert([updated], naturalKeyOptions))
                .resolves.toBe(1);
            expect(updated.id).toBe(inserted.id);
            expect(updated.createdAt).toEqual(inserted.createdAt);
            expect(await db.rows.toArray()).toEqual([
                expect.objectContaining({
                    id: inserted.id,
                    sku: 'sku-one',
                    label: 'after',
                }),
            ]);
        });
    },
);

const mysqlEnabled = process.env.RUN_MYSQL_TESTS === 'true' &&
    Boolean(process.env.MYSQL_URL ?? process.env.MYSQL_DATABASE_URL);
(mysqlEnabled ? describe : describe.skip)(
    'MySQL generated-value upsert',
    () => {
        let db: MySqlGeneratedUpsertContext;

        beforeEach(async () => {
            db = MySqlGeneratedUpsertContext.create();
            await db.database.connection.query({
                text: 'drop table if exists mysql_generated_default_rows',
                values: [],
            });
            await db.database.connection.query({
                text: 'drop table if exists generated_upsert_provider_rows',
                values: [],
            });
            await db.database.connection.query({
                text: db.database.createScript(),
                values: [],
            });
        });

        afterEach(async () => {
            await db.database.connection.query({
                text: 'drop table if exists mysql_generated_default_rows',
                values: [],
            });
            await db.database.connection.query({
                text: 'drop table if exists generated_upsert_provider_rows',
                values: [],
            });
            await db.dispose();
        });

        it('rejects unresolved generated-key upserts before writing a row', async () => {
            const incoming = row('sku-one', 'one');

            await expect(db.rows.upsert([incoming])).rejects.toThrow(
                'cannot use unresolved store-generated key \'id\' as its conflict target',
            );

            expect(incoming.id).toBe(0);
            expect(incoming.createdAt).toBeUndefined();
            expect(await db.rows.count()).toBe(0);
        });

        it('rejects stable-key upserts when generated values cannot be returned', async () => {
            const incoming = Object.assign(new MySqlGeneratedDefaultRow(), {
                id: 'row-one',
                label: 'one',
            });

            await expect(db.defaults.upsert([incoming]))
                .rejects.toThrow(
                    'The \'mysql\' dialect cannot safely upsert store-generated properties',
                );

            expect(incoming.createdAt).toBeUndefined();
            expect(await db.defaults.count()).toBe(0);
        });
    },
);
