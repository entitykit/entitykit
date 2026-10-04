import { ModelBuilder } from '../packages/core/src/model/model-builder';

class BookCounter {
    public id!: number;
}

describe('sequence identifier preservation', () => {
    it.each([' counters ', 'counter.dot', 'counter"quote', 'counter\'quote', ' counter\tname '])(
        'retains declared sequence and property identifiers %s', name => {
            const schemaName = ' catalog.schema ';
            const model = new ModelBuilder()
                .hasSequence(name, sequence => sequence.hasSchema(schemaName))
                .entity(BookCounter, entity => {
                    entity.toTable('book_counters');
                    entity.hasKey(row => row.id);
                    entity.property(row => row.id).hasColumnType('bigint').useSequence(name, schemaName);
                }).build();

            expect(model.toSnapshot()).toMatchObject({
                sequences: [{ name, schemaName }],
                entities: [{ properties: [{ storeGeneration: { kind: 'sequence', name, schemaName } }] }],
            });
        },
    );

    it.each(['', ' \t '])('refuses a blank sequence name %s', name => {
        expect(() => new ModelBuilder().hasSequence(name)).toThrow('Sequence name must not be empty');
        expect(() => new ModelBuilder().entity(BookCounter, entity => {
            entity.property(row => row.id).useSequence(name);
        })).toThrow('sequence name must not be empty');
    });

    it.each(['', ' \t '])('refuses a blank sequence schema %s', schemaName => {
        expect(() => new ModelBuilder().hasSequence('counters', sequence => sequence.hasSchema(schemaName)))
            .toThrow('Sequence schema must not be empty');
        expect(() => new ModelBuilder().entity(BookCounter, entity => {
            entity.property(row => row.id).useSequence('counters', schemaName);
        })).toThrow('sequence schema must not be empty');
    });
});
