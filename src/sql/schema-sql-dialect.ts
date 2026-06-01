import type { AlterColumnChange } from './alter-column-change';
import type { StoreGenerationStrategy } from '../model/store-generation';

/** Public contract for sql sequence definition. */ export interface SqlSequenceDefinition {
    /** Stable name for this contract or database object. */ readonly name: string;
    /** The schema name. */ readonly schemaName?: string;
    /** The data type. */ readonly dataType?: 'smallint' | 'integer' | 'bigint';
    /** The start value. */ readonly startValue?: string;
    /** The increment by. */ readonly incrementBy?: string;
    /** The min value. */ readonly minValue?: string;
    /** The max value. */ readonly maxValue?: string;
    /** Whether cyclic. */ readonly isCyclic?: boolean;
    /** The cache. */ readonly cache?: number;
}

/** Optional DDL capabilities layered onto the core query dialect. */
export interface SchemaSqlDialect {
    /** Create index existence guard. */ createIndexExistenceGuard?(): string;
    /** Perform the generated column clause operation. */ generatedColumnClause?(expression: string, stored: boolean): string;
    /** Perform the store generation clause operation. */ storeGenerationClause?(
        strategy: StoreGenerationStrategy,
        column: { readonly type: string; readonly isPrimaryKey: boolean },
    ): string;
    /** Perform the index expression operation. */ indexExpression?(expression: string): string;
    /** Perform the index include clause operation. */ indexIncludeClause?(quotedColumns: readonly string[]): string;
    /** Perform the index filter clause operation. */ indexFilterClause?(sql: string): string;
    /** Create sequence statement. */ createSequenceStatement?(sequence: SqlSequenceDefinition): string;
    /** Perform the alter sequence statement operation. */ alterSequenceStatement?(
        current: SqlSequenceDefinition,
        previous: SqlSequenceDefinition,
    ): string;
    /** Perform the drop sequence statement operation. */ dropSequenceStatement?(sequence: SqlSequenceDefinition): string;
    /** Perform the drop constraint clause operation. */ dropConstraintClause?(
        kind: 'primaryKey' | 'unique' | 'foreignKey' | 'check',
        quotedName: string,
    ): string;
    /** Perform the alter column statements operation. */ alterColumnStatements?(
        quotedTable: string,
        quotedColumn: string,
        change: AlterColumnChange,
    ): readonly string[];
    /** Perform the alter store generation statements operation. */ alterStoreGenerationStatements?(
        quotedTable: string,
        quotedColumn: string,
        current: StoreGenerationStrategy | undefined,
        previous: StoreGenerationStrategy | undefined,
        columnType: string,
    ): readonly string[];
    /** Perform the drop index statement operation. */ dropIndexStatement?(
        quotedIndex: string,
        quotedTable: string | undefined,
        concurrently: boolean,
    ): string;
}
