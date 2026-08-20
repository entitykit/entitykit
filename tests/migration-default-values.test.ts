import type { EntitySnapshot, ModelSnapshot } from '../packages/core/src/tooling';
import {
    diffModelSnapshots,
    MigrationSqlGenerator,
    renderSnapshotSource,
} from '../packages/core/src/migrations/api';
import {
    arrayContaining,
    containing,
} from './support/jest-asymmetric-matchers';

const empty: ModelSnapshot = { formatVersion: 1, entities: [] };

function entityWithDefault(defaultValue: unknown): EntitySnapshot {
    return {
        entityName: 'Setting',
        tableName: 'settings',
        keyProperty: 'id',
        ignoredProperties: [],
        indexes: [],
        relationships: [],
        manyToManyRelationships: [],
        properties: [
            {
                propertyName: 'id',
                columnName: 'id',
                columnType: 'text',
                isRequired: true,
                isPrimaryKey: true,
                isUnique: false,
                hasConverter: false,
                isConcurrencyToken: false,
                isVersion: false,
            },
            {
                propertyName: 'value',
                columnName: 'value',
                columnType: 'jsonb',
                isRequired: true,
                isPrimaryKey: false,
                isUnique: false,
                hasConverter: false,
                isConcurrencyToken: false,
                isVersion: false,
                defaultValue,
            },
        ],
    };
}

describe('migration default values', () => {
    it.each([
        [{ source: 'O\'Brien', enabled: true }, '\'{"enabled":true,"source":"O\'\'Brien"}\''],
        [new Date('2026-07-29T12:34:56.000Z'), '\'2026-07-29T12:34:56.000Z\''],
        [9007199254740993n, '9007199254740993'],
    ])('uses schema-literal semantics for %#', (defaultValue, expected) => {
        const target: ModelSnapshot = {
            formatVersion: 1,
            entities: [entityWithDefault(defaultValue)],
        };
        expect(() => renderSnapshotSource(target)).not.toThrow();
        const diff = diffModelSnapshots(empty, target);
        const createTable = diff.operations.find(
            operation => operation.kind === 'createTable',
        );

        expect(createTable).toMatchObject({
            kind: 'createTable',
            columns: arrayContaining([
                containing({ name: 'value', defaultSql: expected }),
            ]),
        });

        const script = new MigrationSqlGenerator().generateUpScript(
            diff.toMigration('20260729000005_DefaultValues', 'DefaultValues'),
        );
        expect(script).toContain(`"value" jsonb not null default ${expected}`);
    });
});
