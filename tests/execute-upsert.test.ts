import { bulkUpsertFixture, openBulkUpsertDb, item } from './support/bulk-upsert-fixture';

describe('executeUpsert', () => {
    beforeEach(() => {
        bulkUpsertFixture.reset();
    });

    it.each(['executeUpsert', 'upsert'] as const)('%s immediately writes untracked inputs', async operation => {
        await using db = await openBulkUpsertDb();
        const input = item('one');
        expect(await db.items[operation]([input])).toBe(1);
        expect(db.entry(input)).toBeUndefined();
        expect(await db.items.count()).toBe(1);
        expect(await db.saveChanges()).toBe(0);
        input.name = 'Changed';
        expect(await db.items[operation]([input])).toBe(1);
        expect((await db.items.findOrThrow('one')).name).toBe('Changed');
    });
});
