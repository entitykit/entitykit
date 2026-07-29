import { requireDefined } from './support/require-defined';
import { join } from 'node:path';
import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import { DbContext, DbUpdateConcurrencyError } from '../src';
import { sqliteProviderServices } from '../src/providers/sqlite';
import { createManagedTempDirectory } from './support/managed-temp-directory';

/**
 * Two contexts racing the same row. Previously only the friendly case was
 * covered — one writer, no contention — so these drive the real thing: a
 * conflict, a retry after it, a write racing a delete, and a conflict inside an
 * explicit transaction.
 */
class Doc {
    public id!: string;
    public title!: string;
    public version!: number;

    constructor(data?: Partial<Doc>) {
        Object.assign(this, data);
    }
}

/** No version property, so nothing can detect a conflicting write. */
class Note {
    public id!: string;
    public body!: string;

    constructor(data?: Partial<Note>) {
        Object.assign(this, data);
    }
}

let databaseFile = '';

class RaceDbContext extends DbContext {
    public docs = this.set(Doc);
    public notes = this.set(Note);

    protected override configure(options: DbContextOptionsBuilder): void {
    // A file, not `:memory:`, so two contexts see the same database.
        options.useProvider(sqliteProviderServices, databaseFile);
    }

    protected override model(model: ModelBuilder): void {
        model.entity(Doc, entity => {
            entity.toTable('docs');
            entity.hasKey(doc => doc.id);
            entity.property(doc => doc.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(doc => doc.title).hasColumnName('title').hasColumnType('text').isRequired();
            entity.property(doc => doc.version).hasColumnName('version').hasColumnType('integer').isRequired().isVersion();
        });
        model.entity(Note, entity => {
            entity.toTable('notes');
            entity.hasKey(note => note.id);
            entity.property(note => note.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(note => note.body).hasColumnName('body').hasColumnType('text').isRequired();
        });
    }
}

describe('concurrency conflicts', () => {
    let directory = '';

    beforeEach(async () => {
        directory = createManagedTempDirectory('ek-race-');
        databaseFile = join(directory, 'race.db');

        const db =  RaceDbContext.create();
        await db.database.connection.query({ text: 'create table docs (id text primary key, title text not null, version integer not null)', values: [] });
        await db.database.connection.query({ text: 'create table notes (id text primary key, body text not null)', values: [] });
        db.docs.add(new Doc({ id: 'd1', title: 'original', version: 1 }));
        db.notes.add(new Note({ id: 'n1', body: 'original' }));
        await db.saveChanges();
        await db.dispose();
    });

    it('rejects the second of two writers and names the entity', async () => {
        const a =  RaceDbContext.create();
        const b =  RaceDbContext.create();

        const fromA = await a.docs.find('d1');
        const fromB = await b.docs.find('d1');
        requireDefined(fromA).title = 'from A';
        requireDefined(fromB).title = 'from B';

        await a.saveChanges();
        await expect(b.saveChanges()).rejects.toThrow(DbUpdateConcurrencyError);
        await expect(b.saveChanges()).rejects.toThrow(/'Doc' with key 'd1'.*Modified.*affected 0/s);

        await a.dispose();
        await b.dispose();
    });

    it('leaves the winner\'s write intact and the version incremented', async () => {
        const a =  RaceDbContext.create();
        const b =  RaceDbContext.create();
        const fromA = await a.docs.find('d1');
        const fromB = await b.docs.find('d1');
        requireDefined(fromA).title = 'from A';
        requireDefined(fromB).title = 'from B';

        await a.saveChanges();
        await expect(b.saveChanges()).rejects.toThrow(DbUpdateConcurrencyError);

        const check =  RaceDbContext.create();
        const row = await check.docs.find('d1');
        expect(row).toMatchObject({ title: 'from A', version: 2 });

        await check.dispose();
        await a.dispose();
        await b.dispose();
    });

    it('leaves the losing context usable, so the write can be retried', async () => {
        const a =  RaceDbContext.create();
        const b =  RaceDbContext.create();
        const fromA = await a.docs.find('d1');
        const fromB = await b.docs.find('d1');
        requireDefined(fromA).title = 'from A';
        requireDefined(fromB).title = 'from B';
        await a.saveChanges();
        await expect(b.saveChanges()).rejects.toThrow(DbUpdateConcurrencyError);

        // Re-read and apply again: the ordinary way to resolve a conflict.
        b.changeTracker.clear();
        const reread = await b.docs.find('d1');
        requireDefined(reread).title = 'from B, retried';
        await b.saveChanges();

        const check =  RaceDbContext.create();
        expect(await check.docs.find('d1')).toMatchObject({ title: 'from B, retried', version: 3 });

        await check.dispose();
        await a.dispose();
        await b.dispose();
    });

    it('treats an update to a deleted row as a conflict', async () => {
        const a =  RaceDbContext.create();
        const b =  RaceDbContext.create();
        const toDelete = await a.docs.find('d1');
        const toUpdate = await b.docs.find('d1');

        a.docs.remove(requireDefined(toDelete));
        await a.saveChanges();

        requireDefined(toUpdate).title = 'update after delete';
        await expect(b.saveChanges()).rejects.toThrow(DbUpdateConcurrencyError);

        await a.dispose();
        await b.dispose();
    });

    it('treats a second delete of the same row as a conflict', async () => {
        const a =  RaceDbContext.create();
        const b =  RaceDbContext.create();

        a.docs.remove(requireDefined(await a.docs.find('d1')));
        b.docs.remove(requireDefined(await b.docs.find('d1')));

        await a.saveChanges();
        await expect(b.saveChanges()).rejects.toThrow(/'Doc' with key 'd1'.*Deleted.*affected 0/s);

        await a.dispose();
        await b.dispose();
    });

    it('rolls back the whole transaction when a conflict happens inside one', async () => {
        const seed =  RaceDbContext.create();
        seed.docs.add(new Doc({ id: 'd2', title: 'untouched', version: 1 }));
        await seed.saveChanges();
        await seed.dispose();

        const a =  RaceDbContext.create();
        const b =  RaceDbContext.create();
        const stale = await b.docs.find('d1');
        const winner = await a.docs.find('d1');
        requireDefined(winner).title = 'from A';
        await a.saveChanges();

        await expect(b.transaction(async () => {
            const other = await b.docs.find('d2');
            requireDefined(other).title = 'changed inside the transaction';
            requireDefined(stale).title = 'from B';
            await b.saveChanges();
        })).rejects.toThrow(DbUpdateConcurrencyError);

        // The unrelated change in the same transaction must not have survived.
        const check =  RaceDbContext.create();
        expect(await check.docs.find('d2')).toMatchObject({ title: 'untouched' });

        await check.dispose();
        await a.dispose();
        await b.dispose();
    });

    it('loses the earlier write silently when the entity has no version property', async () => {
    // Not a defect — there is nothing to detect the conflict with — but it is
    // the reason `version()` exists, and the failure is invisible without it.
        const a =  RaceDbContext.create();
        const b =  RaceDbContext.create();
        const fromA = await a.notes.find('n1');
        const fromB = await b.notes.find('n1');
        requireDefined(fromA).body = 'from A';
        requireDefined(fromB).body = 'from B';

        await a.saveChanges();
        await b.saveChanges();

        const check =  RaceDbContext.create();
        expect(await check.notes.find('n1')).toMatchObject({ body: 'from B' });

        await check.dispose();
        await a.dispose();
        await b.dispose();
    });
});
