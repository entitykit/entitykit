import { MigrationColumnBuilder } from '../src/migrations/migration-column-builder';
import type {
    MutableMigrationColumnDefinition,
} from '../src/migrations/migration-builder-types';

function build(
    configure: (builder: MigrationColumnBuilder) => void,
): MutableMigrationColumnDefinition {
    const definition: MutableMigrationColumnDefinition = {
        name: 'id',
        type: 'bigint',
    };
    configure(new MigrationColumnBuilder(definition));
    return definition;
}

describe('migration column builder', () => {
    it('chains nullability, primary key, default, computed, and collation metadata', () => {
        const definition = build(builder => {
            expect(builder.nullable()).toBe(builder);
            expect(builder.notNull()).toBe(builder);
            expect(builder.primaryKey()).toBe(builder);
            expect(builder.defaultSql('next_id()')).toBe(builder);
            expect(builder.computedSql('lower(name)', false)).toBe(builder);
            expect(builder.collation('en_US')).toBe(builder);
        });

        expect(definition).toEqual({
            name: 'id',
            type: 'bigint',
            nullable: false,
            primaryKey: true,
            defaultSql: 'next_id()',
            computedSql: 'lower(name)',
            computedStored: false,
            collation: 'en_US',
        });
    });

    it('stores computed columns by default', () => {
        expect(build(builder => builder.computedSql('first + last')))
            .toMatchObject({
                computedSql: 'first + last',
                computedStored: true,
            });
    });

    it('configures nullable and not-null columns independently', () => {
        expect(build(builder => builder.nullable())).toMatchObject({
            nullable: true,
        });
        expect(build(builder => builder.notNull())).toMatchObject({
            nullable: false,
        });
        expect(build(builder => builder.primaryKey())).toMatchObject({
            primaryKey: true,
            nullable: false,
        });
    });

    it('normalizes identity options and marks the column not null', () => {
        expect(build(builder => builder.generatedByIdentity({
            mode: 'always',
            startValue: 10n,
            incrementBy: 2,
            minValue: 1,
            maxValue: 100n,
            isCyclic: true,
            cache: 4,
        }))).toEqual({
            name: 'id',
            type: 'bigint',
            nullable: false,
            storeGeneration: {
                kind: 'identity',
                mode: 'always',
                startValue: '10',
                incrementBy: '2',
                minValue: '1',
                maxValue: '100',
                isCyclic: true,
                cache: 4,
            },
        });
        expect(build(builder => builder.generatedByIdentity()))
            .toMatchObject({
                nullable: false,
                storeGeneration: {
                    kind: 'identity',
                    mode: 'byDefault',
                    isCyclic: false,
                },
            });
    });

    it.each([
        ['auto increment', (builder: MigrationColumnBuilder) => builder.generatedByAutoIncrement(), { kind: 'autoIncrement' }],
        ['rowid', (builder: MigrationColumnBuilder) => builder.generatedByRowId(), { kind: 'rowid', preventReuse: false }],
        ['non-reusing rowid', (builder: MigrationColumnBuilder) => builder.generatedByRowId({ preventReuse: true }), { kind: 'rowid', preventReuse: true }],
        ['sequence', (builder: MigrationColumnBuilder) => builder.generatedBySequence('user_id_seq'), { kind: 'sequence', name: 'user_id_seq' }],
        ['qualified sequence', (builder: MigrationColumnBuilder) => builder.generatedBySequence('user_id_seq', 'app'), { kind: 'sequence', name: 'user_id_seq', schemaName: 'app' }],
    ] as const)('configures %s generation', (_name, configure, strategy) => {
        expect(build(configure)).toEqual({
            name: 'id',
            type: 'bigint',
            nullable: false,
            storeGeneration: strategy,
        });
    });
});
