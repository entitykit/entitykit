import { applyMaterializedValues } from '../src/materialization/complex-value-materializer';
import {
    ensureComplexPropertyPathFailureAtomic,
} from '../src/materialization/complex-property-path-write';
import { ModelBuilder } from '../src/model/model-builder';
import { RestorationScope } from '../src/restoration-scope';
import { syncDatabaseVersions } from '../src/tracking/entity-entry-version-sync';

class Revision {
    public version?: number | null;
}

class Details {
    public revision?: Revision | null;
    public unrelated?: Revision | null;
    public note?: string | null;
}

class AtomicPathRow {
    public id = 'row_1';
    public details?: Details | null;
    public directVersion = 1;
    public label = 'before';
}

const metadata = new ModelBuilder().entity(AtomicPathRow, entity => {
    entity.toTable('atomic_path_rows');
    entity.hasKey(value => value.id);
    entity.property(value => value.id).hasColumnType('text').isRequired();
    entity.property(value => value.label).hasColumnType('text').isRequired();
    entity.property(value => value.directVersion)
        .hasColumnType('integer').isRequired().isVersion();
    entity.complexProperty(
        value => value.details,
        { constructor: Details },
        details => {
            details.property(value => value.note)
                .hasColumnType('text').isOptional();
            details.complexProperty(
                value => value.revision,
                { constructor: Revision },
                revision => {
                    revision.property(value => value.version)
                        .hasColumnType('integer').isOptional().isVersion();
                },
            );
            details.complexProperty(
                value => value.unrelated,
                { constructor: Revision },
                unrelated => {
                    unrelated.property(value => value.version)
                        .hasColumnType('integer').isOptional();
                },
            );
        },
    );
}).build().getEntity(AtomicPathRow);

describe('concurrency atomic write primitives', () => {
    it('creates only missing ancestors of the requested complex path', () => {
        const row = new AtomicPathRow();
        const scope = new RestorationScope(() => undefined);
        const path = metadata.getProperty('details.revision.version').propertyPath;

        ensureComplexPropertyPathFailureAtomic(metadata, row, path, scope);
        const details = row.details;
        expect(details).toBeInstanceOf(Details);
        expect(details?.revision).toBeInstanceOf(Revision);
        expect(details?.unrelated).toBeUndefined();
        ensureComplexPropertyPathFailureAtomic(metadata, row, path, scope);
        expect(row.details).toBe(details);
    });

    it('does not create the complex value at the requested path itself', () => {
        const row = new AtomicPathRow();
        const scope = new RestorationScope(() => undefined);

        ensureComplexPropertyPathFailureAtomic(
            metadata, row, ['details', 'revision'], scope,
        );

        expect(row.details).toBeInstanceOf(Details);
        expect(row.details?.revision).toBeUndefined();
        expect(row.details?.unrelated).toBeUndefined();
    });

    it('restores an ancestor whose setter mutates before throwing', () => {
        const row = new AtomicPathRow();
        const primary = Symbol('ancestor failed');
        installDetailsFailure(row, primary);
        const scope = new RestorationScope(() => undefined);
        const path = metadata.getProperty('details.revision.version').propertyPath;

        expect(captureThrow(() => {
            ensureComplexPropertyPathFailureAtomic(
                metadata, row, path, scope,
            );
        })).toBe(primary);
        expect(row.details).toBeUndefined();
    });

    it('records a silently refused ancestor restoration with its full path', () => {
        const row = new AtomicPathRow();
        const primary = new Error('ancestor failed');
        installDetailsFailure(row, primary, true);
        const marked = jest.fn();
        const scope = new RestorationScope(marked);
        const path = metadata.getProperty('details.revision.version').propertyPath;

        expect(() => {
            ensureComplexPropertyPathFailureAtomic(
                metadata, row, path, scope,
            );
        }).toThrow(primary);
        expect(() => {
            scope.throwIfFailed();
        }).toThrow('Property \'AtomicPathRow.details\' refused its restoration value.');
        expect(marked).toHaveBeenCalledTimes(1);
    });

    it('uses atomic writes for complex materialization', () => {
        const row = new AtomicPathRow();
        const scope = new RestorationScope(() => undefined);
        applyMaterializedValues(metadata, row, {
            id: 'row_1', label: 'after', directVersion: 2,
            'details.note': 'note', 'details.revision.version': 3,
        }, scope);

        expect(row).toMatchObject({
            id: 'row_1', label: 'after', directVersion: 2,
            details: { note: 'note', revision: { version: 3 } },
        });
    });

    it('syncs only versions and preserves a missing null complex value', () => {
        const row = new AtomicPathRow();
        const scope = new RestorationScope(() => undefined);
        syncDatabaseVersions(metadata, row, {
            id: 'other', label: 'ignored', directVersion: 2,
            'details.note': 'ignored', 'details.revision.version': null,
        }, scope);

        expect(row).toMatchObject({
            id: 'row_1', label: 'before', directVersion: 2,
        });
        expect(row.details).toBeUndefined();
    });
});

function installDetailsFailure(
    row: AtomicPathRow,
    primary: unknown,
    refuseRestoration = false,
): void {
    let stored = row.details;
    Object.defineProperty(row, 'details', {
        configurable: true, enumerable: true, get: () => stored,
        set: (value: Details | null | undefined) => {
            if (value === undefined && stored !== undefined && refuseRestoration) {
                return;
            }
            stored = value;
            if (value instanceof Details) throw primary;
        },
    });
}

function captureThrow(action: () => void): unknown {
    try {
        action();
    } catch (error) {
        return error;
    }
    throw new Error('Expected operation to throw.');
}
