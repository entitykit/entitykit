import { ModelBuilder as ModelBuilderImplementation } from '../src/model/model-builder';
import { Materializer } from '../src/experimental';
import { ChangeTracker } from '../src/tracking/change-tracker';

class NormalizingKeyUser {
    public static setterCalls = 0;
    private storedId = '';
    public name = '';

    public get id(): string {
        return this.storedId;
    }

    public set id(value: string) {
        NormalizingKeyUser.setterCalls++;
        this.storedId = value.toLowerCase();
    }
}

describe('materializer key normalization', () => {
    it('resolves captured row identity before a key setter normalizes it', () => {
        const metadata = new ModelBuilderImplementation()
            .entity(NormalizingKeyUser, entity => {
                entity.toTable('normalizing_key_users');
                entity.hasKey(user => user.id);
                entity.property(user => user.id)
                    .hasColumnType('text').isRequired();
                entity.property(user => user.name)
                    .hasColumnType('text').isRequired();
            })
            .build()
            .getEntity(NormalizingKeyUser);
        const tracker = new ChangeTracker();
        const materializer = new Materializer();
        NormalizingKeyUser.setterCalls = 0;

        const first = materializer.materialize(metadata, {
            id: 'USR_1',
            name: 'first',
        }, tracker);
        const second = materializer.materialize(metadata, {
            id: 'USR_1',
            name: 'database refresh',
        }, tracker);

        expect(first.id).toBe('usr_1');
        expect(second).toBe(first);
        expect(second.name).toBe('first');
        expect(NormalizingKeyUser.setterCalls).toBe(1);
        expect(tracker.entry(first)?.originalValues.id).toBe('USR_1');
    });
});
