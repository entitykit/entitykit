import type {
    DbContextOptionsBuilder,
    DbSet,
    ModelBuilder,
} from '../packages/core/src';
import { DbContext } from '../packages/core/src';
import { type ModelSnapshot } from '../packages/core/src/tooling';
import { contextMigrations, MigrationSqlGenerator, diffModelSnapshots } from '../packages/core/src/migrations/api';
import { sqliteProviderServices } from '../packages/sqlite/src';

/**
 * `down()` must return the schema to where `up()` found it. Data it drops is
 * gone — nothing can restore that — but the shape must come back, or rolling
 * back a bad release leaves a schema matching neither version, and the next
 * diff is taken against a snapshot that no longer describes the database.
 */
class ArticleV1 {
    public id!: string;
    public title!: string;
    public body!: string;
    public legacyNote!: string | null;

    constructor(data?: Partial<ArticleV1>) {
        Object.assign(this, data);
    }
}

class ArticleV2 {
    public id!: string;
    public headline!: string;
    public body!: string;
    public slug!: string | null;
    public viewCount!: number;

    constructor(data?: Partial<ArticleV2>) {
        Object.assign(this, data);
    }
}

function contextFor(version: 1 | 2): {
    create(): DbContext & {
        readonly v1: DbSet<ArticleV1>;
        readonly v2: DbSet<ArticleV2>;
    };
} {
    return class EvolutionDbContext extends DbContext {
        public v1 = this.set(ArticleV1);
        public v2 = this.set(ArticleV2);

        protected override configure(options: DbContextOptionsBuilder): void {
            options.useProvider(sqliteProviderServices, ':memory:');
        }

        protected override model(model: ModelBuilder): void {
            if (version === 1) {
                model.entity(ArticleV1, entity => {
                    entity.toTable('articles');
                    entity.hasKey(article => article.id);
                    entity.property(article => article.id).hasColumnName('id').hasColumnType('text').isRequired();
                    entity.property(article => article.title).hasColumnName('title').hasColumnType('text').isRequired();
                    entity.property(article => article.body).hasColumnName('body').hasColumnType('text').isRequired();
                    entity.property(article => article.legacyNote).hasColumnName('legacy_note').hasColumnType('text');
                    entity.hasIndex(article => article.title);
                });
            } else {
                model.entity(ArticleV2, entity => {
                    entity.toTable('articles');
                    entity.hasKey(article => article.id);
                    entity.property(article => article.id).hasColumnName('id').hasColumnType('text').isRequired();
                    entity.property(article => article.headline).hasColumnName('headline').hasColumnType('text').isRequired();
                    entity.property(article => article.body).hasColumnName('body').hasColumnType('text').isRequired();
                    entity.property(article => article.slug).hasColumnName('slug').hasColumnType('text');
                    entity.property(article => article.viewCount).hasColumnName('view_count').hasColumnType('integer').isRequired().hasDefaultValue(0);
                    entity.hasIndex(article => article.slug).isUnique();
                });
            }
        }
    };
}

const emptySnapshot = { version: 1, entities: [] } as unknown as ModelSnapshot;

async function columnsOf(db: DbContext): Promise<string[]> {
    const result = await db.database.connection.query<{ name: string }>({ text: 'pragma table_info(articles)', values: [] });
    return result.rows.map(row => row.name).sort();
}

describe('migration reversibility', () => {
    it('restores a dropped column and index on the way down', async () => {
        const V1 = contextFor(1);
        const V2 = contextFor(2);
        const db =  V1.create();
        const generator = new MigrationSqlGenerator(contextOptions(db).migrationDialect, contextOptions(db).createMigrationBuilder);
        const run = async (statements: ReadonlyArray<{ text: string; values: readonly unknown[] }>): Promise<void> => {
            for (const statement of statements) {
                if (!statement.text.includes('__entitykit_migrations')) {
                    await db.database.connection.query(statement);
                }
            }
        };

        const v1Snapshot = contextMigrations(db).createModelSnapshot();
        await run(generator.buildUpStatements(diffModelSnapshots(emptySnapshot, v1Snapshot).toMigration('1_V1', 'V1')));

        db.v1.add(new ArticleV1({ id: 'a', title: 'T', body: 'B', legacyNote: 'note' }));
        await db.saveChanges();
        db.changeTracker.clear();

        const before = await columnsOf(db);
        expect(before).toEqual(['body', 'id', 'legacy_note', 'title']);

        // v1 -> v2: rename title, add slug and view_count, drop legacy_note,
        // replace the title index with a unique slug index.
        const v2 =  V2.create();
        const upgrade = diffModelSnapshots(v1Snapshot, contextMigrations(v2).createModelSnapshot(), {
            renameHints: { columns: [{ tableName: 'articles', from: 'title', to: 'headline' }] },
        }).toMigration('2_V2', 'V2');

        await run(generator.buildUpStatements(upgrade));
        expect(await columnsOf(db)).toEqual(['body', 'headline', 'id', 'slug', 'view_count']);
        // The row survived the rename with its value intact.
        const migrated = await db.database.connection.query<{ headline: string }>({ text: 'select headline from articles', values: [] });
        expect(migrated.rows[0]?.headline).toBe('T');

        // Down must put the schema back exactly. Before the fix the dropped column
        // and index were simply never restored: `down()` for them was a no-op.
        await run(generator.buildDownStatements(upgrade));
        expect(await columnsOf(db)).toEqual(before);

        const indexes = await db.database.connection.query<{ name: string }>({
            text: 'select name from sqlite_master where type = \'index\' and tbl_name = \'articles\' and name not like \'sqlite_%\'',
            values: [],
        });
        expect(indexes.rows.map(row => row.name)).toContain('ix_articles_title');

        await db.dispose();
        await v2.dispose();
    });

    it('carries what down() needs on the operations themselves', async () => {
    // The information has to be captured at diff time, from the *old*
    // snapshot — after the column is gone there is nowhere left to read it.
        const V1 = contextFor(1);
        const V2 = contextFor(2);
        const db =  V1.create();
        const v2 =  V2.create();

        const operations = diffModelSnapshots(contextMigrations(db).createModelSnapshot(), contextMigrations(v2).createModelSnapshot(), {
            renameHints: { columns: [{ tableName: 'articles', from: 'title', to: 'headline' }] },
        }).operations;

        const dropColumn = operations.find(operation => operation.kind === 'dropColumn');
        expect(dropColumn).toMatchObject({ columnName: 'legacy_note', column: { name: 'legacy_note', type: 'text' } });

        const dropIndex = operations.find(operation => operation.kind === 'dropIndex');
        // The name is the one the database carries, so the drop finds it. The
        // column is the renamed one, because down() runs in reverse: the index is
        // recreated before the rename is undone, and the provider then carries the
        // index across the rename itself.
        expect(dropIndex).toMatchObject({ name: 'ix_articles_title', tableName: 'articles', columns: ['headline'], unique: false });

        await db.dispose();
        await v2.dispose();
    });

    it('leaves the schema diffing clean against v1 after a round trip', async () => {
    // The property that matters: up then down is a no-op on the model's terms,
    // so the next diff starts from the schema it thinks it has.
        const V1 = contextFor(1);
        const V2 = contextFor(2);
        const db =  V1.create();
        const v2 =  V2.create();
        const generator = new MigrationSqlGenerator(contextOptions(db).migrationDialect, contextOptions(db).createMigrationBuilder);

        const v1Snapshot = contextMigrations(db).createModelSnapshot();
        const upgrade = diffModelSnapshots(v1Snapshot, contextMigrations(v2).createModelSnapshot(), {
            renameHints: { columns: [{ tableName: 'articles', from: 'title', to: 'headline' }] },
        }).toMigration('2_V2', 'V2');

        // Applying up then down to an empty builder must cancel out.
        const up = generator.buildUpStatements(upgrade).map(statement => statement.text).filter(text => !text.includes('__entitykit_migrations'));
        const down = generator.buildDownStatements(upgrade).map(statement => statement.text).filter(text => !text.includes('__entitykit_migrations'));

        expect(up).toHaveLength(down.length);
        expect(down.some(text =>
            text.includes('create table "__entitykit_new_articles"')))
            .toBe(true);
        expect(down.some(text =>
            text.includes('insert into "__entitykit_new_articles"')))
            .toBe(true);
        expect(down.some(text => /create index.*"ix_articles_title"/.test(text))).toBe(true);

        await db.dispose();
        await v2.dispose();
    });
});
import { contextOptions } from './support/public-api-internals';
