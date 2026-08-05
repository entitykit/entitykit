import { ModelBuilder as ModelBuilderImplementation } from '../src/model/model-builder';
import type { EntityMetadata } from '../src/model/entity-metadata';
import type { JsonValue } from '../src';
import {
    createProjectionBuilder,
    createProjectionExpression,
    createProjectionProxy,
    createQueryModel,
    createQueryProxy,
    Queryable,
    type QueryExecutor,
} from '../src/experimental';
import { SelectSqlBuilder } from '../src/sql/select-sql-builder';
import { mySqlDialect } from '../src/providers/mysql';

class JsonDocument {
    public id!: string;
    public data!: JsonValue | null;
    public label!: string | null;
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
        entity.property(document => document.label)
            .hasColumnName('label').hasColumnType('jsonb');
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

    it('casts MySQL JSON comparison parameters to the native JSON type', () => {
        const builder = new SelectSqlBuilder(mySqlDialect);
        const equality = builder.build(metadata, {
            ...createQueryModel(JsonDocument),
            predicate: document.data.eq({ version: 1 }),
        });
        const membership = builder.build(metadata, {
            ...createQueryModel(JsonDocument),
            predicate: document.data.in([{ version: 1 }, ['active']]),
        });

        expect(equality.text).toContain('`data` = cast(? as json)');
        expect(equality.values).toEqual(['{"version":1}']);
        expect(membership.text).toContain(
            '`data` in (cast(? as json), cast(? as json))',
        );
        expect(membership.values).toEqual(['{"version":1}', '["active"]']);
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

    it('normalizes a coalesce fallback on initial and cached compilation', () => {
        const builder = new SelectSqlBuilder();
        const projection = (
            fallback: string,
        ): ReturnType<typeof createProjectionExpression> => {
            const sql = createProjectionBuilder();
            const fields = createProjectionProxy<JsonDocument>();
            return createProjectionExpression({
                data: sql.coalesce(fields.label, sql.literal(fallback)),
            });
        };
        const first = builder.build(metadata, {
            ...createQueryModel(JsonDocument),
            projection: projection('first'),
        });
        const second = builder.build(metadata, {
            ...createQueryModel(JsonDocument),
            projection: projection('second'),
        });

        expect(second.text).toBe(first.text);
        expect(first.values).toEqual(['"first"']);
        expect(second.values).toEqual(['"second"']);
    });

    it('normalizes group-key values in having predicates', () => {
        const query = new Queryable(
            metadata,
            {} as QueryExecutor<JsonDocument>,
        )
            .groupBy(item => ({ data: item.data }))
            .having(group => group.key.data.eq({ status: 'active' }))
            .select(group => ({ data: group.key.data, count: group.count() }));

        expect(query.toSql().values).toEqual(['{"status":"active"}']);
    });
});
