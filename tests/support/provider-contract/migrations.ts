import type { MigrationBuilder } from '../../../packages/core/src/migrations/api';
import { Migration } from '../../../packages/core/src/migrations/api';

export class CreateProviderContractUsers extends Migration {
    public readonly id = '20260601150000_CreateProviderContractUsers';
    public readonly name = 'CreateProviderContractUsers';

    public override up(builder: MigrationBuilder): void {
        builder.createTable('provider_contract_users', [
            { name: 'id', type: 'text', primaryKey: true },
            { name: 'email', type: 'text' },
        ]);
    }

    public override down(builder: MigrationBuilder): void {
        builder.dropTable('provider_contract_users');
    }
}

export class ExerciseProviderMigrationOperations extends Migration {
    public readonly id = '20260601160000_ExerciseProviderMigrationOperations';
    public readonly name = 'ExerciseProviderMigrationOperations';

    public override up(builder: MigrationBuilder): void {
        builder.createTable('provider_contract_operations', [
            { name: 'id', type: 'text', primaryKey: true },
            { name: 'email', type: 'text', nullable: true },
        ]);
        builder.addColumn('provider_contract_operations', { name: 'display_name', type: 'text', nullable: true });
        builder.createIndex({ name: 'ix_provider_contract_operations_email', tableName: 'provider_contract_operations', columns: ['email'], unique: true });
        builder.renameColumn('provider_contract_operations', 'display_name', 'name');
        builder.renameTable('provider_contract_operations', 'provider_contract_accounts');
        builder.dropColumn('provider_contract_accounts', 'name');
        // Pass the table so the operation is portable: Postgres and SQLite drop an
        // index by name and ignore it, MySQL needs it.
        builder.dropIndex('ix_provider_contract_operations_email', undefined, { tableName: 'provider_contract_accounts' });
    }

    public override down(builder: MigrationBuilder): void {
        builder.dropTable('provider_contract_accounts');
    }
}
