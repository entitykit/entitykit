import type {
    MigrationBuilder } from '../src/migrations';
import {
    Migration,
    migrationChecksum,
} from '../src/migrations';
import { postgresDialect } from '../src/sql/sql-dialect';
import { mySqlDialect } from '../src/providers/mysql/mysql-dialect';

class ChecksumMigration extends Migration {
    public readonly id = '20260729000000_Checksum';
    public readonly name = 'Checksum';

    constructor(
        private readonly downSql = 'delete from widgets where id = $1',
        private readonly suppressTransaction = false,
        private readonly payload: unknown = { b: 2, a: 1 },
    ) {
        super();
    }

    public override up(builder: MigrationBuilder): void {
        builder.sql(
            'insert into widgets (id, payload) values ($1, $2)',
            [1, this.payload],
            { suppressTransaction: this.suppressTransaction },
        );
    }

    public override down(builder: MigrationBuilder): void {
        builder.sql(this.downSql, [1]);
    }
}

describe('migration checksums', () => {
    it('changes when rollback SQL changes', () => {
        const first = migrationChecksum(new ChecksumMigration());
        const second = migrationChecksum(new ChecksumMigration(
            'delete from widgets where id = $1 and archived = false',
        ));

        expect(second).not.toBe(first);
    });

    it('changes when transaction suppression changes', () => {
        const transactional = migrationChecksum(new ChecksumMigration());
        const suppressed = migrationChecksum(new ChecksumMigration(
            undefined,
            true,
        ));

        expect(suppressed).not.toBe(transactional);
    });

    it('canonicalizes structured values independently of object key order', () => {
        const first = migrationChecksum(new ChecksumMigration(
            undefined,
            false,
            { a: 1, nested: { y: 2, x: 1 } },
        ));
        const second = migrationChecksum(new ChecksumMigration(
            undefined,
            false,
            { nested: { x: 1, y: 2 }, a: 1 },
        ));

        expect(second).toBe(first);
    });

    it('rejects structured values without a stable canonical form', () => {
        expect(() => migrationChecksum(new ChecksumMigration(
            undefined,
            false,
            new Map([['key', 'value']]),
        ))).toThrow('Migration checksum values cannot contain Map objects');
    });

    it('keeps provider-specific SQL in the checksum', () => {
        class ProviderMigration extends Migration {
            public readonly id = '20260729000001_Provider';
            public readonly name = 'Provider';

            public override up(builder: MigrationBuilder): void {
                builder.createTable('widgets', [
                    { name: 'id', type: 'uuid', nullable: false, primaryKey: true },
                ]);
            }

            public override down(builder: MigrationBuilder): void {
                builder.dropTable('widgets');
            }
        }

        expect(migrationChecksum(
            new ProviderMigration(),
            postgresDialect,
        )).not.toBe(migrationChecksum(
            new ProviderMigration(),
            mySqlDialect,
        ));
    });

    it('freezes the versioned canonical checksum format', () => {
        expect(migrationChecksum(new ChecksumMigration())).toBe(
            '321b39a80543ad0e4ea9e1cc3bbe4476a5946db5763336ed6945febf6212cfb6',
        );
    });
});
