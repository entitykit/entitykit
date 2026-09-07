import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CreationContext, CreationUser } from './support/creation-context';

describe('creation and explicit materialization', () => {
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
