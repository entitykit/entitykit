import { join } from 'node:path';
import { DbContext, EntityState, OperationCanceledError, type ModelBuilder } from '../packages/core/src';
import { createSqliteDataSource } from '../packages/sqlite/src';
import { createManagedTempDirectory } from './support/managed-temp-directory';

class Shelf {
    public id = 0;
    public books: Book[] = [];
}
class Book {
    public id = 0;
    public shelfId: number | null = null;
    public shelf: Shelf | null = null;
    public title = '';
    public version = 1;
}
class LibraryContext extends DbContext {
    public shelves = this.set(Shelf);
    public books = this.set(Book);
    protected override model(model: ModelBuilder): void {
        model.entity(Shelf, entity => {
            entity.toTable('stabilization_shelves').hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer').isRequired();
        });
        model.entity(Book, entity => {
            entity.toTable('stabilization_books').hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer').isRequired();
            entity.property(row => row.shelfId).hasColumnType('integer');
            entity.property(row => row.title).hasColumnType('text').isRequired();
            entity.property(row => row.version).hasColumnType('integer').isRequired().isVersion();
            entity.hasOne(Shelf, row => row.shelf).withMany(row => row.books).hasForeignKey(row => row.shelfId);
        });
    }
}

async function seed(source: ReturnType<typeof createSqliteDataSource>): Promise<void> {
    const db = source.createContext(LibraryContext);
    try {
        await db.database.ensureCreated();
        for (const id of [1, 2]) db.shelves.add(Object.assign(new Shelf(), { id }));
        for (const id of [1, 2, 3]) db.books.add(Object.assign(new Book(), { id, title: `Book ${String(id)}`, shelfId: 1 }));
        await expect(db.saveChanges()).resolves.toBe(5);
    } finally {
        await db.dispose();
    }
}

describe('finite SQLite state and ownership stabilization', () => {
    it.each([17, 73, 491])('matches stored rows and the tracked graph through a seeded sequence (%i)', async initial => {
        const source = createSqliteDataSource(join(createManagedTempDirectory('entitykit-state-repeat-'), 'library.db'));
        await seed(source);
        const db = source.createContext(LibraryContext);
        try {
            const shelves = await db.shelves.orderBy(row => row.id).include(row => row.books).toArray();
            const books = [...shelves[0].books].sort((left, right) => left.id - right.id);
            const expected: Array<Pick<Book, 'id' | 'shelfId' | 'title' | 'version'>> =
                books.map(book => ({ id: book.id, shelfId: 1, title: book.title, version: 1 }));
            let state = initial;
            for (let step = 0; step < 36; step += 1) {
                state = Math.imul(state, 1664525) + 1013904223 >>> 0;
                const book = books[state % books.length];
                const previous = expected[book.id - 1];
                const desired = { ...previous };
                let target = shelves[(state >>> 8) % 2] as Shelf | null;
                if ((state >>> 16) % 3 === 0) target = null;
                if (step % 6 < 3 || step % 6 === 4) desired.shelfId = target?.id ?? null;
                switch (step % 6) {
                    case 0: book.shelf = target; break;
                    case 1: book.shelfId = desired.shelfId; break;
                    case 2:
                        if (book.shelf) book.shelf.books = book.shelf.books.filter(row => row !== book);
                        if (target) target.books.push(book);
                        break;
                    case 3:
                        db.changeTracker.detach(book);
                        expect(db.entry(book)).toBeUndefined();
                        db.books.attach(book);
                        break;
                    case 4:
                        desired.title = `Recovered ${String(initial)}:${String(step)}`;
                        await expect(db.transaction(async outer => {
                            await outer.transaction(async inner => {
                                book.shelf = target;
                                book.title = desired.title;
                                await expect(inner.saveChanges()).resolves.toBe(1);
                                throw new Error('recover nested save');
                            });
                        })).rejects.toThrow('recover nested save');
                        expect(book.version).toBe(previous.version);
                        expect((await db.books.orderBy(row => row.id).asNoTracking().toArray())
                            .map(row => ({ id: row.id, shelfId: row.shelfId, title: row.title, version: row.version })))
                            .toEqual(expected);
                        book.shelf = target;
                        book.title = desired.title;
                        break;
                    case 5: {
                        const entries = db.changeTracker.entries();
                        const graph = await db.shelves.include(row => row.books).asNoTracking().toArray();
                        expect(graph.every(shelf => shelf.books.every(row => row.shelf === shelf))).toBe(true);
                        expect(db.changeTracker.entries()).toEqual(entries);
                        await expect(db.saveChanges()).resolves.toBe(0);
                        break;
                    }
                }
                db.changeTracker.detectChanges();
                const changed = desired.shelfId !== previous.shelfId || desired.title !== previous.title;
                await expect(db.saveChanges()).resolves.toBe(changed ? 1 : 0);
                if (changed) desired.version += 1;
                expected[book.id - 1] = desired;
                const rows = await db.books.orderBy(row => row.id).asNoTracking().toArray();
                expect(rows.map(row => ({ id: row.id, shelfId: row.shelfId, title: row.title, version: row.version })))
                    .toEqual(expected);
                for (const current of books) {
                    const value = expected[current.id - 1];
                    expect(current).toMatchObject(value);
                    expect(current.shelf).toBe(shelves.find(shelf => shelf.id === value.shelfId) ?? null);
                    expect(db.entry(current)?.state).toBe(EntityState.Unchanged);
                }
                for (const shelf of shelves) {
                    expect(new Set(shelf.books)).toEqual(new Set(books.filter(row => expected[row.id - 1].shelfId === shelf.id)));
                    expect(shelf.books.length).toBe(new Set(shelf.books).size);
                }
                expect(db.changeTracker.entries()).toHaveLength(5);
            }
        } finally {
            await db.dispose();
            await source.dispose();
        }
    });

    it('keeps one active lease while fifty contexts alternate completion, early return and cancellation', async () => {
        const source = createSqliteDataSource(join(createManagedTempDirectory('entitykit-resource-repeat-'), 'library.db'));
        await seed(source);
        try {
            for (let iteration = 0; iteration < 50; iteration += 1) {
                const db = source.createContext(LibraryContext);
                try {
                    const controller = new AbortController();
                    const rows = db.books.orderBy(row => row.id).asNoTracking()
                        .stream({ signal: controller.signal, batchSize: 1 });
                    if (iteration % 3 === 0) {
                        const ids: number[] = [];
                        for await (const row of rows) ids.push(row.id);
                        expect(ids).toEqual([1, 2, 3]);
                    } else if (iteration % 3 === 1) {
                        for await (const row of rows) {
                            expect(row.id).toBe(1);
                            break;
                        }
                    } else {
                        const iterator = rows[Symbol.asyncIterator]();
                        await expect(iterator.next()).resolves.toMatchObject({ done: false, value: { id: 1 } });
                        controller.abort('repeat cancellation');
                        await expect(iterator.next()).rejects.toBeInstanceOf(OperationCanceledError);
                        await iterator.return?.();
                    }
                    await expect(db.books.countBigInt()).resolves.toBe(3n);
                    expect(db.changeTracker.entries()).toEqual([]);
                    await expect(source.dispose()).rejects.toThrow('1 connection lease(s) and 0 retry operation(s) are active');
                } finally {
                    await db.dispose();
                }
                await expect(db.books.count()).rejects.toMatchObject({ name: 'ContextDisposedError' });
            }
        } finally {
            await expect(source.dispose()).resolves.toBeUndefined();
        }
    });
});
