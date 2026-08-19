/**
 * Shared type surface for db-pull code generation. It lives in its own leaf so
 * every emitter and the orchestrator depend on the same shapes without importing
 * one another, and so the public codegen types have a single definition site
 * that `DbPullCodeGenerator` re-exports as its frozen API surface.
 */
import type { DatabaseTable, DatabaseForeignKey } from './database-schema';

/** Options that configure db pull codegen. */ export interface DbPullCodegenOptions {
    /** The context name. */ readonly contextName?: string;
    /** The connection string expression. */ readonly connectionStringExpression?: string;
    /**
   * The provider the schema was pulled from, so the generated context wires the
   * matching adapter. Absent, it defaults to Postgres — the generated context
   * must never hardcode a provider that cannot reach the database it was pulled
   * from.
   */
    readonly providerName?: string;
}

/** Public contract for generated code file. */ export interface GeneratedCodeFile {
    /** The path. */ readonly path: string;
    /** The contents. */ readonly contents: string;
}

/** Public contract for db pull diagnostic. */ export interface DbPullDiagnostic {
    /** The severity. */ readonly severity: 'warning';
    /** The category. */ readonly category: 'generated-name' | 'table' | 'column' | 'index' | 'relationship' | 'unsupported-schema';
    /** Human-readable description of the result or failure. */ readonly message: string;
}

/** Result produced by db pull codegen. */ export interface DbPullCodegenResult {
    /** The files. */ readonly files: readonly GeneratedCodeFile[];
    /** The diagnostics. */ readonly diagnostics: readonly DbPullDiagnostic[];
}

export interface EntityShape {
    readonly table: DatabaseTable;
    readonly className: string;
    readonly setName: string;
    readonly propertiesByColumn: ReadonlyMap<string, string>;
}

export interface ManyToManyJoinShape {
    readonly joinTable: DatabaseTable;
    readonly source: EntityShape;
    readonly target: EntityShape;
    readonly sourceForeignKey: DatabaseForeignKey;
    readonly targetForeignKey: DatabaseForeignKey;
    readonly sourceNavigationName: string;
    readonly targetNavigationName: string;
}
