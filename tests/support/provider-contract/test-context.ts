import type { ProviderContractDbContext } from './model';
import type { ProviderContractRuntime } from './runtime';

export interface ProviderContractTestContext {
    readonly db: ProviderContractDbContext;
    readonly runtime: ProviderContractRuntime;
}
