import { readSource } from './support/provider-seam-test-support';

describe('provider seam architecture: dialects', () => {
    it('keeps idempotent script block syntax in the migration dialect', () => {
        const generator = readSource('packages/core/src/migrations/migration-script-renderer.ts');
        const dialect = readSource('packages/core/src/migrations/migration-sql-dialect.ts');

        expect(generator).toContain('renderIdempotentMigrationBlock');
        expect(generator).not.toContain('do $entitykit$');
        expect(dialect).toContain('do $entitykit$');
    });

    it('keeps provider-specific migration helpers opt-in instead of dialect-name inferred', () => {
    // The capability flags moved to MigrationBuilderCore when the builder was
    // decomposed; the opt-in-not-inferred invariant lives with them.
        const builder = readSource('packages/core/src/migrations/migration-builder-core.ts');
        const postgresProvider = readSource('packages/postgres/src/postgres-provider-services.ts');

        expect(builder).not.toMatch(/dialect\.name\s*===\s*postgresDialect\.name/);
        expect(builder).toContain('supportsExtensions = options.supportsExtensions');
        expect(builder).toContain('supportsConcurrentIndexes = options.supportsConcurrentIndexes');
        expect(postgresProvider).toContain('supportsConcurrentIndexes: true');
        expect(postgresProvider).toContain('supportsExtensions: true');
    });

    it('keeps cross-provider ordering parity in the dialect, not inferred from the provider name', () => {
        const selectSql = readSource('packages/core/src/sql/select/fragment-renderer.ts');
        const sqliteDialect = readSource('packages/sqlite/src/sqlite-dialect.ts');
        const coreDialect = readSource('packages/core/src/sql/sql-dialect.ts');

        // The builder asks the dialect; it must not branch on which provider it is.
        expect(selectSql).toContain('nullOrderingClause');
        expect(selectSql).not.toMatch(/dialect\.name\s*===\s*"sqlite"/);
        // Both shipped dialects answer, so the behavior is declared rather than assumed.
        expect(coreDialect).toContain('nullOrderingClause');
        expect(sqliteDialect).toContain('nullOrderingClause');
    });

    it('keeps paging parity in the dialect and renders limit/offset in one place', () => {
        const selectSql = readSource('packages/core/src/sql/select/fragment-renderer.ts');

        // One renderer, so the three query shapes cannot drift apart.
        expect(selectSql).toContain('pushLimitAndOffset');
        expect(selectSql.match(/parts\.push\(`offset /g) ?? []).toHaveLength(1);
        expect(selectSql).toContain('unlimitedLimitLiteral');
        // SQLite and MySQL both reject a bare `offset` and must supply the literal.
        expect(readSource('packages/sqlite/src/sqlite-dialect.ts')).toContain('unlimitedLimitLiteral');
        expect(readSource('packages/mysql/src/mysql-dialect.ts')).toContain('unlimitedLimitLiteral');
    });

    it('keeps provider text-matching parity in the provider connection', () => {
        const sqliteConnection = readSource('packages/sqlite/src/sqlite-database-connection.ts');

        // SQLite's LIKE is case-insensitive by default; the provider owns bringing
        // it in line rather than the query builder rewriting predicates.
        expect(sqliteConnection).toContain('case_sensitive_like');
        expect(readSource('packages/core/src/sql/predicate-sql-compiler.ts')).not.toContain('case_sensitive_like');
    });
});
