import { type DatabaseProviderServices } from '../../packages/core/src/adapter';
import { TrackerDbContext } from '../model/tracker-db-context';

export interface DogfoodEnvironment {
    readonly provider: DatabaseProviderServices;
    readonly connection: string;
    /** Provider-specific parameter marker, for the raw-SQL escape hatch. */
    readonly parameter: (index: number) => string;
}

export const ACME = 'org_acme';
export const RIVAL = 'org_rival';

export function openAs(
    environment: DogfoodEnvironment,
    organizationId: string,
    memberId?: string,
    lazyLoading?: { readonly maxPerContext?: number },
): TrackerDbContext {
    return TrackerDbContext.open({
        provider: environment.provider,
        connection: environment.connection,
        currentOrganizationId: () => organizationId,
        currentMemberId: memberId ? () => memberId : undefined,
        lazyLoading,
    });
}

/** Create the schema, as an application's first migration would. */
export async function createSchema(
    environment: DogfoodEnvironment,
): Promise<void> {
    const db =  openAs(environment, ACME);
    for (
        const table of [
            'issue_labels',
            'comments',
            'issues',
            'labels',
            'projects',
            'members',
            'organizations',
        ]
    ) {
        await db.database.connection.query({
            text: `drop table if exists "${table}"`,
            values: [],
        });
    }
    await db.database.connection.query({ text: db.database.createScript(), values: [] });
    await db.dispose();
}
