import type {
    DatabaseCheckConstraint,
    DatabaseColumn,
    DatabaseForeignKey,
    DatabaseIndex,
    DatabasePrimaryKey,
} from '@entitykit/core/adapter';

export interface MutablePostgresDatabaseTable {
    schemaName: string;
    tableName: string;
    objectType: 'table' | 'view';
    columns: DatabaseColumn[];
    primaryKey?: DatabasePrimaryKey;
    indexes: DatabaseIndex[];
    foreignKeys: DatabaseForeignKey[];
    checkConstraints: DatabaseCheckConstraint[];
}
