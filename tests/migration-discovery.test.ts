import fs from 'fs';
import path from 'path';
import { discoverMigrations, loadMigrationFile } from '../packages/core/src/migrations/api';
import { createManagedTempDirectory } from './support/managed-temp-directory';

function tempDir(): string {
    return createManagedTempDirectory('entitykit-discovery-');
}

describe('migration discovery', () => {
    it('loads and orders TypeScript migration files', async () => {
        const dir = tempDir();
        fs.writeFileSync(path.join(dir, 'migration-name.ts'), `
      export const migrationName = "CreateUsers";
    `);
        fs.writeFileSync(path.join(dir, '20260601120000_CreateUsers.ts'), `
      import { Migration, MigrationBuilder } from "entitykit/migrations";
      import { migrationName } from "./migration-name";
      export default class CreateUsers extends Migration {
        readonly id = "20260601120000_CreateUsers";
        readonly name = migrationName;
        up(_builder: MigrationBuilder): void {}
        down(_builder: MigrationBuilder): void {}
      }
    `);
        fs.writeFileSync(path.join(dir, '20260601130000_AddPosts.ts'), `
      import { Migration, MigrationBuilder } from "entitykit/migrations";
      export default class AddPosts extends Migration {
        readonly id = "20260601130000_AddPosts";
        readonly name = "AddPosts";
        up(_builder: MigrationBuilder): void {}
        down(_builder: MigrationBuilder): void {}
      }
    `);

        const result = await discoverMigrations(dir);

        expect(result.migrations.map(item => item.migration.id)).toEqual([
            '20260601120000_CreateUsers',
            '20260601130000_AddPosts',
        ]);
    });

    it('rejects duplicate migration ids', async () => {
        const dir = tempDir();
        const source = `
      const { Migration } = require(${JSON.stringify(path.resolve('packages/core/src/migrations/api'))});
      module.exports = class Duplicate extends Migration {
        id = "20260601120000_Duplicate";
        name = "Duplicate";
        up() {}
        down() {}
      };
    `;
        fs.writeFileSync(path.join(dir, '20260601120000_Duplicate.js'), source);
        fs.writeFileSync(path.join(dir, '20260601130000_AlsoDuplicate.js'), source);

        await expect(discoverMigrations(dir)).rejects.toThrow('Duplicate migration id');
    });

    it('loads migration instances from JavaScript files', async () => {
        const dir = tempDir();
        const file = path.join(dir, '20260601120000_CreateUsers.js');
        fs.writeFileSync(file, `
      module.exports = {
        id: "20260601120000_CreateUsers",
        name: "CreateUsers",
        up() {},
        down() {}
      };
    `);

        const migration = await loadMigrationFile(file);

        expect(migration.id).toBe('20260601120000_CreateUsers');
    });
});
