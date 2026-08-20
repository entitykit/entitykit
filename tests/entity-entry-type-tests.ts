import { type EntityEntry, EntityState } from '../packages/core/src';

class TypeTestEntity {
    public id = '';
}

function assertEntryStateIsReadonly(
    entry: EntityEntry<TypeTestEntity>,
): void {
    // @ts-expect-error entity lifecycle transitions use DbSet/ChangeTracker APIs
    entry.state = EntityState.Deleted;
}

const internalEntityEntryMembers: ReadonlyArray<keyof EntityEntry<TypeTestEntity>> = [
    // @ts-expect-error internal state transitions are not application APIs
    'transitionToState',
    // @ts-expect-error deletion is coordinated through DbSet.remove()
    'markDeleted',
    // @ts-expect-error acceptance is coordinated by ChangeTracker
    'acceptChanges',
];

void assertEntryStateIsReadonly;
void internalEntityEntryMembers;
