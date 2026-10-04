import type { IndexKeyPart, MutableIndexMetadata } from './index-metadata';
import type { EntityPropertyKey } from '../types';

export function indexFromKeyParts<TEntity extends object>(
    parts: ReadonlyArray<IndexKeyPart<TEntity>>,
): MutableIndexMetadata<TEntity> {
    if (!Array.isArray(parts) || parts.length === 0) {
        throw new TypeError('Index key parts require at least one property or expression.');
    }
    const keyParts = Array.from(parts, (part: unknown): IndexKeyPart<TEntity> => {
        if (!part || typeof part !== 'object') {
            throw new TypeError('Index key parts must declare property or expression.');
        }
        const candidate = part as Record<string, unknown>;
        if (candidate.kind === 'property') {
            if (typeof candidate.propertyName !== 'string' || candidate.propertyName.length === 0) {
                throw new TypeError('Index property key parts require a non-empty property name.');
            }
            return { kind: 'property', propertyName: candidate.propertyName as EntityPropertyKey<TEntity> };
        }
        if (candidate.kind === 'expression') {
            if (typeof candidate.expression !== 'string' || !candidate.expression.trim()) {
                throw new TypeError('Index expression key parts require a non-empty SQL expression.');
            }
            return { kind: 'expression', expression: candidate.expression.trim() };
        }
        throw new TypeError('Index key parts must declare property or expression.');
    });
    return {
        propertyNames: keyParts.flatMap(part => part.kind === 'property' ? [part.propertyName] : []),
        keyParts,
    };
}
