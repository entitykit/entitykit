import { combineIncludeKeyTerms, includeKeyPredicate } from '../packages/core/src/query/include-key-predicate';
import { includeKeyStatements } from '../packages/core/src/query/include-key-statements';
import type { PredicateNode } from '../packages/core/src/query/expression/predicate-node';
import { sqliteDialect } from '../packages/sqlite/src';
import { IncludePropertyLoader } from '../packages/core/src/query/include-loader-key-batch';
import { Materializer } from '../packages/core/src/materialization/materializer';
import { SelectSqlBuilder } from '../packages/core/src/sql/select-sql-builder';
import { NavigationWriteJournal } from '../packages/core/src/tracking/navigation-write-journal';
import { inertNavigationLoadTrackerJournal } from '../packages/core/src/tracking/navigation-load-tracker-journal';
import { contextModel, internalChangeTracker, setMetadata } from './support/public-api-internals';
import { openCompositeIncludeGraph, type IncludeBatchingContext } from './support/include-batching-context';

describe('include key planning bounds', () => {
    it('combines an odd number of keys with linear work and logarithmic depth', () => {
        const keys = Array.from({ length: 4_097 }, (_, id) => id);
        let combinations = 0;
        const combined = combineIncludeKeyTerms(keys.map(id => ({ ids: [id], depth: 0 })), (left, right) => {
            combinations++;
            return { ids: [...left.ids, ...right.ids], depth: 1 + Math.max(left.depth, right.depth) };
        });
        expect(combined.ids).toEqual(keys);
        expect(combinations).toBe(keys.length - 1);
        expect(combined.depth).toBeLessThanOrEqual(Math.ceil(Math.log2(keys.length)));
        expect(combineIncludeKeyTerms(['only'], () => 'combined')).toBe('only');
        expect(() => combineIncludeKeyTerms([], () => '')).toThrow('requires at least one term');
    });

    it('balances both tuple comparisons and the composite disjunction', () => {
        const keys = Array.from({ length: 4_097 }, (_, id) => [id, id + 1, id + 2]);
        const expression = includeKeyPredicate(['first', 'second', 'third'], keys);
        const pending: Array<{ node: PredicateNode; depth: number }> = [{ node: expression.node, depth: 0 }];
        let depth = 0;
        const values: unknown[] = [];
        while (pending.length) {
            const item = pending.pop();
            if (!item) throw new Error('Missing predicate node');
            depth = Math.max(depth, item.depth);
            if (item.node.kind === 'logical') pending.push({ node: item.node.right, depth: item.depth + 1 }, { node: item.node.left, depth: item.depth + 1 });
            else if (item.node.kind === 'binary') values.push(item.node.value);
        }
        expect(depth).toBeLessThanOrEqual(15);
        expect(values).toEqual(keys.flat());
    });

    it('budgets the actual filter bindings and preserves complete key order', () => {
        const statements = [...includeKeyStatements({ ...sqliteDialect, maxStatementParameters: () => 6 },
            [1, 2, 3, 4, 5, 6, 7], 1, keys => ({ text: 'query', values: [...keys, 'filter', 'tenant'] }))];
        expect(statements.map(statement => statement.values)).toEqual([
            [1, 2, 3, 4, 'filter', 'tenant'], [5, 6, 7, 'filter', 'tenant'],
        ]);
        expect([...includeKeyStatements(sqliteDialect, [], 1, () => {
            throw new Error('An empty set must not compile a statement');
        })]).toEqual([]);
    });

    it('keeps expression bounds without a provider parameter cap', () => {
        const unlimited = { ...sqliteDialect, maxStatementParameters: undefined };
        const keys = Array.from({ length: 1_001 }, (_, id) => [id, id]);
        const statements = [...includeKeyStatements(unlimited, keys, 2,
            chunk => ({ text: 'query', values: chunk.flat() }))];
        expect(statements).toHaveLength(4);
        expect(statements.every(statement => statement.values.length <= 512)).toBe(true);
        expect(statements.flatMap(statement => statement.values)).toEqual(keys.flat());
        const build = jest.fn((chunk: readonly number[]) => ({ text: 'query', values: chunk }));
        expect([...includeKeyStatements(unlimited, [1, 2, 3], 1, build)]).toHaveLength(1);
        expect(build).toHaveBeenCalledTimes(1);
    });

    it('reuses a single-key statement and refuses filters that exhaust the budget', () => {
        const build = jest.fn((keys: readonly number[]) => {
            if (keys.length === 0) throw new Error('A statement must retain a parent key');
            return { text: 'query', values: [...keys, 'filter'] };
        });
        expect([...includeKeyStatements(sqliteDialect, [1], 1, build)]).toEqual([{ text: 'query', values: [1, 'filter'] }]);
        expect(build).toHaveBeenCalledTimes(1);
        expect(() => [...includeKeyStatements({ ...sqliteDialect, maxStatementParameters: () => 1 }, [1], 1, build)])
            .toThrow('leave no room for a parent key');
    });

    it('compiles distinct keys when the budget permits only one key per statement', () => {
        expect([...includeKeyStatements({ ...sqliteDialect, maxStatementParameters: () => 1 },
            [1, 2, 3], 1, keys => ({ text: 'query', values: keys }))].map(statement => statement.values))
            .toEqual([[1], [2], [3]]);
    });

    it.each([{ limit: 1, offset: undefined, count: 1 }, { limit: undefined, offset: 500, count: 101 }])(
        'preserves a global window across all supplied tuples: %j', async window => {
            const db = await openCompositeIncludeGraph(601);
            const queries = jest.spyOn(db.database.connection, 'query');
            try {
                const loader = createPropertyLoader(db);
                const keys = Array.from({ length: 601 }, (_, index) => [(index + 1) % 2, Math.floor((index + 2) / 2)]);
                const metadata = setMetadata(db.compositeParents);
                const loaded = await loader.loadByProperties(metadata, ['scope', 'id'], keys,
                    { orderings: [], limit: window.limit, offset: window.offset });
                expect(loaded).toHaveLength(window.count);
                expect(queries).toHaveBeenCalledTimes(1);
                await expect(loader.loadByProperties(metadata, ['scope', 'id'], [], { orderings: [], limit: 1 }))
                    .resolves.toEqual([]);
                expect(queries).toHaveBeenCalledTimes(1);
            } finally {
                queries.mockRestore(); await db.dispose();
            }
        });
});

function createPropertyLoader(db: IncludeBatchingContext): IncludePropertyLoader {
    return new IncludePropertyLoader({
        model: contextModel(db), database: db.database.connection,
        changeTracker: internalChangeTracker(db.changeTracker), dialect: sqliteDialect,
        selectSql: new SelectSqlBuilder(sqliteDialect), materializer: new Materializer(),
        journal: new NavigationWriteJournal(), trackerJournal: inertNavigationLoadTrackerJournal,
        fixupTrackedGraph: true, preservePendingRelationships: false,
    });
}
