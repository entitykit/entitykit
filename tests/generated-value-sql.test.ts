import { ModelBuilder as ModelBuilderImplementation } from '../packages/core/src/model/model-builder';import type { EntityMetadata } from '../packages/core/src/model/entity-metadata';
import { postgresDialect } from '../packages/postgres/src';
import { mySqlDialect } from '../packages/mysql/src/mysql-dialect';
import { sqliteDialect } from '../packages/sqlite/src/sqlite-dialect';
import { ModificationSqlBuilder } from '../packages/core/src/sql/modification-sql-builder';

class GeneratedOnly {
    public id = 0;
}

function generatedOnlyMetadata(): EntityMetadata<GeneratedOnly> {
    const model = new ModelBuilderImplementation();
    model.entity(GeneratedOnly, entity => {
        entity.toTable('generated_only');
        entity.hasKey(row => row.id);
        entity.property(row => row.id)
            .hasColumnName('id').hasColumnType('integer').isRequired()
            .valueGeneratedOnAdd();
    });
    return model.build().getEntity(GeneratedOnly);
}

describe('generated-only insert SQL', () => {
    it('uses provider-specific empty inserts and returning support', () => {
        const metadata = generatedOnlyMetadata();
        const entity = new GeneratedOnly();

        expect(new ModificationSqlBuilder(postgresDialect)
            .buildInsert(metadata, entity)).toEqual({
            text: 'insert into "generated_only" default values returning "id"',
            values: [],
        });
        expect(new ModificationSqlBuilder(sqliteDialect)
            .buildInsert(metadata, entity)).toEqual({
            text: 'insert into "generated_only" default values returning "id"',
            values: [],
        });
        expect(new ModificationSqlBuilder(mySqlDialect)
            .buildInsert(metadata, entity)).toEqual({
            text: 'insert into `generated_only` () values ()',
            values: [],
        });
    });
});
