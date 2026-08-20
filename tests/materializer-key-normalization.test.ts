import { ModelBuilder as ModelBuilderImplementation } from '../packages/core/src/model/model-builder';
import { Materializer } from '../packages/core/src/experimental';
import { ChangeTracker } from '../packages/core/src/tracking/change-tracker';

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
    it('refuses a materialized key that a setter silently normalizes', () => {
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

        expect(() => materializer.materialize(metadata, {
            id: 'USR_1',
            name: 'first',
        }, tracker)).toThrow(
            'Property \'NormalizingKeyUser.id\' refused its assigned value.',
        );

        expect(NormalizingKeyUser.setterCalls).toBe(1);
        expect(tracker.entries()).toEqual([]);
    });
});
