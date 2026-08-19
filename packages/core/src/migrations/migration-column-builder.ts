import type { MutableMigrationColumnDefinition } from './migration-builder-types';
import type {
    IdentityColumnOptions,
    RowIdColumnOptions,
} from '../model/store-generation';
import { identityGeneration } from '../model/store-generation';

/**
 * WHY: Owns the fluent single-column DSL used inside a `createTable` callback
 * (`table.column("id", "uuid").primaryKey()`). Split from the table builder and
 * the top-level `MigrationBuilder` so each of the three builder classes owns one
 * concern: this one mutates a single column definition in place.
 */
export class MigrationColumnBuilder {
    constructor(private readonly columnDefinition: MutableMigrationColumnDefinition) {}

    public nullable(): this {
        this.columnDefinition.nullable = true;
        return this;
    }

    public notNull(): this {
        this.columnDefinition.nullable = false;
        return this;
    }

    public primaryKey(): this {
        this.columnDefinition.primaryKey = true;
        this.columnDefinition.nullable = false;
        return this;
    }

    public defaultSql(sql: string): this {
        this.columnDefinition.defaultSql = sql;
        return this;
    }

    public computedSql(sql: string, stored = true): this {
        this.columnDefinition.computedSql = sql;
        this.columnDefinition.computedStored = stored;
        return this;
    }

    public collation(name: string): this {
        this.columnDefinition.collation = name;
        return this;
    }

    public generatedByIdentity(options: IdentityColumnOptions = {}): this {
        this.columnDefinition.storeGeneration = identityGeneration(options);
        return this.generated();
    }

    public generatedByAutoIncrement(): this {
        this.columnDefinition.storeGeneration = { kind: 'autoIncrement' };
        return this.generated();
    }

    public generatedByRowId(options: RowIdColumnOptions = {}): this {
        this.columnDefinition.storeGeneration = {
            kind: 'rowid',
            preventReuse: options.preventReuse ?? false,
        };
        return this.generated();
    }

    public generatedBySequence(name: string, schemaName?: string): this {
        this.columnDefinition.storeGeneration = {
            kind: 'sequence',
            name,
            schemaName,
        };
        return this.generated();
    }

    private generated(): this {
        this.columnDefinition.nullable = false;
        return this;
    }
}
