import { DbContext, type DbContextOptionsBuilder, type EntityKitDataSource } from '../packages/core/src';
import { createSqliteDataSource } from '../packages/sqlite/src';

class CustomizedContext extends DbContext {
    public configurations = 0;
    constructor(source: EntityKitDataSource, public readonly requestId: string) {
        super(source);
    }
    protected override configure(options: DbContextOptionsBuilder): void {
        this.configurations++;
        options.useAuditing();
    }
}
class BaseCallingContext extends CustomizedContext {
    protected override configure(options: DbContextOptionsBuilder): void {
        super.configure(options);
        options.useDiagnostics(() => undefined);
    }
}
class ConflictingContext extends DbContext {
    protected override configure(options: DbContextOptionsBuilder): void {
        options.useSqlite(':memory:');
    }
}
class LegacySourceContext extends DbContext {
    constructor(private readonly source: EntityKitDataSource) {
        super();
    }
    protected override configure(options: DbContextOptionsBuilder): void {
        options.useDataSource(this.source);
    }
}
class BaseHookContext extends DbContext {
    protected override configure(options: DbContextOptionsBuilder): void {
        super.configure(options);
        options.useAuditing();
    }
}

describe('constructor source initialization', () => {
    it.each([CustomizedContext, BaseCallingContext])('applies the source before customization in %p', async Context => {
        const source = createSqliteDataSource(':memory:');
        try {
            await using db = source.createContext(Context, 'request-1');
            expect(db.requestId).toBe('request-1');
            expect(db.configurations).toBe(1);
            expect((await db.database.connection.query({ text: 'select 1 as value', values: [] })).rows).toEqual([{ value: 1 }]);
            expect(db.configurations).toBe(1);
        } finally {
            await source.dispose();
        }
    });

    it.each([LegacySourceContext, BaseHookContext])('preserves explicit source selection and harmless base calls in %p', async Context => {
        const source = createSqliteDataSource(':memory:');
        try {
            await using db = source.createContext<DbContext, []>(Context);
            expect((await db.database.connection.query({ text: 'select 1 as value', values: [] })).rows).toHaveLength(1);
        } finally {
            await source.dispose();
        }
    });

    it('rejects conflicting configuration before acquiring a source lease', async () => {
        const source = createSqliteDataSource(':memory:');
        const acquire = jest.spyOn(source, 'createConnection');
        expect(() => source.createContext(ConflictingContext)).toThrow('Choose exactly one provider, data source, or connection');
        expect(acquire).not.toHaveBeenCalled();
        await expect(source.dispose()).resolves.toBeUndefined();
    });
});
