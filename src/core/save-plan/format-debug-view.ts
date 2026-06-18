import type { SavePlanEntry } from '../save-plan';

/** Render a human-readable view of a save plan. */
export function formatSavePlanDebug(plan: readonly SavePlanEntry[]): string {
    if (plan.length === 0) {
        return 'No pending changes.';
    }

    return plan.map(entry => [
        `${entry.entityName} { ${entry.keyValue === undefined ? 'unknown' : JSON.stringify(entry.keyValue)} } ${entry.state}`,
        `  ${entry.statement.text}`,
        `  params: ${JSON.stringify(entry.statement.values)}`,
    ].join('\n')).join('\n');
}
