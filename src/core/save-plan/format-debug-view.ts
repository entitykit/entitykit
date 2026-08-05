import type { SavePlanEntry } from '../save-plan';
import { formatDebugValue } from '../../debug-value';

/** Render a human-readable view of a save plan. */
export function formatSavePlanDebug(plan: readonly SavePlanEntry[]): string {
    if (plan.length === 0) {
        return 'No pending changes.';
    }

    return plan.map(entry => [
        `${entry.entityName} { ${entry.keyValue === undefined ? 'unknown' : formatDebugValue(entry.keyValue)} } ${entry.state}`,
        `  ${entry.statement.text}`,
        `  params: [${entry.statement.values.map(formatDebugValue).join(', ')}]`,
    ].join('\n')).join('\n');
}
