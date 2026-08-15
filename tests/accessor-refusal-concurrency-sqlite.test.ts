import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import { DbContext, DbUpdateConcurrencyError, EntityState } from '../src';
import { sqliteProviderServices } from '../src/providers/sqlite';
import { requireDefined } from './support/require-defined';
import { refusalMessage, rejection } from './support/accessor-refusal-support';

const writeLog: string[] = [];

class ReloadedDoc {
    private storedTitle = '';
    private storedVersion = 0;
    public id = '';
    public refuseTitle: string | null = null;

    public get title(): string {
        return this.storedTitle;
    }

    public set title(value: string) {
        writeLog.push(`title=${value}`);
        if (value === this.refuseTitle) return;
        this.storedTitle = value;
    }

    public get version(): number {
        return this.storedVersion;
    }

    public set version(value: number) {
        writeLog.push(`version=${String(value)}`);
        this.storedVersion = value;
    }
}

class DocRevision {
    private storedVersion?: number | null;

    public get version(): number | null | undefined {
        return this.storedVersion;
    }

    public set version(value: number | null | undefined) {
        writeLog.push(`revision=${String(value)}`);
        this.storedVersion = value;
    }
}

class ConcurrentDoc {
    private storedOther = 1;
    public id = '';
    public title = '';
    public revision?: DocRevision | null;
    public refuseOtherVersion = false;

    public get otherVersion(): number {
        return this.storedOther;
    }

    public set otherVersion(value: number) {
        if (this.refuseOtherVersion && value === 2) return;
        this.storedOther = value;
    }
}

class ConcurrencyRefusalContext extends DbContext {
    public reloaded = this.set(ReloadedDoc);
    public concurrent = this.set(ConcurrentDoc);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(ReloadedDoc, entity => {
            entity.toTable('reloaded_docs');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.title).hasColumnType('text').isRequired();
            entity.property(row => row.version).hasColumnType('integer')
                .isRequired().isVersion();
        });
        model.entity(ConcurrentDoc, entity => {
            entity.toTable('concurrent_docs');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.title).hasColumnType('text').isRequired();
            entity.complexProperty(
                row => row.revision,
                { constructor: DocRevision },
                revision => revision.property(value => value.version)
                    .hasColumnName('revision_version')
                    .hasColumnType('integer').isOptional().isVersion(),
            );
            entity.property(row => row.otherVersion)
                .hasColumnName('other_version').hasColumnType('integer')
                .isRequired().isVersion();
        });
    }
}

async function open(): Promise<ConcurrencyRefusalContext> {
    const db = ConcurrencyRefusalContext.create();
    await db.database.connection.query({
        text: db.database.createScript(), values: [],
    });
    await db.database.connection.query({
        text: 'insert into reloaded_docs (id, title, version) values (?, ?, ?)',
        values: ['d1', 'original', 1],
    });
    await db.database.connection.query({
        text: `insert into concurrent_docs (id, title, revision_version, other_version)
            values (?, ?, ?, ?)`,
        values: ['c1', 'original', 1, 1],
    });
    return db;
}

async function overwriteStoredDoc(
    db: ConcurrencyRefusalContext,
    table: 'reloaded_docs' | 'concurrent_docs',
): Promise<void> {
    await db.database.connection.query(table === 'reloaded_docs' ? {
        text: 'update reloaded_docs set title = ?, version = ? where id = ?',
        values: ['database', 2, 'd1'],
    } : {
        text: `update concurrent_docs
            set title = ?, revision_version = ?, other_version = ?
            where id = ?`,
        values: ['database', 2, 2, 'c1'],
    });
}

describe('accessor refusal during concurrency recovery', () => {
    beforeEach(() => {
        writeLog.length = 0;
    });

    it('fails a reload whose mapped scalar setter refuses the database value', async () => {
        const db = await open();
        const doc = requireDefined(await db.reloaded.find('d1'));
        const entry = requireDefined(db.entry(doc));
        await overwriteStoredDoc(db, 'reloaded_docs');
        doc.refuseTitle = 'database';
        writeLog.length = 0;

        const failure = await rejection(async () => entry.reload());

        expect(refusalMessage(failure)).toBe(
            'Property \'ReloadedDoc.title\' refused its assigned value.',
        );
        expect((failure as Error).cause).toBeUndefined();
        expect(doc.title).toBe('original');
        expect(doc.version).toBe(1);
        expect(entry.originalValues).toEqual({
            id: 'd1', title: 'original', version: 1,
        });
        expect(entry.state).toBe(EntityState.Unchanged);
        expect(entry.modifiedProperties()).toEqual([]);
        expect(writeLog).toContain('version=2');
        expect(writeLog.at(-1)).toBe('version=1');
        await expect(db.reloaded.count()).resolves.toBe(1);
        expect(() => {
            db.changeTracker.clear();
        }).not.toThrow();
        await db.dispose();
    });

    it('fails client-wins resolution whose version setter refuses the database version', async () => {
        const db = await open();
        const doc = requireDefined(await db.concurrent.find('c1'));
        doc.title = 'client';
        db.changeTracker.detectChanges();
        await overwriteStoredDoc(db, 'concurrent_docs');
        const conflict = await rejection(async () => db.saveChanges());
        expect(conflict).toBeInstanceOf(DbUpdateConcurrencyError);
        const entry = requireDefined(db.entry(doc));
        const values = requireDefined(await entry.getDatabaseValues());
        doc.refuseOtherVersion = true;
        writeLog.length = 0;

        const failure = await rejection(async () =>
            entry.resolveConcurrency('clientWins', values));

        expect(refusalMessage(failure)).toBe(
            'Property \'ConcurrentDoc.otherVersion\' refused its assigned value.',
        );
        expect(doc.title).toBe('client');
        expect(doc.otherVersion).toBe(1);
        expect(doc.revision?.version).toBe(1);
        expect(entry.originalValues).toEqual({
            id: 'c1', title: 'original', 'revision.version': 1, otherVersion: 1,
        });
        expect(entry.state).toBe(EntityState.Modified);
        expect(writeLog).toContain('revision=2');
        expect(writeLog.at(-1)).toBe('revision=1');
        doc.refuseOtherVersion = false;
        await entry.resolveConcurrency('clientWins', values);
        expect(doc).toMatchObject({ title: 'client', otherVersion: 2 });
        await expect(db.saveChanges()).resolves.toBe(1);
        await db.dispose();
    });
});
