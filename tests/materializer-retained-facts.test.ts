import { Materializer } from '../packages/core/src/materialization/materializer';
import { materializedPersistenceFacts } from '../packages/core/src/materialization/materialized-bound-values';
import { QueryIdentityResolution, useQueryIdentityResolution } from '../packages/core/src/materialization/query-identity-resolution';
import { ChangeTracker } from '../packages/core/src/tracking/change-tracker';
import { entityReadMetadata, PlannedRow } from './support/compiled-entity';
import { requireDefined } from './support/require-defined';

describe('entity-only materialization retains independent persistence facts', () => {
    it.each([false, true])('retains later setter effects with compiled metadata %s', compiled => {
        for (const columnType of ['text', 'json']) {
            for (const withValues of [false, true]) {
                let beforeSetter: number[] | undefined;
                class Row extends PlannedRow {
                    constructor() {
                        super();
                        let tail = 0;
                        Object.defineProperty(this, 'tail', {
                            get: () => tail,
                            set: (value: number) => {
                                const nested = (this.value as { nested: number[] }).nested;
                                beforeSetter = [...nested];
                                nested.push(9);
                                tail = value;
                            },
                        });
                    }
                }
                const metadata = entityReadMetadata(compiled, Row, columnType);
                const tracker = new ChangeTracker();
                const materializer = useQueryIdentityResolution(new Materializer(), new QueryIdentityResolution());
                const input = { id: 1, stored_value: { nested: [1] }, tail: 2 };
                const capture = withValues ? materializer.materializeWithValues(metadata, input, tracker) : undefined;
                const entity = capture?.entity ?? materializer.materialize(metadata, input, tracker);
                const facts = requireDefined(materializedPersistenceFacts(entity));
                const bound = columnType === 'json' ? '{"nested":[1]}' : { nested: [1] };
                expect(beforeSetter).toEqual([1]);
                expect(input.stored_value).toEqual({ nested: [1] });
                expect(facts.values.value).toEqual({ nested: [1, 9] });
                expect(facts.boundValues.value).toEqual(bound);
                if (capture) expect(capture.values.value).toBe(entity.value);
                (entity.value as { nested: number[] }).nested.push(7);
                (facts.values.value as { nested: number[] }).nested.push(8);
                if (columnType === 'text') {
                    (facts.boundValues.value as { nested: number[] }).nested.push(5);
                    if (capture) (capture.boundValues.value as { nested: number[] }).nested.push(6);
                }
                const retained = requireDefined(materializedPersistenceFacts(entity));
                expect(retained.values.value).toEqual({ nested: [1, 9] });
                expect(retained.boundValues.value).toEqual(bound);
                expect(tracker.entries()).toEqual([]);
            }
        }
    });

    it.each([false, true])('keeps duplicate-row captures separate from entity identity, compiled %s', compiled => {
        for (const queryLocal of [false, true]) {
            const metadata = entityReadMetadata(compiled);
            const tracker = new ChangeTracker();
            const receipts: object[] = [];
            const materializer = useQueryIdentityResolution(new Materializer(undefined, entry => receipts.push(entry)),
                queryLocal ? new QueryIdentityResolution() : undefined);
            const rows = [
                { id: 1, stored_value: { nested: [1] }, tail: 2 },
                { id: 1, stored_value: { nested: [9] }, tail: 3 },
            ];
            const entities = materializer.materializeMany(metadata, rows, tracker);
            expect(entities[0]).toBe(entities[1]);
            expect(entities[0].value).toEqual({ nested: [1] });
            const duplicate = materializer.materializeWithValues(metadata, rows[1], tracker);
            expect(duplicate.entity).toBe(entities[0]);
            expect(duplicate.values.value).toEqual({ nested: [9] });
            expect(requireDefined(materializedPersistenceFacts(duplicate.entity)).values.value).toEqual({ nested: [1] });
            expect(tracker.entries()).toHaveLength(queryLocal ? 0 : 1);
            expect(receipts).toHaveLength(queryLocal ? 0 : 1);
        }
    });
});
