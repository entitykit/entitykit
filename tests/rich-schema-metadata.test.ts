import { ModelBuilder as ModelBuilderImplementation } from '../packages/core/src/model/model-builder';import { MigrationSqlGenerator, diffModelSnapshots } from '../packages/core/src/migrations/api';
import { mySqlDialect } from '../packages/mysql/src/mysql-dialect';
import { sqliteProviderServices } from '../packages/sqlite/src';
import { SchemaSqlBuilder } from '../packages/core/src/schema/schema-sql-builder';

class Invoice {
    public id!: string;
    public email!: string;
    public subtotal!: number;
    public tax!: number;
    public total!: number;
}

function invoiceModel(checkSql = 'subtotal >= 0'): ModelBuilderImplementation {
    return new ModelBuilderImplementation()
        .hasSequence('invoice_numbers', sequence => sequence
            .hasSchema('billing')
            .hasDataType('bigint')
            .startsAt(1000n)
            .incrementsBy(5)
            .hasMin(1000)
            .isCyclic()
            .hasCache(20))
        .entity(Invoice, entity => {
            entity.toTable('invoices', 'billing');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('uuid').isRequired();
            entity.property(row => row.email)
                .hasColumnType('text').isRequired().useCollation('C');
            entity.property(row => row.subtotal).hasColumnType('integer').isRequired();
            entity.property(row => row.tax).hasColumnType('integer').isRequired();
            entity.property(row => row.total).hasColumnType('integer').isRequired()
                .hasComputedColumnSql('subtotal + tax');
            entity.hasCheckConstraint('ck_invoices_subtotal', checkSql);
            entity.hasExpressionIndex('lower(email)')
                .hasDatabaseName('ix_invoices_email_active')
                .includeProperties(row => row.total)
                .hasFilter('subtotal > 0');
        });
}

describe('rich schema metadata', () => {
    it('builds Postgres DDL without losing advanced facets', () => {
        const model = invoiceModel().build();
        const sql = new SchemaSqlBuilder().build(model);

        expect(sql).toContain(
            'create sequence if not exists "billing"."invoice_numbers" as bigint increment by 5 minvalue 1000 start with 1000 cache 20 cycle;',
        );
        expect(sql).toContain('"email" text collate "C" not null');
        expect(sql).toContain(
            '"total" integer not null generated always as (subtotal + tax) stored',
        );
        expect(sql).toContain(
            'constraint "ck_invoices_subtotal" check (subtotal >= 0)',
        );
        expect(sql).toContain(
            'create index if not exists "ix_invoices_email_active" on "billing"."invoices" (lower(email)) include ("total") where subtotal > 0;',
        );

        expect(model.toSnapshot()).toMatchObject({
            sequences: [{
                name: 'invoice_numbers',
                schemaName: 'billing',
                startValue: '1000',
                incrementBy: '5',
                isCyclic: true,
            }],
            entities: [{
                checkConstraints: [{ name: 'ck_invoices_subtotal', sql: 'subtotal >= 0' }],
                indexes: [{
                    keyParts: [{ kind: 'expression', expression: 'lower(email)' }],
                    includedPropertyNames: ['total'],
                    filter: 'subtotal > 0',
                }],
            }],
        });
    });

    it('reports provider limitations rather than emitting invalid DDL', () => {
        const model = invoiceModel().build();

        expect(() => new SchemaSqlBuilder(mySqlDialect).build(model))
            .toThrow('Database sequences are not supported by the \'mysql\' provider');
        expect(() => new SchemaSqlBuilder(
            sqliteProviderServices.dialect,
        ).build(model))
            .toThrow('Database sequences are not supported by the \'sqlite\' provider');
    });

    it('diffs checks, sequences, columns, and rich indexes', () => {
        const from = invoiceModel().build().toSnapshot();
        const toBuilder = invoiceModel('subtotal >= 10');
        toBuilder.entity(Invoice, entity => {
            entity.property(row => row.email).useCollation('POSIX');
        });
        const built = toBuilder.build().toSnapshot();
        const to = {
            ...built,
            sequences: built.sequences?.map(sequence => ({
                ...sequence,
                incrementBy: '10',
            })),
        };
        const diff = diffModelSnapshots(from, to);

        const alterColumn = diff.operations.find(operation =>
            operation.kind === 'alterColumn');
        const droppedCheck = diff.operations.find(operation =>
            operation.kind === 'dropCheckConstraint');
        const addedCheck = diff.operations.find(operation =>
            operation.kind === 'addCheckConstraint');
        const sequence = diff.operations.find(operation =>
            operation.kind === 'alterSequence');
        expect(alterColumn).toMatchObject({
            column: { name: 'email', oldCollation: 'C', collation: 'POSIX' },
        });
        expect(droppedCheck).toMatchObject({
            name: 'ck_invoices_subtotal',
            sql: 'subtotal >= 0',
        });
        expect(addedCheck).toMatchObject({
            name: 'ck_invoices_subtotal',
            sql: 'subtotal >= 10',
        });
        expect(sequence).toMatchObject({
            sequence: { incrementBy: '10' },
            previous: { incrementBy: '5' },
        });
    });

    it('creates all rich facets through an initial migration', () => {
        const empty = { formatVersion: 1 as const, entities: [] };
        const diff = diffModelSnapshots(empty, invoiceModel().build().toSnapshot());
        const sql = new MigrationSqlGenerator().generateUpScript(
            diff.toMigration('1_CreateInvoices', 'CreateInvoices'),
        );

        expect(sql).toContain('create sequence if not exists');
        expect(sql).toContain('check (subtotal >= 0)');
        expect(sql).toContain('generated always as (subtotal + tax) stored');
        expect(sql).toContain('include ("total") where subtotal > 0');
    });

    it('rejects invalid sequence bounds and duplicate covering columns', () => {
        expect(() => new ModelBuilderImplementation()
            .hasSequence('bad', sequence => sequence
                .startsAt(5)
                .hasMin(10))
            .build())
            .toThrow('Sequence start value must not be below its minimum');

        expect(() => new ModelBuilderImplementation().entity(Invoice, entity => {
            entity.toTable('invoices');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('uuid');
            entity.hasIndex(row => row.id).includeProperties(row => row.id);
        }).build())
            .toThrow('duplicates index key property');
    });

    it('keeps computed columns database-owned', () => {
        expect(() => new ModelBuilderImplementation().entity(Invoice, entity => {
            entity.toTable('invoices');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('uuid');
            entity.property(row => row.total)
                .hasColumnType('integer')
                .hasComputedColumnSql('1 + 1')
                .valueGeneratedNever();
        }).build())
            .toThrow('must remain generated on add or update');
    });

    it('does not collapse a filtered unique index into an alternate key', () => {
        const model = new ModelBuilderImplementation().entity(Invoice, entity => {
            entity.toTable('invoices');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('uuid');
            entity.property(row => row.email).hasColumnType('text');
            entity.hasIndex(row => row.email)
                .isUnique()
                .hasDatabaseName('ix_invoices_active_email')
                .hasFilter('subtotal > 0');
            entity.hasAlternateKey(row => row.email)
                .hasDatabaseName('ak_invoices_email');
        }).build();

        expect(model.getEntity(Invoice).indexes).toHaveLength(2);
        const sql = new SchemaSqlBuilder().build(model);
        expect(sql).toContain(
            'constraint "ak_invoices_email" unique ("email")',
        );
        expect(sql).toContain(
            'create unique index if not exists "ix_invoices_active_email"');
        expect(sql).toContain('where subtotal > 0');
    });

    it('preserves included columns on a covering alternate key', () => {
        const model = new ModelBuilderImplementation().entity(Invoice, entity => {
            entity.toTable('invoices');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('uuid');
            entity.property(row => row.email).hasColumnType('text');
            entity.property(row => row.total).hasColumnType('integer');
            entity.hasIndex(row => row.email)
                .isUnique()
                .hasDatabaseName('ak_invoices_email')
                .includeProperties(row => row.total);
            entity.hasAlternateKey(row => row.email)
                .hasDatabaseName('ak_invoices_email');
        }).build();

        expect(new SchemaSqlBuilder().build(model)).toContain(
            'constraint "ak_invoices_email" unique ("email") include ("total")',
        );
        expect(() => new SchemaSqlBuilder(mySqlDialect).build(model))
            .toThrow('Covering alternate keys are not supported');
    });
});
