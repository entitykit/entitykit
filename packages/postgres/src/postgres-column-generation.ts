import type { StoreGenerationStrategy } from '../../model/store-generation';
import type { ColumnRow } from './postgres-introspect-queries';
import { normalizePostgresBoolean } from './postgres-introspection-values';

export function postgresColumnGeneration(
    column: ColumnRow,
): StoreGenerationStrategy | undefined {
    if (column.is_identity === 'YES') {
        return {
            kind: 'identity',
            mode: column.identity_generation === 'ALWAYS'
                ? 'always'
                : 'byDefault',
            startValue: scalar(column.identity_start),
            incrementBy: scalar(column.identity_increment),
            minValue: scalar(column.identity_minimum),
            maxValue: scalar(column.identity_maximum),
            isCyclic: normalizePostgresBoolean(column.identity_cycle ?? false),
            cache: optionalNumber(column.identity_cache),
        };
    }
    const ownedName = nonEmpty(column.owned_sequence_name);
    if (ownedName) {
        return {
            kind: 'sequence',
            name: ownedName,
            schemaName: nonEmpty(column.owned_sequence_schema),
        };
    }
    return parseNextValue(column.column_default);
}

function parseNextValue(sql: string | null): StoreGenerationStrategy | undefined {
    const match = /^\s*nextval\s*\(\s*'((?:''|[^'])+)'::regclass\s*\)\s*$/i.exec(
        sql ?? '',
    );
    if (!match) {
        return undefined;
    }
    const qualified = splitQualifiedIdentifier(match[1].replace(/''/g, '\''));
    const name = qualified.at(-1);
    if (!name) {
        return undefined;
    }
    return {
        kind: 'sequence',
        name,
        schemaName: qualified.length > 1 ? qualified.at(-2) : undefined,
    };
}

function splitQualifiedIdentifier(value: string): string[] {
    const parts: string[] = [];
    let part = '';
    let quoted = false;
    for (let index = 0; index < value.length; index++) {
        const character = value[index];
        if (character === '"') {
            if (quoted && value[index + 1] === '"') {
                part += '"';
                index++;
            } else {
                quoted = !quoted;
            }
        } else if (character === '.' && !quoted) {
            parts.push(part);
            part = '';
        } else {
            part += character;
        }
    }
    parts.push(part);
    return parts.filter(Boolean);
}

function scalar(value: number | string | null | undefined): string | undefined {
    return value === null || value === undefined ? undefined : String(value);
}

function optionalNumber(
    value: number | string | null | undefined,
): number | undefined {
    return value === null || value === undefined ? undefined : Number(value);
}

function nonEmpty(value: string | null | undefined): string | undefined {
    const normalized = value?.trim();
    return normalized && normalized.length > 0 ? normalized : undefined;
}
