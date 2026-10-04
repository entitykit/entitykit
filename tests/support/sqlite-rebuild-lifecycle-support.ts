import type { DatabaseOperationOptions, DatabaseQueryResult, SqlStatement } from '../../packages/core/src/adapter';
import { SqliteDatabaseConnection, sqliteProviderServices } from '../../packages/sqlite/src';

type QueryHook = (statement: SqlStatement, options: DatabaseOperationOptions, result?: DatabaseQueryResult) => void | Promise<void>;

export class RebuildConnection extends SqliteDatabaseConnection {
    public beforeQuery?: QueryHook;
    public afterQuery?: QueryHook;
    public readonly calls: Array<{ text: string; signal?: AbortSignal; inTransaction: boolean }> = [];
    public disposed = false;
    public disposeFailure?: Error;

    constructor() {
        super(':memory:'); 
    }

    public override async query<TRow extends Record<string, unknown> = Record<string, unknown>>(
        statement: SqlStatement,
        options: DatabaseOperationOptions = {},
    ): Promise<DatabaseQueryResult<TRow>> {
        this.calls.push({ text: statement.text, signal: options.signal, inTransaction: this.isInTransaction });
        await this.beforeQuery?.(statement, options);
        const result = await super.query<TRow>(statement, options);
        await this.afterQuery?.(statement, options, result);
        return result;
    }

    public async rawQuery(text: string): Promise<DatabaseQueryResult> {
        return super.query({ text, values: [] });
    }

    public override async dispose(): Promise<void> {
        if (this.disposeFailure) throw this.disposeFailure;
        await this.forceClose();
    }

    public async forceClose(): Promise<void> {
        if (!this.disposed) {
            await super.dispose();
            this.disposed = true;
        }
    }
}

export async function seededRebuildConnection(): Promise<RebuildConnection> {
    const connection = new RebuildConnection();
    for (const text of [
        'create table parent (id text primary key, label text not null)',
        'create table child (id text primary key, parent_id text references parent(id) on delete cascade)',
        'insert into parent values (\'p\', \'kept\')',
        'insert into child values (\'c\', \'p\')',
    ]) {
        await connection.rawQuery(text);
    }
    return connection;
}

export function rebuildStatements(schemaName?: string): readonly SqlStatement[] {
    const builder = sqliteProviderServices.createMigrationBuilder();
    builder.rebuildTable({
        previous: {
            tableName: 'parent',
            schemaName,
            columns: [{ name: 'id', type: 'text', primaryKey: true }, { name: 'label', type: 'text' }],
            foreignKeys: [], checkConstraints: [], indexes: [],
        },
        current: {
            tableName: 'parent',
            schemaName,
            columns: [{ name: 'id', type: 'text', primaryKey: true }, { name: 'label', type: 'text', nullable: true }],
            foreignKeys: [], checkConstraints: [], indexes: [],
        },
        copyColumns: [{ source: 'id', target: 'id' }, { source: 'label', target: 'label' }],
        reverseCopyColumns: [{ source: 'id', target: 'id' }, { source: 'label', target: 'label' }],
    });
    return builder.statements;
}

export async function expectOriginalRebuildState(connection: RebuildConnection): Promise<void> {
    expect((await connection.rawQuery('select * from parent')).rows).toEqual([{ id: 'p', label: 'kept' }]);
    expect((await connection.rawQuery('select * from child')).rows).toEqual([{ id: 'c', parent_id: 'p' }]);
    expect((await connection.rawQuery('pragma foreign_key_check')).rows).toEqual([]);
    expect((await connection.rawQuery('pragma foreign_keys')).rows).toEqual([{ foreign_keys: 1 }]);
    expect(connection.isInTransaction).toBe(false);
    expect(connection.disposed).toBe(false);
    await expect(connection.rawQuery('update parent set label = null')).rejects.toThrow();
}
