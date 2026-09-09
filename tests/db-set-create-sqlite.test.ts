import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CreationContext, CreationUser } from './support/creation-context';

describe('creation and explicit materialization', () => {
    it('accepts a subclass factory while queries still materialize the mapped class', async () => {
        class SpecialUser extends CreationUser {
            public role = 'special';
        }
        await using db = CreationContext.create();
        await db.database.ensureCreated();
        const users = db.set(CreationUser, {
            create: (name: string) => new SpecialUser({ id: 'special', name }),
        });
        const created = users.create('Special');
        expect(created).toBeInstanceOf(SpecialUser);
        expect(created.identity()).toBe('special');
        await expect(db.saveChanges()).resolves.toBe(1);
        db.clearTracking();
        const loaded = await users.findOrThrow('special');
        expect(loaded).toBeInstanceOf(CreationUser);
        expect(loaded).not.toBeInstanceOf(SpecialUser);
        expect(loaded.name).toBe('Special');
    });

    it('persists once and rehydrates through a fresh context without invoking the creation factory', async () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'entitykit-creation-'));
        const filename = path.join(directory, 'creation.db');
        const factory = jest.fn((name: string) => new CreationUser({ id: 'ada', name }));
        try {
            {
                await using db = CreationContext.create({ filename });
                await db.database.ensureCreated();
                const user = db.set(CreationUser, { create: factory }).create(' Ada ');
                user.status = 'active';
                expect(await db.users.asNoTracking().count()).toBe(0);
                await expect(db.saveChanges()).resolves.toBe(1);
                await expect(db.saveChanges()).resolves.toBe(0);
            }
            await using db = CreationContext.create({ filename });
            const users = db.set(CreationUser, { create: factory });
            const loaded = await users.findOrThrow('ada');
            expect(loaded).toBeInstanceOf(CreationUser);
            expect(loaded.identity()).toBe('ada');
            expect(loaded.name).toBe('Ada');
            expect(loaded.status).toBe('active');
            expect(await users.count()).toBe(1);
            expect(factory).toHaveBeenCalledTimes(1);
        } finally {
            fs.rmSync(directory, { recursive: true, force: true });
        }
    });
});
