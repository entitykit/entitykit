import { createSqliteDataSource, type SqliteDataSourceOptions } from '@entitykit/sqlite';
import { compileModel, DbContext, type CompiledModel, type DbContextOptionsBuilder } from '@entitykit/core';

const options: SqliteDataSourceOptions = { maxIdleConnections: 8, retry: { maxAttempts: 2 } };
const source = createSqliteDataSource('./app.db', options);
class Context extends DbContext {}
const context: Context = source.createContext(Context);
void context;
// @ts-expect-error idle retention is configured with an integer count
createSqliteDataSource('./app.db', { maxIdleConnections: '8' });
// @ts-expect-error the provider's options remain a known object contract
createSqliteDataSource('./app.db', { maxActiveConnections: 8 });

class CompiledRow { public id = 0; }
const model: CompiledModel = compileModel(builder => {
    builder.entity(CompiledRow, entity => {
        entity.hasKey(row => row.id);
        entity.property(row => row.id).hasColumnType('integer').isRequired();
    });
}, { provider: 'sqlite' });
class CompiledContext extends DbContext {
    public rows = this.set(CompiledRow);
    protected override configure(builder: DbContextOptionsBuilder): void {
        builder.useCompiledModel(model);
        // @ts-expect-error a structural lookalike is not a compiled-model handle
        builder.useCompiledModel({ provider: 'sqlite', dialect: 'sqlite' });
    }
}
const compiledContext: CompiledContext = source.createContext(CompiledContext);
void compiledContext;
