import { contextMigrations, MigrationSqlGenerator } from '../../../packages/core/src/migrations/api';
import { CreateProviderContractUsers, ExerciseProviderMigrationOperations } from './migrations';
import type { ProviderContractTestContext } from './test-context';

export function defineMigrationProviderContractTests(context: ProviderContractTestContext): void {
    it('applies migrations and treats a second update as idempotent', async () => {
        const { db, runtime } = context;
        const migration = new CreateProviderContractUsers();
        await runtime.beforeMigrationUpdate?.(db, migration);
        const first = await contextMigrations(db).update([migration]);

        expect(first.appliedMigrations).toEqual(['up:20260601150000_CreateProviderContractUsers']);
        expect(first.usedMigrationLock).toBe(runtime.expectedUsesMigrationLock);
        await runtime.afterMigrationUpdate?.(db, first);

        await runtime.beforeSecondMigrationUpdate?.(db, migration);
        const second = await contextMigrations(db).update([migration]);

        expect(second.appliedMigrations).toEqual([]);
        expect(second.usedMigrationLock).toBe(runtime.expectedUsesMigrationLock);
    });

    it('rolls migrations back through provider migration history', async () => {
        const { db, runtime } = context;
        const migration = new CreateProviderContractUsers();
        await runtime.beforeMigrationRollback?.(db, migration);

        const applied = await contextMigrations(db).update([migration]);
        expect(applied.appliedMigrations).toEqual(['up:20260601150000_CreateProviderContractUsers']);
        expect(applied.usedMigrationLock).toBe(runtime.expectedUsesMigrationLock);

        const rolledBack = await contextMigrations(db).update([migration], { target: '0' });
        expect(rolledBack.appliedMigrations).toEqual(['down:20260601150000_CreateProviderContractUsers']);
        expect(rolledBack.usedMigrationLock).toBe(runtime.expectedUsesMigrationLock);
        await runtime.afterMigrationRollback?.(db, rolledBack);
    });

    it('generates provider-owned migration operation SQL', () => {
        const { runtime } = context;
        const migration = new ExerciseProviderMigrationOperations();
        const script = new MigrationSqlGenerator(
            runtime.providerServices.migrationDialect,
            runtime.providerServices.createMigrationBuilder,
        ).generateUpScript(migration);

        for (const fragment of runtime.expectedMigrationOperationFragments) {
            expect(script).toContain(fragment);
        }
    });

    it('documents optional idempotent migration script support', () => {
        const { runtime } = context;
        const migration = new CreateProviderContractUsers();
        const generator = new MigrationSqlGenerator(
            runtime.providerServices.migrationDialect,
            runtime.providerServices.createMigrationBuilder,
        );

        if (runtime.expectedIdempotentScriptFragments) {
            const script = generator.generateScript([migration], { idempotent: true });
            for (const fragment of runtime.expectedIdempotentScriptFragments) {
                expect(script).toContain(fragment);
            }
            return;
        }

        expect(() => generator.generateScript([migration], { idempotent: true }))
            .toThrow(`Idempotent scripts are not supported by migration dialect '${runtime.providerServices.migrationDialect.name}'.`);
    });

    it('documents optional schema introspection support', async () => {
        const { db, runtime } = context;
        if (runtime.expectSchemaIntrospection) {
            await runtime.expectSchemaIntrospection(db);
            return;
        }

        expect(typeof runtime.providerServices.createSchemaIntrospector).toBe('undefined');
    });
}
