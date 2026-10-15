import { DbContext, compileModel, type DbContextOptionsBuilder, type ModelBuilder, type DbSet } from '../../packages/core/src';
import { compiledModelMetadata } from '../../packages/core/src/model/compiled-model';
import { createSqliteDataSource } from '../../packages/sqlite/src';
import type { EntityMetadata } from '../../packages/core/src/model/entity-metadata';

interface GraphParent { id: number; name: string; children: GraphChild[] }
interface GraphChild { id: number; parentId: number; name: string; parent: GraphParent | null }
interface BufferedIdentityGraph {
    db: DbContext & { parents: DbSet<GraphParent> };
    query(text: string): Promise<{ rows: Array<Record<string, unknown>> }>;
    dispose(): Promise<void>;
    createdParents: GraphParent[];
    read(): Promise<GraphParent[]>;
    setRefuse(value: boolean): void;
    metadata: EntityMetadata[];
}

export async function openBufferedIdentityGraph(compiled: boolean): Promise<BufferedIdentityGraph> {
    let refuse = false;
    const createdParents: Parent[] = [];
    const parentLinks: WeakMap<object, Parent | null> = new WeakMap();
    class Parent {
        public id = 0; public name = ''; public children: Child[] = [];
        constructor() {
            createdParents.push(this);
        }
    }
    class Child {
        public id = 0; public parentId = 0; public name = '';
        public get parent(): Parent | null {
            return parentLinks.get(this) ?? null;
        }
        public set parent(value: Parent | null) {
            if (refuse && value) throw new Error('refused include parent');
            parentLinks.set(this, value);
        }
    }
    const mapping = (model: ModelBuilder): void => {
        model.entity(Parent, entity => {
            entity.toTable('receipt_parents').hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer').isRequired();
            entity.property(row => row.name).hasColumnType('text').isRequired();
        });
        model.entity(Child, entity => {
            entity.toTable('receipt_children').hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer').isRequired();
            entity.property(row => row.parentId).hasColumnType('integer').isRequired();
            entity.property(row => row.name).hasColumnType('text').isRequired();
            entity.hasOne(Parent, row => row.parent).withMany(row => row.children).hasForeignKey(row => row.parentId);
        });
    };
    const handle = compiled ? compileModel(mapping, { provider: 'sqlite' }) : undefined;
    class Context extends DbContext {
        public parents = this.set(Parent);
        protected override configure(options: DbContextOptionsBuilder): void {
            if (handle) options.useCompiledModel(handle);
        }
        protected override model(model: ModelBuilder): void {
            mapping(model);
        }
    }
    const source = createSqliteDataSource(':memory:'), db = source.createContext(Context);
    const query = async (text: string): Promise<{ rows: Array<Record<string, unknown>> }> => db.database.connection.query({ text, values: [] });
    const dispose = async (): Promise<void> => {
        await db.dispose();await source.dispose();
    };
    try {
        await query('create table receipt_parents (id integer primary key, name text not null)');
        await query('create table receipt_children (id integer primary key, parentId integer not null, name text not null)');
        await query('insert into receipt_parents values (1,\'parent1\'),(2,\'parent2\'),(3,\'parent3\')');
        await query('insert into receipt_children values (1,1,\'child1\'),(2,1,\'child2\'),(3,2,\'child3\'),(4,2,\'child4\'),(5,3,\'child5\'),(6,3,\'child6\')');
    } catch (error) {
        await dispose();throw error;
    }
    return {
        db, query, dispose, createdParents,
        read: async () => db.parents.asNoTracking().orderBy(row => row.id).include(row => row.children).thenInclude(row => row.parent).toArray(),
        setRefuse: (value: boolean): void => {
            refuse = value;
        },
        metadata: handle ? [compiledModelMetadata(handle).getEntity<object>(Parent), compiledModelMetadata(handle).getEntity<object>(Child)] : [],
    };
}
