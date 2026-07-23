import { Migration, type MigrationBuilder } from '../src/migrations/api';
import { createMigrationUpdatePlan } from '../src/migrations/runner/migration-update-plan';

class EmptyMigration extends Migration {
    constructor(
        public readonly id: string,
        public readonly name: string,
    ) {
        super();
    }

    public override up(builder: MigrationBuilder): void {
        void builder;
    }
}

describe('migration update planning', () => {
    it.each([undefined, 'Latest'])('rejects skipped migrations with target %s', target => {
        const first = new EmptyMigration('20260101000000_First', 'First');
        const skipped = new EmptyMigration('20260102000000_Skipped', 'Skipped');
        const latest = new EmptyMigration('20260103000000_Latest', 'Latest');
        const applied = [first, latest].map(migration => ({
            id: migration.id,
            name: migration.name,
            checksum: migration.id,
        }));

        expect(() => createMigrationUpdatePlan(
            [first, skipped, latest],
            applied,
            migration => migration.id,
            target,
        )).toThrow(/Skipped.*would be skipped/);
    });
});
