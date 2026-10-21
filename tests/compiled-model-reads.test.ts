import {
    compileModel, DbContext, type DbContextOptionsBuilder, type ModelBuilder,
} from '../packages/core/src';
import { createSqliteDataSource } from '../packages/sqlite/src';
import { requireDefined } from './support/require-defined';

class TypedRow {
    public id = 0;
    public enabled = false;
    public timestamp: Date | null = null;
    public document = { nested: [0] };
    public payload: Uint8Array | null = null;
    public ['__proto__'] = '';
}
function typedMapping(model: ModelBuilder): void {
    model.entity(TypedRow, entity => {
        entity.toTable('typed_rows').hasKey(row => row.id);
        entity.property(row => row.id).hasColumnType('integer').isRequired();
        entity.property(row => row.enabled).hasColumnType('boolean').isRequired();
        entity.property(row => row.timestamp).hasColumnType('timestamp');
        entity.property(row => row.document).hasColumnType('json').isRequired();
        entity.property(row => row.payload).hasColumnType('blob');
        entity.property(row => row.__proto__).hasColumnType('text').isRequired();
    });
}

describe('reads through explicitly compiled metadata', () => {
    it('preserves typed decoding, special keys, owned facts, attachment and stored updates', async () => {
        const handle = compileModel(typedMapping, { provider: 'sqlite' });
        class Context extends DbContext {
            public rows = this.set(TypedRow);
            protected override configure(options: DbContextOptionsBuilder): void {
                options.useCompiledModel(handle);
            }
        }
        const source = createSqliteDataSource(':memory:');
        const db = source.createContext(Context);
        try {
            await db.database.connection.query({ text: 'create table typed_rows (id integer primary key, enabled boolean not null, timestamp text, document text not null, payload blob, "__proto__" text not null)', values: [] });
            await db.database.connection.query({ text: 'insert into typed_rows values (?, ?, ?, ?, ?, ?)', values: [1, 1, '2020-01-02T03:04:05.000Z', '{"nested":[1,2]}', new Uint8Array([1, 2, 3]), 'safe'] });
            const first = await db.rows.asNoTracking().single();
            const second = await db.rows.asNoTracking().single();
            expect(first).not.toBe(second);expect(first.enabled).toBe(true);
            expect(first.timestamp).toEqual(new Date('2020-01-02T03:04:05.000Z'));
            expect(first.document).toEqual({ nested: [1, 2] });
            expect([...requireDefined(first.payload)]).toEqual([1, 2, 3]);
            expect(Object.hasOwn(first, '__proto__')).toBe(true);expect(first.__proto__).toBe('safe');
            expect(Object.getPrototypeOf(first)).toBe(TypedRow.prototype);
            first.document.nested.push(3);requireDefined(first.payload)[0] = 9;requireDefined(first.timestamp).setUTCFullYear(2030);
            expect(second.document).toEqual({ nested: [1, 2] });expect(requireDefined(second.payload)[0]).toBe(1);
            expect(requireDefined(second.timestamp).getUTCFullYear()).toBe(2020);
            db.rows.attach(second);second.document.nested.push(4);second.__proto__ = 'updated';
            expect(await db.saveChanges()).toBe(1);
            const projection = await db.rows.select(row => ({ document: row.document, enabled: row.enabled })).single();
            expect(projection).toEqual({ document: { nested: [1, 2, 4] }, enabled: true });
            const stored = await db.database.connection.query({ text: 'select * from typed_rows', values: [] });
            expect(JSON.parse(stored.rows[0].document as string)).toEqual({ nested: [1, 2, 4] });
            expect(stored.rows[0].__proto__).toBe('updated');
            expect([...stored.rows[0].payload as Uint8Array]).toEqual([1, 2, 3]);
        } finally {
            await db.dispose();await source.dispose();
        }
    });

    it('keeps include identity and failure-atomic relationship writes', async () => {
        let refuse = true;
        const parents: Parent[] = [], children: Child[] = [];
        class Parent {
            public id = 0;
            public children: Child[] = [];
            constructor() {
                parents.push(this);
            }
        }
        class Child {
            public id = 0;
            public parentId = 0;
            private currentParent?: Parent;
            constructor() {
                children.push(this);
            }
            public get parent(): Parent | undefined {
                return this.currentParent;
            }
            public set parent(value: Parent | undefined) {
                if (refuse && value && this.id === 2) throw new Error('refused parent');
                this.currentParent = value;
            }
        }
        const handle = compileModel(model => {
            model.entity(Parent, entity => {
                entity.toTable('parents').hasKey(row => row.id);
                entity.property(row => row.id).hasColumnType('integer').isRequired();
            });
            model.entity(Child, entity => {
                entity.toTable('children').hasKey(row => row.id);
                entity.property(row => row.id).hasColumnType('integer').isRequired();
                entity.property(row => row.parentId).hasColumnType('integer').isRequired();
                entity.hasOne(Parent, row => row.parent).withMany(row => row.children).hasForeignKey(row => row.parentId);
            });
        }, { provider: 'sqlite' });
        class Context extends DbContext {
            public parents = this.set(Parent);
            protected override configure(options: DbContextOptionsBuilder): void {
                options.useCompiledModel(handle);
            }
        }
        const source = createSqliteDataSource(':memory:'), db = source.createContext(Context);
        try {
            await db.database.connection.query({ text: 'create table parents (id integer primary key); create table children (id integer primary key, parentId integer not null); insert into parents values (1); insert into children values (1,1),(2,1)', values: [] });
            await expect(db.parents.asNoTracking().include(row => row.children.orderBy(child => child.id)).toArray()).rejects.toThrow('refused parent');
            expect(parents).toHaveLength(1);expect(parents[0].children).toEqual([]);
            expect(children).toHaveLength(2);expect(children.every(child => child.parent === undefined)).toBe(true);
            expect(db.changeTracker.entries()).toHaveLength(0);
            refuse = false;
            const [loaded] = await db.parents.asNoTracking().include(row => row.children.orderBy(child => child.id)).toArray();
            expect(loaded).not.toBe(parents[0]);expect(loaded.children.map(child => child.id)).toEqual([1, 2]);
            expect(loaded.children.every(child => child.parent === loaded)).toBe(true);
            expect(db.changeTracker.entries()).toHaveLength(0);
        } finally {
            await db.dispose();await source.dispose();
        }
    });
});
