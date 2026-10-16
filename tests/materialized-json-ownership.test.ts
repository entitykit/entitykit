import { compileModel, type ModelBuilder as PublicModelBuilder } from '../packages/core/src';
import { Materializer } from '../packages/core/src/experimental';
import { compiledModelMetadata } from '../packages/core/src/model/compiled-model';
import { ModelBuilder } from '../packages/core/src/model/model-builder';
import type { EntityMetadata } from '../packages/core/src/model/entity-metadata';
import { materializedPersistenceFacts } from '../packages/core/src/materialization/materialized-bound-values';
import { requireDefined } from './support/require-defined';

class JsonRow {
    public id = 0;
    public document: unknown;
}

function metadata(compiled: boolean): EntityMetadata<JsonRow> {
    const configure = (model: PublicModelBuilder): void => {
        model.entity(JsonRow, entity => {
            entity.toTable('json_rows').hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer');
            entity.property(row => row.document).hasColumnType('jsonb');
        });
    };
    if (compiled) return compiledModelMetadata(compileModel(configure, { provider: 'postgres' })).getEntity(JsonRow);
    const builder = new ModelBuilder();configure(builder);
    return builder.build().getEntity(JsonRow);
}

function defineFirst(target: unknown[], value: unknown): void {
    Object.defineProperty(target, '0', {
        configurable: true, enumerable: true, writable: true, value,
    });
}

function restoreFirst(descriptor: PropertyDescriptor | undefined): void {
    if (descriptor) Object.defineProperty(Array.prototype, '0', descriptor);
    else Reflect.deleteProperty(Array.prototype, '0');
}

describe('JSON ownership observations during materialization', () => {
    it.each([false, true])('validates a copy changed by a later source getter, compiled %s', compiled => {
        const model = metadata(compiled);
        const prior = Object.getOwnPropertyDescriptor(Array.prototype, '0');
        expect(prior).toBeUndefined();
        let reads = 0, copies = 0, failure: unknown;
        let exposed: Array<Record<string, unknown>> | undefined;
        const source = {
            list: [{ proofMarker: 1 }],
            get trigger() {
                reads++;
                if (reads === 2) {
                    requireDefined(requireDefined(exposed)[0]).poison = (): undefined => undefined;
                }
                return 'after';
            },
        };
        try {
            Object.defineProperty(Array.prototype, '0', {
                configurable: true,
                set(this: unknown[], value: unknown) {
                    defineFirst(this, value);
                    if (value !== null && typeof value === 'object' && Object.hasOwn(value, 'proofMarker')) {
                        copies++;
                        if (copies === 2) exposed = this as Array<Record<string, unknown>>;
                    }
                },
            });
            try {
                new Materializer().materializeUntracked(model, { id: 1, document: source });
            } catch (error) {
                failure = error;
            }
        } finally {
            restoreFirst(prior);
        }
        expect(reads).toBe(2);
        expect(copies).toBeGreaterThanOrEqual(2);
        expect(exposed).not.toBe(source.list);
        expect(requireDefined(exposed)[0]).not.toBe(source.list[0]);
        expect(source.list).toEqual([{ proofMarker: 1 }]);
        expect(failure).toBeInstanceOf(TypeError);
        expect((failure as Error).message).toContain('\'JsonRow.document.list[0].poison\' (function)');
    });

    it.each([false, true])('owns earlier values when a later source getter mutates its input, compiled %s', compiled => {
        const model = metadata(compiled);
        let reads = 0;
        const source = {
            list: [{ proofMarker: 1 }],
            get trigger() {
                reads++;
                if (reads === 2) requireDefined(source.list[0]).proofMarker = 99;
                return 'after';
            },
        };
        const entity = new Materializer().materializeUntracked(model, { id: 2, document: source });
        const bound = requireDefined(materializedPersistenceFacts(entity)).boundValues.document;
        expect(reads).toBe(2);
        expect(source.list).toEqual([{ proofMarker: 99 }]);
        expect(entity.document).toEqual({ list: [{ proofMarker: 1 }], trigger: 'after' });
        expect(bound).toBe('{"list":[{"proofMarker":1}],"trigger":"after"}');
    });
});
