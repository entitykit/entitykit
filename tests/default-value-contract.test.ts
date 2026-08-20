import { ModelBuilder as ModelBuilderImplementation } from '../packages/core/src/model/model-builder';import type { ModelSnapshot } from '../packages/core/src/tooling';
import { createModelSnapshot } from '../packages/core/src/model/model-snapshot';
import {
    diffModelSnapshots,
    MigrationSqlGenerator,
    renderSnapshotSource,
} from '../packages/core/src/migrations/api';

class Setting {
    public id!: string;
    public value!: unknown;
}

function snapshotWithDefault(defaultValue: unknown): ModelSnapshot {
    const builder = new ModelBuilderImplementation();
    builder.entity(Setting, entity => {
        entity.toTable('settings');
        entity.hasKey(setting => setting.id);
        entity.property(setting => setting.id)
            .hasColumnName('id')
            .hasColumnType('text')
            .isRequired();
        entity.property(setting => setting.value)
            .hasColumnName('value')
            .hasColumnType('bigint')
            .isRequired()
            .hasDefaultValue(defaultValue);
    });
    return createModelSnapshot(builder.build());
}

describe('default value contract', () => {
    it('preserves bigint semantics through snapshots and migration generation', () => {
        const snapshot = snapshotWithDefault(9007199254740993n);
        const value = snapshot.entities[0]?.properties.find(
            property => property.propertyName === 'value',
        )?.defaultValue;

        expect(value).toEqual({
            $entitykitDefaultType: 'bigint',
            value: '9007199254740993',
        });
        expect(renderSnapshotSource(snapshot)).toContain(
            '"$entitykitDefaultType": "bigint"',
        );

        const migration = diffModelSnapshots(
            { formatVersion: 1, entities: [] },
            snapshot,
        ).toMigration('20260729000006_BigIntDefault', 'BigIntDefault');
        expect(new MigrationSqlGenerator().generateUpScript(migration))
            .toContain('"value" bigint not null default 9007199254740993');
    });

    it.each([
        [Number.NaN, 'NaN'],
        [Number.POSITIVE_INFINITY, 'Infinity'],
        [new Date('invalid'), 'invalid Date'],
        [new Map([['role', 'admin']]), 'Map'],
        [{ values: [1n] }, 'nested bigint'],
        [{ value: undefined }, 'undefined'],
        [Symbol('default'), 'symbol'],
        [() => 'computed', 'function'],
    ])('rejects unsupported defaults before model construction', (
        defaultValue,
        message,
    ) => {
        expect(() => snapshotWithDefault(defaultValue)).toThrow(message);
    });

    it('rejects cyclic JSON defaults with a useful path', () => {
        const cyclic: { self?: unknown } = {};
        cyclic.self = cyclic;

        expect(() => snapshotWithDefault(cyclic))
            .toThrow('defaultValue.self (cyclic reference)');
    });

    it('consumes rejected nested default Promises during validation', async () => {
        const unhandled: unknown[] = [];
        const observeUnhandled = (reason: unknown): void => {
            unhandled.push(reason);
        };
        process.on('unhandledRejection', observeUnhandled);
        try {
            const failed = Promise.reject(new Error('default failed'));

            expect(() => snapshotWithDefault({ nested: failed })).toThrow(
                'defaultValue.nested (Promise or thenable)',
            );
            await new Promise<void>(resolve => setImmediate(resolve));

            expect(unhandled).toEqual([]);
        } finally {
            process.off('unhandledRejection', observeUnhandled);
        }
    });

    it('rejects decorated default arrays and consumes their rejected Promises', async () => {
        const unhandled: unknown[] = [];
        const observeUnhandled = (reason: unknown): void => {
            unhandled.push(reason);
        };
        process.on('unhandledRejection', observeUnhandled);
        try {
            const extra = [1] as unknown[] & { extra?: unknown };
            extra.extra = Promise.reject(new Error('array extra failed'));
            const symbol = Symbol('hidden');
            const symbolKey = Object.assign([1], {
                [symbol]: Promise.reject(new Error('array symbol failed')),
            });

            expect(() => snapshotWithDefault(extra)).toThrow(
                'defaultValue (extra array property \'extra\')',
            );
            expect(() => snapshotWithDefault(symbolKey)).toThrow(
                'defaultValue (symbol-keyed property)',
            );
            await new Promise<void>(resolve => setImmediate(resolve));
            expect(unhandled).toEqual([]);
        } finally {
            process.off('unhandledRejection', observeUnhandled);
        }
    });

    it('rejects sparse and accessor-backed default arrays', () => {
        const sparse: unknown[] = [];
        sparse.length = 2;
        sparse[1] = 'present';
        const accessor = [1];
        Object.defineProperty(accessor, '0', {
            enumerable: true,
            get: () => 1,
        });

        expect(() => snapshotWithDefault(sparse)).toThrow(
            'defaultValue[0] (missing array element)',
        );
        expect(() => snapshotWithDefault(accessor)).toThrow(
            'defaultValue[0] (accessor property)',
        );
    });
});
