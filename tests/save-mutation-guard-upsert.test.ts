import { SaveMutationGuard } from '../src/tracking/save-mutation-guard';

describe('upsert input mutation reservations', () => {
    it('reserves a group atomically when one input is already held', () => {
        const guard = new SaveMutationGuard();
        const held = {};
        const other = {};
        const release = guard.reserveUpsertInputs([held]);

        expect(() => guard.reserveUpsertInputs([other, held])).toThrow(
            'an upsert input cannot become tracked or change tracking state until its transaction finishes',
        );
        expect(() => {
            guard.assertMutation('Tracking an entity', other);
        })
            .not.toThrow();
        expect(() => {
            guard.assertMutation('Tracking an entity', held);
        })
            .toThrow(
                'an upsert input cannot become tracked or change tracking state until its transaction finishes',
            );

        release();
        release();
        expect(() => {
            guard.assertMutation('Clearing tracked entities');
        })
            .not.toThrow();
    });
});
