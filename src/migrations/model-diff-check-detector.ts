import type { EntitySnapshot } from '../model/model-snapshot-types';
import type { ModelDiffOperation } from './model-diff-operations';

export function diffCheckConstraints(
    from: EntitySnapshot,
    to: EntitySnapshot,
): ModelDiffOperation[] {
    const operations: ModelDiffOperation[] = [];
    const oldChecks = new Map((from.checkConstraints ?? []).map(check => [check.name, check]));
    const newChecks = new Map((to.checkConstraints ?? []).map(check => [check.name, check]));

    for (const check of from.checkConstraints ?? []) {
        const replacement = newChecks.get(check.name);
        if (replacement?.sql !== check.sql) {
            operations.push(dropOperation(from, check));
        }
    }
    for (const check of to.checkConstraints ?? []) {
        const previous = oldChecks.get(check.name);
        if (previous?.sql !== check.sql) {
            operations.push(addOperation(to, check));
        }
    }
    return operations;
}

export function addCheckOperations(entity: EntitySnapshot): ModelDiffOperation[] {
    return (entity.checkConstraints ?? []).map(check => addOperation(entity, check));
}

export function dropCheckOperations(entity: EntitySnapshot): ModelDiffOperation[] {
    return (entity.checkConstraints ?? []).map(check => dropOperation(entity, check));
}

function addOperation(
    entity: EntitySnapshot,
    check: { readonly name: string; readonly sql: string },
): ModelDiffOperation {
    return { kind: 'addCheckConstraint', entityName: entity.entityName,
        tableName: entity.tableName, schemaName: entity.schemaName, ...check };
}

function dropOperation(
    entity: EntitySnapshot,
    check: { readonly name: string; readonly sql: string },
): ModelDiffOperation {
    return { kind: 'dropCheckConstraint', entityName: entity.entityName,
        tableName: entity.tableName, schemaName: entity.schemaName, ...check };
}
