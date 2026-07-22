import { ModelBuilder as ModelBuilderImplementation } from '../src/model/model-builder';
import type { EntityMetadata } from '../src/model/entity-metadata';
import { Materializer } from '../src/experimental';
import { ChangeTracker } from '../src/tracking/change-tracker';

class User {
    public id!: string;
    public email!: string;

    constructor(data?: Partial<User>) {
        Object.assign(this, data);
    }
}

function createMetadata(): EntityMetadata<User> {
    const model = new ModelBuilderImplementation();
    model.entity(User, entity => {
        entity.toTable('users');
        entity.hasKey(user => user.id);
        entity.property(user => user.id).hasColumnName('id').hasColumnType('text').isRequired();
        entity.property(user => user.email).hasColumnName('email').hasColumnType('text').isRequired();
    });
    return model.build().getEntity(User);
}

describe('Materializer identity guarantees', () => {
    it('returns the tracked instance for a row it has already materialized', () => {
        const metadata = createMetadata();
        const tracker = new ChangeTracker();
        const materializer = new Materializer();
        const row = { id: 'usr_1', email: 'a@example.com' };

        const first = materializer.materialize(metadata, row, tracker);
        const second = materializer.materialize(metadata, row, tracker);

        expect(first).toBe(second);
        expect(tracker.entries()).toHaveLength(1);
    });

    it('never returns an untracked instance, even if the identity lookup misses', () => {
        const metadata = createMetadata();
        const tracker = new ChangeTracker();
        const materializer = new Materializer();
        const row = { id: 'usr_1', email: 'a@example.com' };

        const first = materializer.materialize(metadata, row, tracker);

        // Force the identity lookup to miss while the entity still tracks under its
        // real key. A key converter can make the lookup value and the identity key
        // disagree. `track` then finds the
        // collision, and the materializer must hand back the instance it already
        // holds rather than the duplicate it just built — an untracked duplicate is
        // what silently discarded edits.
        jest.spyOn(metadata, 'readKeyValue').mockImplementation(value => `mismatched:${String(value)}`);

        const second = materializer.materialize(metadata, row, tracker);

        expect(second).toBe(first);
        expect(tracker.entry(second)).toBeDefined();
        expect(tracker.entries()).toHaveLength(1);

        jest.restoreAllMocks();
    });
});
