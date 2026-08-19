import { FieldExpression } from './expression/field-expression';
import type { QueryProxy } from './expression/query-field';

export function createQueryProxy<TEntity extends object>(sourceAlias?: string): QueryProxy<TEntity> {
    return new Proxy({}, {
        get(_target, property): object {
            if (typeof property !== 'string') {
                throw new Error(
                    'Query selectors must access a string property.',
                );
            }
            return createFieldExpression([property], sourceAlias);
        },
    }) as QueryProxy<TEntity>;
}

function createFieldExpression(
    path: readonly string[],
    sourceAlias?: string,
): object {
    const field: FieldExpression<Record<string, unknown>> = new FieldExpression(
        path.join('.'),
        sourceAlias,
    );
    return new Proxy(field, {
        get(target, property, receiver): unknown {
            if (typeof property !== 'string' || property in target) {
                return Reflect.get(target, property, receiver);
            }
            return createFieldExpression(
                [...path, property],
                sourceAlias,
            );
        },
    });
}
