import { MigrationColumnBuilder } from './migration-column-builder';
import type { MigrationColumnDefinition, MutableMigrationColumnDefinition } from './migration-builder-types';

/**
 * WHY: Owns the fluent table DSL used by `MigrationBuilder.createTable` — it
 * accumulates column definitions and hands each one to a
 * {@link MigrationColumnBuilder}. Split from the top-level `MigrationBuilder` so
 * this class owns only "collect the columns for one new table"; the
 * `collectTableColumns` bridge that runs a callback against it lives here too
 * because it is meaningless without this builder.
 */
export type MigrationTableCallback = (table: MigrationTableBuilder) => void;

/**
 * Fluent column builder used by `MigrationBuilder.createTable`.
 */
export class MigrationTableBuilder {
    private readonly columns: MigrationColumnDefinition[] = [];

    /**
   * Add a column definition to the table being created.
   */
    public column(name: string, type: string): MigrationColumnBuilder {
        const column: MutableMigrationColumnDefinition = { name, type };
        this.columns.push(column);
        return new MigrationColumnBuilder(column);
    }

    public build(): readonly MigrationColumnDefinition[] {
        return this.columns.map(column => ({ ...column }));
    }
}

export function collectTableColumns(callback: MigrationTableCallback): readonly MigrationColumnDefinition[] {
    const table = new MigrationTableBuilder();
    callback(table);
    return table.build();
}
