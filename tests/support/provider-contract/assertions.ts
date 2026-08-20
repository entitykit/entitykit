import { DatabaseProviderError } from '../../../packages/core/src';
import type { DatabaseProviderServices } from '../../../packages/core/src/adapter';
import { migrationChecksum } from '../../../packages/core/src/migrations/api';
import type { CreateProviderContractUsers } from './migrations';

export function contractMigrationHistoryRow(migration: CreateProviderContractUsers, providerServices: DatabaseProviderServices): { id: string; name: string; checksum: string; } {
    return {
        id: migration.id,
        name: migration.name,
        checksum: migrationChecksum(
            migration,
            providerServices.dialect,
            providerServices.createMigrationBuilder,
        ),
    };
}

export function expectDatabaseProviderError(error: unknown, provider: string, operation: string): void {
    expect(error).toBeInstanceOf(DatabaseProviderError);
    expect(error).toMatchObject({
        provider,
        operation,
    });
}
