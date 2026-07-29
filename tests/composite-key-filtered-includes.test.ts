import type {
    DbContextOptionsBuilder,
    ModelBuilder,
} from '../src';
import {
    DbContext,
} from '../src';
import {
    sqliteDialect,
    sqliteProviderServices,
} from '../src/providers/sqlite';
import { RecordingDatabaseConnection } from '../src/testing';

class Parent {
    public id!: string;
    public children: Child[] = [];
    public labels: Label[] = [];

    constructor(data?: Partial<Parent>) {
        Object.assign(this, data);
    }
}

class Child {
    public parentId!: string;
    public position!: number;
    public value!: string;
    public parent?: Parent;

    constructor(data?: Partial<Child>) {
        Object.assign(this, data);
    }
}

class Label {
    public code!: string;
    public locale!: string;
    public value!: string;
    public parents: Parent[] = [];

    constructor(data?: Partial<Label>) {
        Object.assign(this, data);
    }
}

class CompositeIncludeContext extends DbContext {
    public parents = this.set(Parent);
    public children = this.set(Child);
    public labels = this.set(Label);

    constructor(
        private readonly recording?: RecordingDatabaseConnection,
    ) {
        super();
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        if (this.recording) {
            options.useConnection(
                this.recording,
                { provider: 'sqlite', dialect: sqliteDialect },
            );
            return;
        }
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(Parent, entity => {
            entity.toTable('parents');
            entity.hasKey(parent => parent.id);
            entity.property(parent => parent.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.hasManyToMany(Label, parent => parent.labels)
                .withMany(label => label.parents)
                .usingJoinTable('parent_labels', join => {
                    join.sourceForeignKey('parent_id');
                    join.targetForeignKey(['label_code', 'label_locale']);
                });
        });

        model.entity(Child, entity => {
            entity.toTable('children');
            entity.hasKey(child => [child.parentId, child.position]);
            entity.property(child => child.parentId).hasColumnName('parent_id').hasColumnType('text').isRequired();
            entity.property(child => child.position).hasColumnName('position').hasColumnType('integer').isRequired();
            entity.property(child => child.value).hasColumnName('value').hasColumnType('text').isRequired();
            entity.hasOne(Parent, child => child.parent)
                .withMany(parent => parent.children)
                .hasForeignKey(child => child.parentId);
        });

        model.entity(Label, entity => {
            entity.toTable('labels');
            entity.hasKey(label => [label.code, label.locale]);
            entity.property(label => label.code).hasColumnName('code').hasColumnType('text').isRequired();
            entity.property(label => label.locale).hasColumnName('locale').hasColumnType('text').isRequired();
            entity.property(label => label.value).hasColumnName('value').hasColumnType('text').isRequired();
        });
    }
}

async function createLiveDb(): Promise<CompositeIncludeContext> {
    const db = CompositeIncludeContext.create();
    await db.database.connection.query({ text: db.database.createScript(), values: [] });
    return db;
}

function createRecordingDb(
    connection: RecordingDatabaseConnection,
): CompositeIncludeContext {
    const db = CompositeIncludeContext.create(connection);
    return db;
}

describe('filtered includes with composite related keys', () => {
    it('orders one-to-many and many-to-many windows by every key column', async () => {
        const childConnection = new RecordingDatabaseConnection();
        childConnection.queueResult({
            rows: [{ id: 'p1' }, { id: 'p2' }],
            rowCount: 2,
        });
        childConnection.queueResult({
            rows: [
                {
                    __entitykit_parent_key: 'p1',
                    parent_id: 'p1',
                    position: 1,
                    value: 'first',
                },
            ],
            rowCount: 1,
        });
        const childDb =  createRecordingDb(childConnection);
        await childDb.parents.include(parent => parent.children.take(1)).toArray();

        expect(childConnection.statements[1]?.text).toContain(
            'row_number() over (partition by "t"."parent_id" '
      + 'order by "t"."parent_id" asc, "t"."position" asc)',
        );

        const labelConnection = new RecordingDatabaseConnection();
        labelConnection.queueResult({
            rows: [{ id: 'p1' }, { id: 'p2' }],
            rowCount: 2,
        });
        labelConnection.queueResult({
            rows: [
                {
                    __entitykit_parent_key: 'p1',
                    code: 'a',
                    locale: 'en',
                    value: 'Alpha',
                },
            ],
            rowCount: 1,
        });
        const labelDb =  createRecordingDb(labelConnection);
        await labelDb.parents.include(parent => parent.labels.take(1)).toArray();

        expect(labelConnection.statements[1]?.text).toContain(
            'row_number() over (partition by "j"."parent_id" '
      + 'order by "t"."code" asc, "t"."locale" asc)',
        );
    });

    it('takes one composite-keyed child per parent on SQLite', async () => {
        const db = await createLiveDb();
        try {
            db.parents.add(new Parent({ id: 'p1' }));
            db.parents.add(new Parent({ id: 'p2' }));
            db.children.add(new Child({
                parentId: 'p1',
                position: 2,
                value: 'second',
            }));
            db.children.add(new Child({
                parentId: 'p1',
                position: 1,
                value: 'first',
            }));
            db.children.add(new Child({
                parentId: 'p2',
                position: 1,
                value: 'only',
            }));
            await db.saveChanges();
            db.changeTracker.clear();

            const parents = await db.parents
                .orderBy(parent => parent.id)
                .include(parent => parent.children.take(1))
                .toArray();

            expect(parents.map(parent =>
                parent.children.map(child => child.value),
            )).toEqual([['first'], ['only']]);
        } finally {
            await db.dispose();
        }
    });

    it('takes one composite-keyed many-to-many target per parent on SQLite', async () => {
        const db = await createLiveDb();
        try {
            const first = new Parent({ id: 'p1' });
            const second = new Parent({ id: 'p2' });
            const alphaEnglish = new Label({
                code: 'a',
                locale: 'en',
                value: 'Alpha EN',
            });
            const alphaFrench = new Label({
                code: 'a',
                locale: 'fr',
                value: 'Alpha FR',
            });
            const beta = new Label({
                code: 'b',
                locale: 'en',
                value: 'Beta',
            });
            db.parents.add(first);
            db.parents.add(second);
            db.labels.add(alphaEnglish);
            db.labels.add(alphaFrench);
            db.labels.add(beta);
            await db.saveChanges();

            db.link(first, parent => parent.labels, beta);
            db.link(first, parent => parent.labels, alphaFrench);
            db.link(second, parent => parent.labels, alphaEnglish);
            await db.saveChanges();
            db.changeTracker.clear();

            const parents = await db.parents
                .orderBy(parent => parent.id)
                .include(parent => parent.labels.take(1))
                .toArray();

            expect(parents.map(parent =>
                parent.labels.map(label => label.value),
            )).toEqual([['Alpha FR'], ['Alpha EN']]);
        } finally {
            await db.dispose();
        }
    });
});
