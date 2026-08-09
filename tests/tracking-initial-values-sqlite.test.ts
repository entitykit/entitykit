import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import { DbContext } from '../src';
import { sqliteProviderServices } from '../src/providers/sqlite';
import {
    internalChangeTracker,
    internalEntityEntry,
    setMetadata,
} from './support/public-api-internals';

class UnstableKeyRow {
    public label = 'unstable';
    public idReads = 0;

    public get id(): string {
        this.idReads++;
        return this.idReads === 1 ? 'one' : 'two';
    }
}

class TrackingCaptureContext extends DbContext {
    public rows = this.set(UnstableKeyRow);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(UnstableKeyRow, entity => {
            entity.toTable('unstable_key_rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.label).hasColumnType('text').isRequired();
        });
    }
}

describe('initial tracking value capture', () => {
    it('uses one key read for identity registration and persisted originals', async () => {
        const db = TrackingCaptureContext.create();
        try {
            await db.database.connection.query({
                text: db.database.createScript(),
                values: [],
            });
            await db.database.connection.query({
                text: `insert into unstable_key_rows (id, label)
                    values (?, ?), (?, ?)`,
                values: ['one', 'first', 'two', 'second'],
            });
            const row = new UnstableKeyRow();

            const entry = db.rows.attach(row);

            expect(row.idReads).toBe(1);
            expect(entry.originalValues.id).toBe('one');
            expect(internalChangeTracker(db.changeTracker)
                .tryGetByIdentity(setMetadata(db.rows), 'one'))
                .toBe(internalEntityEntry(entry));
            expect(internalChangeTracker(db.changeTracker)
                .tryGetByIdentity(setMetadata(db.rows), 'two'))
                .toBeUndefined();

            db.rows.remove(row);
            await expect(db.saveChanges()).rejects.toThrow(
                'Primary key changes are not supported',
            );
            const remaining = await db.database.connection.query<{ id: string }>({
                text: 'select id from unstable_key_rows order by id',
                values: [],
            });
            expect(remaining.rows).toEqual([{ id: 'one' }, { id: 'two' }]);
        } finally {
            await db.dispose();
        }
    });
});
