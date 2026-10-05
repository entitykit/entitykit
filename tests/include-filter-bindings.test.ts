import { ModelBuilder } from '../packages/core/src/model/model-builder';
import type { EntityMetadata } from '../packages/core/src/model/entity-metadata';
import { requireDefined } from './support/require-defined';
import { bindIncludeFilter } from '../packages/core/src/query/include-filter-bindings';
import { includeKeyStatements } from '../packages/core/src/query/include-key-statements';
import { FieldExpression } from '../packages/core/src/query/expression/field-expression';
import { PredicateExpression } from '../packages/core/src/query/expression/predicate-expression';
import { cloneQueryModel, createQueryModel } from '../packages/core/src/query/query-model';
import { SelectSqlBuilder } from '../packages/core/src/sql/select-sql-builder';
import { sqliteDialect } from '../packages/sqlite/src';

class BindingRow {
    public id = 0;
    public score = 0;
    public label = '';
}

function mapping(): { model: ModelBuilder; metadata: EntityMetadata<BindingRow>; convert: jest.Mock<number, [number]> } {
    const convert = jest.fn((value: number) => value + 100);
    const model = new ModelBuilder();
    model.entity(BindingRow, entity => {
        entity.toTable('binding_rows');
        entity.hasKey(row => row.id);
        entity.property(row => row.id).hasColumnType('integer');
        entity.property(row => row.score).hasColumnType('integer').hasConversion({
            toProvider: convert, fromProvider: (value: number) => value - 100,
        });
        entity.property(row => row.label).hasColumnType('text').hasConversion({
            toProvider: value => value.toLowerCase(), fromProvider: (value: string) => value,
        });
    });
    return { model, metadata: model.build().getEntity(BindingRow), convert };
}

describe('include filter binding ownership', () => {
    it('converts each fixed operand once across the sample and every key chunk', () => {
        const { metadata, convert } = mapping();
        const scores = Array.from({ length: 80 }, (_, index) => index);
        const fixed = bindIncludeFilter(metadata, { predicate: new FieldExpression('score').in(scores), orderings: [] });
        const dialect = { ...sqliteDialect, maxStatementParameters: () => 96 };
        const sql = new SelectSqlBuilder(dialect);
        const statements = [...includeKeyStatements(dialect, Array.from({ length: 33 }, (_, index) => index + 1), 1,
            keys => sql.build(metadata, cloneQueryModel(createQueryModel(BindingRow), {
                predicate: new FieldExpression('id').in(keys).and(requireDefined(fixed.predicate)),
            })))];
        expect(statements.map(statement => statement.values.length)).toEqual([96, 96, 81]);
        expect(statements.every(statement => statement.values.slice(-80).every((value, index) => value === index + 100))).toBe(true);
        expect(convert).toHaveBeenCalledTimes(80);
        expect(scores).toEqual(Array.from({ length: 80 }, (_, index) => index));
    });

    it('preserves logical, null and string-pattern semantics through SQL compilation', () => {
        const { metadata } = mapping();
        const score = new FieldExpression('score');
        const predicate = score.in([null, undefined, 2]).and(score.eq(null)).not()
            .or(new FieldExpression('label').contains('HELLO%')).and(score.ne(undefined))
            .and(PredicateExpression.null('score', 'isNull'));
        const sql = new SelectSqlBuilder(sqliteDialect);
        const ordinary = sql.build(metadata, cloneQueryModel(createQueryModel(BindingRow), { predicate }));
        const bound = bindIncludeFilter(metadata, { predicate, orderings: [] });
        expect(sql.build(metadata, cloneQueryModel(createQueryModel(BindingRow), bound))).toEqual(ordinary);
        expect(ordinary.values).toEqual([102, '%hello~%%']);
        expect(() => bindIncludeFilter(metadata, {
            predicate: PredicateExpression.binary('score', 'in', 1), orderings: [],
        })).toThrow('The \'in\' operator for \'score\' requires an array value.');
    });

    it('owns mutable converted operands and isolates the values of each SQL statement', () => {
        const { model } = mapping();
        const bytes = new Uint8Array([7]);
        model.entity(BindingRow, entity => entity.property(row => row.score).hasColumnType('blob').hasConversion({
            toProvider: () => bytes, fromProvider: (value: Uint8Array) => value[0],
        }));
        const metadata = model.build().getEntity(BindingRow);
        const bound = bindIncludeFilter(metadata, { predicate: new FieldExpression('score').eq(7), orderings: [] });
        bytes[0] = 99;
        const sql = new SelectSqlBuilder(sqliteDialect);
        const query = cloneQueryModel(createQueryModel(BindingRow), bound);
        const first = sql.build(metadata, query);
        expect(first.values).toEqual([new Uint8Array([7])]);
        (first.values[0] as Uint8Array)[0] = 88;
        expect(sql.build(metadata, query).values).toEqual([new Uint8Array([7])]);
    });
});
