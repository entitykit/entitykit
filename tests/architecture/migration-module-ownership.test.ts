import { staticImportsOf } from './architecture-test-support';
import {
    testIdentifierBoundaries,
    testSizeBudgets,
} from './module-ownership-test-support';

describe('migration module ownership', () => {
    testIdentifierBoundaries([
        {
            file: 'src/migrations/migration-builder.ts',
            forbidden: ['ConstraintOps', 'IndexOps'],
        },
        {
            file: 'src/migrations/migration-builder-constraints.ts',
            forbidden: ['ColumnOps', 'TableOps'],
        },
        {
            file: 'src/migrations/model-diff-join-table-detector.ts',
            forbidden: ['renderColumnType', 'defaultForeignKeyName', 'singleKeyProperty'],
        },
        {
            file: 'src/migrations/model-diff-join-table-operation.ts',
            forbidden: ['joinTableSignature'],
        },
        {
            file: 'src/migrations/model-diff-table-detector.ts',
            forbidden: ['defaultIndexName', 'cloneModelSnapshot'],
        },
        {
            file: 'src/migrations/model-diff-rename-hints.ts',
            forbidden: ['createTableOperation', 'dropTableOperation'],
        },
        {
            file: 'src/migrations/model-differ.ts',
            forbidden: ['qualifiedName'],
        },
        {
            file: 'src/migrations/model-diff-operation-description.ts',
            forbidden: ['diffModelSnapshots', 'buildDiffOperations'],
        },
        {
            file: 'src/migrations/model-diff-apply.ts',
            forbidden: ['sourceConstraintName', 'targetConstraintName'],
        },
        {
            file: 'src/migrations/model-diff-apply-down.ts',
            forbidden: [
                'reverseAlterColumn',
                'reverseRebuild',
                'restoredIndex',
            ],
        },
        {
            file: 'src/migrations/migration-down-operation-renderer.ts',
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
            'src/migrations/model-diff-apply.ts',
            'src/migrations/model-diff-join-table-apply.ts',
        ],
    }]);

    it('keeps rename normalization explicit in model-diff orchestration', () => {
        expect(staticImportsOf('src/migrations/model-differ.ts'))
            .toContain('src/migrations/model-diff-rename-hints.ts');
    });

    it('shares migration object-name formatting across descriptions and warnings', () => {
        const owner = 'src/migrations/migration-object-name.ts';

        expect(staticImportsOf('src/migrations/model-diff-operation-description.ts'))
            .toContain(owner);
        expect(staticImportsOf('src/migrations/migration-scaffold-warnings.ts'))
            .toContain(owner);
    });
});
