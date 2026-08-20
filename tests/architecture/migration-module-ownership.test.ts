import { staticImportsOf } from './architecture-test-support';
import {
    testIdentifierBoundaries,
    testSizeBudgets,
} from './module-ownership-test-support';

describe('migration module ownership', () => {
    testIdentifierBoundaries([
        {
            file: 'packages/core/src/migrations/migration-builder.ts',
            forbidden: ['ConstraintOps', 'IndexOps'],
        },
        {
            file: 'packages/core/src/migrations/migration-builder-constraints.ts',
            forbidden: ['ColumnOps', 'TableOps'],
        },
        {
            file: 'packages/core/src/migrations/model-diff-join-table-detector.ts',
            forbidden: ['renderColumnType', 'defaultForeignKeyName', 'singleKeyProperty'],
        },
        {
            file: 'packages/core/src/migrations/model-diff-join-table-operation.ts',
            forbidden: ['joinTableSignature'],
        },
        {
            file: 'packages/core/src/migrations/model-diff-table-detector.ts',
            forbidden: ['defaultIndexName', 'cloneModelSnapshot'],
        },
        {
            file: 'packages/core/src/migrations/model-diff-rename-hints.ts',
            forbidden: ['createTableOperation', 'dropTableOperation'],
        },
        {
            file: 'packages/core/src/migrations/model-differ.ts',
            forbidden: ['qualifiedName'],
        },
        {
            file: 'packages/core/src/migrations/model-diff-operation-description.ts',
            forbidden: ['diffModelSnapshots', 'buildDiffOperations'],
        },
        {
            file: 'packages/core/src/migrations/model-diff-apply.ts',
            forbidden: ['sourceConstraintName', 'targetConstraintName'],
        },
        {
            file: 'packages/core/src/migrations/model-diff-apply-down.ts',
            forbidden: [
                'reverseAlterColumn',
                'reverseRebuild',
                'restoredIndex',
            ],
        },
        {
            file: 'packages/core/src/migrations/migration-down-operation-renderer.ts',
            forbidden: [
                'renderRestoredTable',
                'reverseAlterColumn',
                'indexDefinition',
                'foreignKeyDefinition',
            ],
        },
    ]);

    testSizeBudgets([{
        maximumLines: 125,
        files: [
            'packages/core/src/migrations/model-diff-apply.ts',
            'packages/core/src/migrations/model-diff-join-table-apply.ts',
        ],
    }]);

    it('keeps rename normalization explicit in model-diff orchestration', () => {
        expect(staticImportsOf('packages/core/src/migrations/model-differ.ts'))
            .toContain('packages/core/src/migrations/model-diff-rename-hints.ts');
    });

    it('shares migration object-name formatting across descriptions and warnings', () => {
        const owner = 'packages/core/src/migrations/migration-object-name.ts';

        expect(staticImportsOf('packages/core/src/migrations/model-diff-operation-description.ts'))
            .toContain(owner);
        expect(staticImportsOf('packages/core/src/migrations/migration-scaffold-warnings.ts'))
            .toContain(owner);
    });
});
