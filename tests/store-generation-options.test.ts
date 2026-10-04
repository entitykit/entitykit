import { ModelValidationError } from '../packages/core/src';
import { ModelBuilder } from '../packages/core/src/model/model-builder';
import type { IdentityColumnOptions } from '../packages/core/src/model/store-generation';
import { identityGeneration, validateStoreGeneration } from '../packages/core/src/model/store-generation';
import { requireDefined } from './support/require-defined';

class BookNumber {
    public id!: number;
}

function configured(options: IdentityColumnOptions, builder = new ModelBuilder()): ModelBuilder {
    return builder.entity(BookNumber, entity => {
        entity.toTable('book_numbers');
        entity.hasKey(row => row.id);
        entity.property(row => row.id).hasColumnType('integer').useIdentityColumn(options);
    });
}

const invalidPolicies = [
    ['mode', 'alwayz', 'Identity mode'], ['mode', '', 'Identity mode'],
    ['mode', null, 'Identity mode'], ['mode', 1, 'Identity mode'],
    ['isCyclic', 'false', 'Identity cycling'], ['isCyclic', 0, 'Identity cycling'],
    ['isCyclic', 1, 'Identity cycling'], ['isCyclic', null, 'Identity cycling'],
] as const;

describe('store generation option boundaries', () => {
    it.each(invalidPolicies)('refuses malformed %s=%p before enrolling model configuration', (field, value, message) => {
        const builder = new ModelBuilder();
        const options = { [field]: value } as unknown as IdentityColumnOptions;
        expect(() => configured(options, builder)).toThrow(message);
        expect(() => builder.build()).toThrow(ModelValidationError);
    });

    it.each(invalidPolicies)('refuses malformed canonical identity %s=%p', (field, value, message) => {
        const strategy = { ...identityGeneration(), [field]: value };
        expect(() => {
            validateStoreGeneration(strategy);
        }).toThrow(message);
    });

    it.each([
        [{}, { mode: 'byDefault', isCyclic: false }],
        [{ mode: undefined, isCyclic: undefined }, { mode: 'byDefault', isCyclic: false }],
        [{ mode: 'always', isCyclic: false }, { mode: 'always', isCyclic: false }],
        [{ mode: 'byDefault', isCyclic: true }, { mode: 'byDefault', isCyclic: true }],
    ] as const)('preserves valid identity policy %p', (options, expected) => {
        const property = requireDefined(configured(options).build().toSnapshot().entities[0]?.properties[0]);
        expect(property.storeGeneration).toMatchObject({ kind: 'identity', ...expected });
    });

    it.each([
        ['startValue', 'Identity start value'], ['incrementBy', 'Identity increment'],
        ['minValue', 'Identity minimum'], ['maxValue', 'Identity maximum'],
    ] as const)(
        'refuses unsafe numeric %s values', (field, label) => {
            for (const value of [0.5, Infinity, -Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
                expect(() => configured({ [field]: value })).toThrow(`${label} must be a safe integer or bigint.`);
            }
        },
    );

    it.each([0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('refuses invalid identity cache %p', cache => {
        expect(() => configured({ cache })).toThrow('Identity cache must be a positive safe integer');
    });

    it.each([
        [{ incrementBy: 0 }, 'Identity increment must not be zero'],
        [{ incrementBy: 0n }, 'Identity increment must not be zero'],
        [{ minValue: 2, maxValue: 1 }, 'Identity minimum must be less than its maximum'],
        [{ minValue: 0, maxValue: 0 }, 'Identity minimum must be less than its maximum'],
        [{ startValue: 1, minValue: 2 }, 'Identity start value must not be below its minimum'],
        [{ startValue: 2, maxValue: 1 }, 'Identity start value must not exceed its maximum'],
    ] as const)('refuses inconsistent identity options %p', (options, message) => {
        expect(() => configured(options).build()).toThrow(message);
    });

    it('retains exact bigint values and inclusive zero bounds', () => {
        expect(identityGeneration({ startValue: 0, minValue: 0, maxValue: 1, incrementBy: -1, cache: 1 }))
            .toMatchObject({ startValue: '0', minValue: '0', maxValue: '1', incrementBy: '-1', cache: 1 });
        expect(identityGeneration({ startValue: 9_007_199_254_740_993n, minValue: -9_007_199_254_740_993n }))
            .toMatchObject({ startValue: '9007199254740993', minValue: '-9007199254740993' });
        expect(identityGeneration({ startValue: 1, minValue: 0, maxValue: 1 }))
            .toMatchObject({ startValue: '1', minValue: '0', maxValue: '1' });
    });

    it.each(['startValue', 'incrementBy', 'minValue', 'maxValue'] as const)(
        'refuses malformed serialized %s before rendering generation SQL', field => {
            for (const value of ['1.5', '+1', '1e3', 'NaN', '', '--1']) {
                const strategy = { ...identityGeneration(), [field]: value };
                expect(() => {
                    validateStoreGeneration(strategy);
                }).toThrow('must be an integer');
            }
        },
    );

    it.each([
        ['', undefined, 'Sequence name'], [' \t ', undefined, 'Sequence name'],
        ['book_numbers', '', 'Sequence schema'], ['book_numbers', ' \t ', 'Sequence schema'],
    ] as const)('refuses blank canonical sequence reference %p in %p', (name, schemaName, label) => {
        expect(() => {
            validateStoreGeneration({ kind: 'sequence', name, schemaName });
        }).toThrow(`${label} must not be empty.`);
    });

    it.each([undefined, ' catalog '])('preserves valid canonical sequence schema %p', schemaName => {
        const strategy = { kind: 'sequence' as const, name: ' book_numbers ', schemaName };
        expect(() => {
            validateStoreGeneration(strategy);
        }).not.toThrow();
        expect(strategy).toEqual({ kind: 'sequence', name: ' book_numbers ', schemaName });
    });

    it('preserves a generated property whose sequence uses the default schema', () => {
        const model = new ModelBuilder().hasSequence('book_numbers').entity(BookNumber, entity => {
            entity.toTable('book_number_rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer').useSequence('book_numbers');
        }).build();
        expect(model.toSnapshot().entities[0]?.properties[0]?.storeGeneration)
            .toMatchObject({ kind: 'sequence', name: 'book_numbers', schemaName: undefined });
    });
});
