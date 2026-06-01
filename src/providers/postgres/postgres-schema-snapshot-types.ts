import type {
    DatabaseCheckConstraint,
    DatabaseColumn,
    DatabaseForeignKey,
    DatabaseIndex,
    DatabasePrimaryKey,
} from '../../introspection/database-schema';

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
