import { defineAdvancedProviderContractTests } from './advanced-contract-tests';
import { defineCoreProviderContractTests } from './core-contract-tests';
import { defineJoinProviderContractTests } from './join-contract-tests';
import { defineMigrationProviderContractTests } from './migration-contract-tests';
import { ProviderContractDbContext } from './model';
import type { ProviderContractRuntime, ProviderContractRuntimeFactory } from './runtime';
import type { ProviderContractTestContext } from './test-context';
import { defineValueProviderContractTests } from './value-contract-tests';

export function defineProviderContractTests(name: string, createRuntime: ProviderContractRuntimeFactory): void {
    describe(`${name} provider contract`, () => {
        let runtime: ProviderContractRuntime;
        let db: ProviderContractDbContext;
        const context: ProviderContractTestContext = {
            get db() {
                return db;
            },
            get runtime() {
                return runtime;
            },
        };

        beforeEach(async () => {
            runtime = createRuntime();
            db = await ProviderContractDbContext.createWith(runtime);
        });

        afterEach(async () => {
            try {
                await runtime.afterEach?.(db);
            } finally {
                await db.dispose();
            }
        });

        defineCoreProviderContractTests(context);
        defineMigrationProviderContractTests(context);
        defineValueProviderContractTests(context);
        defineJoinProviderContractTests(context);
        defineAdvancedProviderContractTests(context);
    });
}
