import { ModelBuilder as ModelBuilderImplementation } from '../src/model/model-builder';
import type { EntityMetadata } from '../src/model/entity-metadata';
import { createQueryModel, createQueryProxy } from '../src/experimental';
import { SelectSqlBuilder } from '../src/sql/select-sql-builder';

class JsonDocument {
    public id!: string;
    public data!: unknown;
}

function createMetadata(): EntityMetadata<JsonDocument> {
    const model = new ModelBuilderImplementation();
    model.entity(JsonDocument, entity => {
        entity.toTable('json_documents');
        entity.hasKey(document => document.id);
        entity.property(document => document.id)
            .hasColumnName('id').hasColumnType('text').isRequired();
        entity.property(document => document.data)
            .hasColumnName('data').hasColumnType('jsonb');
    });
    return model.build().getEntity(JsonDocument);
}

describe('JSON query parameter binding', () => {
    const metadata = createMetadata();
    const document = createQueryProxy<JsonDocument>();

    it.each([
        ['object', { version: 1 }, '{"version":1}'],
        ['array', [1, 2], '[1,2]'],
        ['string', 'active', '"active"'],
        ['boolean', true, 'true'],
        ['number', 42, '42'],
    ])('binds a %s predicate like a mapped write', (_label, value, stored) => {
        const statement = new SelectSqlBuilder().build(metadata, {
            ...createQueryModel(JsonDocument),
            predicate: document.data.eq(value),
        });

        expect(statement.values).toEqual([stored]);
    });

    it('normalizes every non-null member of an in predicate', () => {
        const statement = new SelectSqlBuilder().build(metadata, {
            ...createQueryModel(JsonDocument),
            predicate: document.data.in([{ version: 1 }, ['active'], true, 42]),
        });

        expect(statement.values).toEqual([
            '{"version":1}',
            '["active"]',
            'true',
            '42',
        ]);
    });

    it('rebinds normalized JSON values on a compiled-query cache hit', () => {
        const builder = new SelectSqlBuilder();
        const first = builder.build(metadata, {
            ...createQueryModel(JsonDocument),
            predicate: document.data.eq('first'),
        });
        const second = builder.build(metadata, {
            ...createQueryModel(JsonDocument),
            predicate: document.data.eq('second'),
        });

        expect(second.text).toBe(first.text);
        expect(first.values).toEqual(['"first"']);
        expect(second.values).toEqual(['"second"']);
    });
});
