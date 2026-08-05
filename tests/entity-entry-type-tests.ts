import { type EntityEntry, EntityState } from '../src';

class TypeTestEntity {
    public id = '';
}

function assertEntryStateIsReadonly(
    entry: EntityEntry<TypeTestEntity>,
): void {
    // @ts-expect-error entity lifecycle transitions use DbSet/ChangeTracker APIs
    entry.state = EntityState.Deleted;
}

void assertEntryStateIsReadonly;
