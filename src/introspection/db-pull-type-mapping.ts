import { mapEnumType } from './db-pull-enum-type';
import {
    isBinaryStoreType,
    isNumericStoreType,
    isPrecisionSensitiveNumericStoreType,
} from './db-pull-store-type-classification';

/** A generated TypeScript type, and whether it is a conservative guess to review. */
export interface TypeScriptTypeMapping {
    readonly type: string;
    readonly needsReview: boolean;
}

/**
 * Map a database store type to the TypeScript type `db pull` writes for it.
 * Spans the three providers' vocabularies (Postgres arrays and `numeric`,
 * MySQL `tinyint(1)`/`enum`/`unsigned`, SQLite affinities); a type it cannot
 * place returns `unknown` with `needsReview` set so the generator can warn.
 */
export function mapStoreTypeToTypeScript(storeType: string): TypeScriptTypeMapping {
    const normalized = storeType.toLowerCase().trim();
    if (normalized.endsWith('[]')) {
        const elementMapping = mapStoreTypeToTypeScript(normalized.slice(0, -2));
        return {
            type: renderArrayType(elementMapping.type),
            needsReview: elementMapping.needsReview,
        };
    }

    // A MySQL `enum('a','b')` carries its exact domain; render it as a union.
    // Parse the original store type, not the lower-cased one — enum values are
    // case-sensitive, so `enum('Draft','Sent')` must stay `"Draft" | "Sent"`.
    const enumUnion = mapEnumType(storeType);
    if (enumUnion) {
        return knownType(enumUnion);
    }

    if (normalized === 'interval') {
        return {
            type: 'unknown',
            needsReview: true,
        };
    }

    // `tinyint(1)` is MySQL's BOOLEAN; a wider tinyint is a small integer, so
    // this must precede the numeric check below.
    if (normalized === 'tinyint(1)' || normalized === 'bit(1)' || normalized.includes('bool')) {
        return knownType('boolean');
    }

    if (isPrecisionSensitiveNumericStoreType(normalized)) {
        return {
            type: 'string',
            needsReview: true,
        };
    }

    if (isNumericStoreType(normalized)) {
        return knownType('number');
    }
    if (normalized.includes('timestamp') || normalized.includes('datetime') || normalized === 'date') {
        return knownType('Date');
    }
    if (normalized.includes('json')) {
        return knownType('Record<string, unknown>');
    }
    if (isBinaryStoreType(normalized)) {
        return knownType('Buffer');
    }
    if (normalized === 'time' || normalized.startsWith('time ') || normalized.startsWith('time(') || normalized === 'timetz') {
        return knownType('string');
    }
    if (normalized.startsWith('set(')) {
    // A MySQL SET is a comma-joined subset of its members: a string until refined.
        return { type: 'string', needsReview: true };
    }
    if (normalized.includes('uuid') || normalized.includes('text') || normalized.includes('char') || normalized.includes('varchar')) {
        return knownType('string');
    }
    return {
        type: 'unknown',
        needsReview: true,
    };
}

function knownType(type: string): TypeScriptTypeMapping {
    return { type, needsReview: false };
}

function renderArrayType(elementType: string): string {
    return elementType.includes('<') || elementType.includes('|') ? `Array<${elementType}>` : `${elementType}[]`;
}
