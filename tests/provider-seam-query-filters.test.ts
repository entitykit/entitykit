import { readSource } from './support/provider-seam-test-support';

describe('provider seam architecture: query filters', () => {
    it('compiles every DbSet query through applyQueryFilters', () => {
        // Tenant isolation is only as good as the narrowest path to SQL. A new
        // read or bulk-write method that compiles a QueryModel directly would skip
        // the tenant predicate silently, so the seam is pinned structurally rather
        // than trusted per method.
        // Reads compile in DbSetQueryRunner; set-based writes filter in
        // DbSetBulkExecutor. Pin every compile path so none skips the predicate.
        const compileCalls = ['src/core/db-set-query-executor.ts', 'src/core/db-set-query-runner.ts']
            .map(readSource)
            .flatMap(source => [...source.matchAll(/this\.sql\(\)\.build\w*\(\s*this\.metadata,\s*([^)]+)\)/g)]
                .map(match => match[1].trim()));

        expect(compileCalls.length).toBeGreaterThan(0);
        for (const argument of compileCalls) {
            expect(argument === 'filteredModel' || argument.includes('applyQueryFilters')).toBe(true);
        }

        // The one indirect compiler, used by executeUpdate/executeDelete, filters
        // before handing the model to its callback.
        expect(readSource('src/core/db-set-bulk-executor.ts')).toMatch(
            /const filteredModel = this\.context\.applyQueryFilters\(this\.metadata, model\);\s+const shape = this\.diagnostics\.queryShape\(operation, filteredModel\);/,
        );
    });

    it('keeps tenant scope opt-out separate from the soft-delete opt-out', () => {
        // These are different kinds of thing: hiding deleted rows is a
        // convenience, confining a query to one tenant is an isolation boundary.
        // Collapsing them into one verb is what made "show me the deleted rows"
        // return every tenant's data.
        // The implicit-filter logic moved to QueryFilterApplier when DbContext was
        // decomposed; the separate-opt-outs invariant lives with it.
        const applier = readSource('src/core/query-filter-applier.ts');

        expect(applier).toContain('if (metadata.softDelete && applies.softDelete)');
        expect(applier).toContain('applies.tenant');
        expect(applier).not.toMatch(/if \(query\.ignoreQueryFilters\) \{\s*\n\s*return query;/);

        for (const file of ['src/query/queryable.ts', 'src/query/joined-query.ts', 'src/core/db-set.ts']) {
            const source = readSource(file);
            const ignoreFilters = (source.match(/ignoreQueryFilters\(\):/g) ?? []).length;
            const ignoreTenant = (source.match(/ignoreTenantScope\(\):/g) ?? []).length;
            expect(`${file}: ${String(ignoreTenant)}`).toBe(`${file}: ${String(ignoreFilters)}`);
        }
    });
});
