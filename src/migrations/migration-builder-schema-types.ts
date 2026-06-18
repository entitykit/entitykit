import type {
    MigrationColumnDefinition,
    MigrationIndexDefinition,
    MigrationTableForeignKey,
} from './migration-builder-types';

/** Public contract for migration check constraint. */ export interface MigrationCheckConstraint {
    /** Stable name for this contract or database object. */ readonly name: string;
    /** The sql. */ readonly sql: string;
}

/** Public contract for migration sequence definition. */ export interface MigrationSequenceDefinition {
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

/** Public contract for migration table copy column. */ export interface MigrationTableCopyColumn {
    /** The source. */ readonly source: string;
    /** The target. */ readonly target: string;
}

/** Public contract for migration table shape. */ export interface MigrationTableShape {
    /** The table name. */ readonly tableName: string;
    /** The schema name. */ readonly schemaName?: string;
    /** The columns. */ readonly columns: readonly MigrationColumnDefinition[];
    /** The foreign keys. */ readonly foreignKeys: readonly MigrationTableForeignKey[];
    /** The check constraints. */ readonly checkConstraints: readonly MigrationCheckConstraint[];
    /** The indexes. */ readonly indexes: readonly MigrationIndexDefinition[];
}

/** Public contract for migration table rebuild definition. */ export interface MigrationTableRebuildDefinition {
    /** The previous. */ readonly previous: MigrationTableShape;
    /** The current. */ readonly current: MigrationTableShape;
    /** The copy columns. */ readonly copyColumns: readonly MigrationTableCopyColumn[];
    /** The reverse copy columns. */ readonly reverseCopyColumns: readonly MigrationTableCopyColumn[];
}
