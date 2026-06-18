import { postgresDialect, type SqlDialect } from '../sql/sql-dialect';
import type { MigrationBuilderOptions, MigrationSqlOptions, MigrationStatement } from './migration-builder-types';

/**
 * WHY: Holds the state and primitives every migration operation shares — the
 * collected statement list, the dialect, the provider capability flags, and the
 * low-level `emit`/`assertCapability`/`dropConstraint` helpers. The composing
 * `MigrationBuilder` owns one instance and passes it to each operation module,
 * so the operations can be split across files while still collecting into a
 * single statement list and consulting the same dialect and capabilities.
 * Internal only; not part of the public surface.
 */
export class MigrationBuilderCore {
    public readonly collectedStatements: MigrationStatement[] = [];
    public readonly dialect: SqlDialect;
    public readonly providerName: string;
    public readonly supportsExtensions: boolean;
    public readonly supportsConcurrentIndexes: boolean;
    public readonly supportsTransactionalDdl: boolean;
    public readonly supportsAlterTableConstraints: boolean;
    public readonly supportsColumnAlteration: boolean;
    public readonly supportsRenameIndex: boolean;
    public readonly requiresTableRebuild: boolean;

    constructor(
        dialect?: SqlDialect,
        options: MigrationBuilderOptions = {},
    ) {
        this.dialect = dialect ?? postgresDialect;
        this.providerName = options.providerName ?? this.dialect.name;
        this.supportsExtensions = options.supportsExtensions ?? dialect === undefined;
        this.supportsConcurrentIndexes = options.supportsConcurrentIndexes ?? dialect === undefined;
        this.supportsTransactionalDdl = options.supportsTransactionalDdl ?? true;
        this.supportsAlterTableConstraints = options.supportsAlterTableConstraints ?? true;
        this.supportsColumnAlteration = options.supportsColumnAlteration ?? true;
        this.supportsRenameIndex = options.supportsRenameIndex ?? true;
        this.requiresTableRebuild =
            this.providerName === 'sqlite' &&
            (!this.supportsColumnAlteration ||
                !this.supportsAlterTableConstraints);
    }

    /**
   * Append a SQL statement to the migration. This is the raw primitive the
   * operation modules use; the public fluent `MigrationBuilder.sql` delegates to
   * it and adds the `return this` chaining.
   */
    public emit(text: string, values?: readonly unknown[] | MigrationSqlOptions, options: MigrationSqlOptions = {}): void {
        const valuesAreArray = isUnknownArray(values);
        const actualValues = valuesAreArray ? values : [];
        const actualOptions: MigrationSqlOptions = valuesAreArray ? options : values ?? {};
        this.collectedStatements.push({
            text: text.trim(),
            values: [...actualValues],
            suppressTransaction: actualOptions.suppressTransaction,
        });
    }

    /** Emit provider DDL with its real transaction semantics attached. */
    public emitDdl(text: string, options: MigrationSqlOptions = {}): void {
        this.emit(text, {
            suppressTransaction:
        options.suppressTransaction === true || !this.supportsTransactionalDdl,
        });
    }

    /** Render `alter table ... <drop-constraint clause>`, provider-specific for the clause. */
    public dropConstraint(kind: 'primaryKey' | 'unique' | 'foreignKey' | 'check', tableName: string, constraintName: string, schemaName?: string): void {
        const table = this.dialect.quoteQualifiedIdentifier(schemaName, tableName);
        const quotedName = this.dialect.quoteIdentifier(constraintName);
        const clause = this.dialect.dropConstraintClause?.(kind, quotedName) ?? `drop constraint if exists ${quotedName}`;
        this.emitDdl(`alter table ${table} ${clause}`);
    }

    public assertCapability(supported: boolean, operation: string, nextAction: string): void {
        if (supported) {
            return;
        }

        throw new Error(`Migration operation '${operation}' is not supported by provider '${this.providerName}'. ${nextAction}`);
    }
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
    return Array.isArray(value);
}
