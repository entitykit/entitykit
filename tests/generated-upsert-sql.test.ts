import { ModelBuilder as ModelBuilderImplementation } from '../packages/core/src/model/model-builder';
import type { EntityMetadata } from '../packages/core/src/model/entity-metadata';
import { ModificationSqlBuilder } from '../packages/core/src/sql/modification-sql-builder';

class GeneratedStatementRow {
    public id = 0;
    public tenantId = 'tenant-one';
    public sku = '';
    public label = '';
    public createdAt?: Date;
    public updatedAt?: Date;
}

function metadata(): EntityMetadata<GeneratedStatementRow> {
    const model = new ModelBuilderImplementation();
    model.entity(GeneratedStatementRow, entity => {
        entity.toTable('generated_statement_rows');
        entity.hasKey(row => row.id);
        entity.property(row => row.id).hasColumnType('integer')
            .isRequired().valueGeneratedOnAdd();
        entity.property(row => row.tenantId).hasColumnName('tenant_id')
            .hasColumnType('text').isRequired();
        entity.property(row => row.sku).hasColumnType('text').isRequired();
        entity.property(row => row.label).hasColumnType('text').isRequired();
        entity.property(row => row.createdAt).hasColumnName('created_at')
            .hasColumnType('timestamp').isRequired()
            .hasDefaultSql('current_timestamp').valueGeneratedOnAdd();
        entity.property(row => row.updatedAt).hasColumnName('updated_at')
            .hasColumnType('timestamp').isRequired()
            .hasDefaultSql('current_timestamp')
            .valueGeneratedOnAddOrUpdate();
        entity.tenantKey(row => row.tenantId);
        entity.hasIndex(row => row.sku).isUnique();
    });
    return model.build().getEntity(GeneratedStatementRow);
}

function row(): GeneratedStatementRow {
    return Object.assign(new GeneratedStatementRow(), {
        sku: 'sku-one',
        label: 'label-one',
    });
}

describe('store-generated upsert SQL', () => {
    it('omits generated inserts and updates in the Postgres helper', () => {
        expect(new ModificationSqlBuilder().buildPostgresUpsert(
            metadata(),
            row(),
            { conflictProperties: ['sku'] },
        )).toEqual({
            text: 'insert into "generated_statement_rows" ("tenant_id", "sku", "label") values ($1, $2, $3) ' +
                'on conflict ("sku") do update set "label" = excluded."label" ' +
                'returning "id", "created_at", "updated_at"',
            values: ['tenant-one', 'sku-one', 'label-one'],
        });
    });

    it('applies the same generated rules to provider-neutral batches', () => {
        expect(new ModificationSqlBuilder().buildUpsertBatch(
            metadata(),
            [row()],
            { conflictProperties: ['sku'] },
        )).toEqual({
            text: 'insert into "generated_statement_rows" ("tenant_id", "sku", "label") values ($1, $2, $3) ' +
                'on conflict ("sku") do update set "label" = excluded."label" ' +
                'returning "id", "created_at", "updated_at"',
            values: ['tenant-one', 'sku-one', 'label-one'],
        });
    });

    it('rejects a generated default conflict target before SQL', () => {
        expect(() => new ModificationSqlBuilder().buildPostgresUpsert(
            metadata(),
            row(),
        )).toThrow(
            'cannot use unresolved store-generated key \'id\' as its conflict target',
        );
        expect(() => new ModificationSqlBuilder().buildUpsertBatch(
            metadata(),
            [row()],
        )).toThrow(
            'cannot use unresolved store-generated key \'id\' as its conflict target',
        );
    });

    it('rejects explicit generated updates and ambiguous batches', () => {
        expect(() => new ModificationSqlBuilder().buildPostgresUpsert(
            metadata(),
            row(),
            {
                conflictProperties: ['sku'],
                updateProperties: ['label', 'updatedAt'],
            },
        )).toThrow(
            'cannot include store-generated property \'GeneratedStatementRow.updatedAt\'',
        );
        expect(() => new ModificationSqlBuilder().buildUpsertBatch(
            metadata(),
            [row(), row()],
            { conflictProperties: ['sku'] },
        )).toThrow('must execute one row at a time');
    });
});
