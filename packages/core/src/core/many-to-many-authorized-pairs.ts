import type {
    AuthorizedManyToManyPair,
    AuthorizedRelationshipEndpoint,
} from '../sql/many-to-many-authorization';
import type { CapturedRelationshipEndpoint } from './many-to-many-captured-endpoint';
import type { CapturedManyToManyChange } from './many-to-many-key-pairs';
import type { PersistedValueLookup } from './save-plan-execution';
import { resolvedManyToManyProviderKeyValues } from './many-to-many-key-pairs';

export function buildManyToManyAuthorizedPairs(
    group: readonly CapturedManyToManyChange[],
    persistedValue?: PersistedValueLookup,
): AuthorizedManyToManyPair[] {
    return group.map(captured => ({
        source: authorizedEndpoint(captured.source, persistedValue),
        target: authorizedEndpoint(captured.target, persistedValue),
    }));
}

function authorizedEndpoint(
    endpoint: CapturedRelationshipEndpoint,
    persistedValue?: PersistedValueLookup,
): AuthorizedRelationshipEndpoint {
    return {
        metadata: endpoint.metadata,
        keyValues: resolvedManyToManyProviderKeyValues(
            endpoint,
            persistedValue,
        ),
        tenant: endpoint.providerTenant,
    };
}
