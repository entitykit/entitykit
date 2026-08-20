import type { ModelBuilder } from '../packages/core/src';
import { DbContext } from '../packages/core/src';
import { DbContextOptionsBuilder } from '../packages/core/src/core/context-options/db-context-options-builder';
import { contextOptions } from './support/public-api-internals';

/**
 * The `useSqlite()` / `useMySql()` convenience methods should be first-class
 * alongside `usePostgres()` — each resolving its built-in provider through the
 * lazy core bridge, so a driver is loaded only when the method is called.
 */
class Widget {
    public id!: string;
    public name!: string;

    constructor(data?: Partial<Widget>) {
        Object.assign(this, data);
    }
}

class WidgetDbContext extends DbContext {
    public widgets = this.set(Widget);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useSqlite(':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(Widget, entity => {
            entity.toTable('widgets');
            entity.hasKey(widget => widget.id);
            entity.property(widget => widget.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(widget => widget.name).hasColumnName('name').hasColumnType('text').isRequired();
        });
    }
}

describe('provider convenience methods', () => {
    it('useSqlite(\':memory:\') builds a working end-to-end context', async () => {
        const db =  WidgetDbContext.create();
        try {
            await db.database.connection.query({ text: 'create table widgets (id text primary key, name text not null)', values: [] });

            db.widgets.add(new Widget({ id: 'w1', name: 'First' }));
            await db.saveChanges();

            const loaded = await db.widgets.where(w => w.id.eq('w1')).single();
            expect(loaded.name).toBe('First');
            expect(contextOptions(db).dialect.name).toBe('sqlite');
        } finally {
            await db.dispose();
        }
    });

    it('useMySql(...) resolves the built-in MySQL provider without connecting', () => {
        const options = new DbContextOptionsBuilder()
            .useMySql('mysql://root:secret@127.0.0.1:3306/app')
            .build();
        try {
            expect(options.provider.provider).toBe('mysql');
            expect(options.dialect.name).toBe('mysql');
        } finally {
            void options.connection.dispose?.();
        }
    });

    it('rejects an empty connection string on every convenience method', () => {
        expect(() => new DbContextOptionsBuilder().usePostgres('')).toThrow(/Postgres connection string/);
        expect(() => new DbContextOptionsBuilder().useSqlite('')).toThrow(/SQLite connection string/);
        expect(() => new DbContextOptionsBuilder().useMySql('')).toThrow(/MySQL connection string/);
    });
});
