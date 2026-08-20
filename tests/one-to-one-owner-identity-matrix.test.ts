import type {
    DbContextOptionsBuilder,
    ModelBuilder,
    ValueConverter,
} from '../packages/core/src';
import { DbContext, DeleteBehavior, valueConverter } from '../packages/core/src';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

class NumericOwner {
    public id = 0; public profile: NumericProfile | null = null;
}
class NumericProfile {
    public id = ''; public ownerId = 0; public owner: NumericOwner | null = null;
}
class BigIntOwner {
    public id = 0n; public profile: BigIntProfile | null = null;
}
class BigIntProfile {
    public id = ''; public ownerId = 0n; public owner: BigIntOwner | null = null;
}
class StrongOwnerId {
    constructor(public readonly value: string) {}
}
class ConvertedOwner {
    public id = new StrongOwnerId(''); public profile: ConvertedProfile | null = null;
}
class ConvertedProfile {
    public id = ''; public ownerId = new StrongOwnerId(''); public owner: ConvertedOwner | null = null;
}
class CompositeOwner {
    public id = 0; public region = ''; public profile: CompositeProfile | null = null;
}
class CompositeProfile {
    public id = ''; public ownerId = 0; public ownerRegion = ''; public owner: CompositeOwner | null = null;
}
class GeneratedOwner {
    public id = 0; public profile: GeneratedProfile | null = null;
}
class GeneratedProfile {
    public id = ''; public ownerId = 0; public owner: GeneratedOwner | null = null;
}
class GeneratedBigIntOwner {
    public id = 0n; public profile: GeneratedBigIntProfile | null = null;
}
class GeneratedBigIntProfile {
    public id = ''; public ownerId = 0n;
    public owner: GeneratedBigIntOwner | null = null;
}

let observedStrongId: StrongOwnerId | undefined;
let observedStrongIdConversions = 0;
const normalizedId: ValueConverter<StrongOwnerId, string> = valueConverter({
    toProvider: value => {
        if (value === observedStrongId) observedStrongIdConversions += 1;
        return value.value.toLowerCase();
    },
    fromProvider: value => new StrongOwnerId(value),
});

class IdentityMatrixContext extends DbContext {
    public numericOwners = this.set(NumericOwner);
    public numericProfiles = this.set(NumericProfile);
    public bigintProfiles = this.set(BigIntProfile);
    public convertedProfiles = this.set(ConvertedProfile);
    public compositeProfiles = this.set(CompositeProfile);
    public generatedOwners = this.set(GeneratedOwner);
    public generatedProfiles = this.set(GeneratedProfile);
    public generatedBigIntOwners = this.set(GeneratedBigIntOwner);
    public generatedBigIntProfiles = this.set(GeneratedBigIntProfile);

    constructor(private readonly connection: RecordingDatabaseConnection) {
        super();
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(this.connection);
    }

    protected override model(model: ModelBuilder): void {
        model.entity(NumericOwner, entity => {
            entity.toTable('numeric_owners');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer').isRequired();
        });
        model.entity(NumericProfile, entity => {
            entity.toTable('numeric_profiles');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.ownerId).hasColumnType('integer').isRequired();
            entity.hasOne(NumericOwner, row => row.owner).withOne(row => row.profile)
                .hasForeignKey(row => row.ownerId).onDelete(DeleteBehavior.Cascade);
        });
        model.entity(BigIntOwner, entity => {
            entity.toTable('bigint_owners');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('bigint').isRequired();
        });
        model.entity(BigIntProfile, entity => {
            entity.toTable('bigint_profiles');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.ownerId).hasColumnType('bigint').isRequired();
            entity.hasOne(BigIntOwner, row => row.owner).withOne(row => row.profile)
                .hasForeignKey(row => row.ownerId).onDelete(DeleteBehavior.Cascade);
        });
        model.entity(ConvertedOwner, entity => {
            entity.toTable('converted_owners');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired()
                .hasConversion(normalizedId);
        });
        model.entity(ConvertedProfile, entity => {
            entity.toTable('converted_profiles');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.ownerId).hasColumnType('text').isRequired()
                .hasConversion(normalizedId);
            entity.hasOne(ConvertedOwner, row => row.owner).withOne(row => row.profile)
                .hasForeignKey(row => row.ownerId).onDelete(DeleteBehavior.Cascade);
        });
        model.entity(CompositeOwner, entity => {
            entity.toTable('composite_owners');
            entity.hasKey(row => [row.id, row.region]);
            entity.property(row => row.id).hasColumnType('integer').isRequired();
            entity.property(row => row.region).hasColumnType('text').isRequired();
        });
        model.entity(CompositeProfile, entity => {
            entity.toTable('composite_profiles');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.ownerId).hasColumnType('integer').isRequired();
            entity.property(row => row.ownerRegion).hasColumnType('text').isRequired();
            entity.hasOne(CompositeOwner, row => row.owner).withOne(row => row.profile)
                .hasForeignKey(row => [row.ownerId, row.ownerRegion])
                .onDelete(DeleteBehavior.Cascade);
        });
        model.entity(GeneratedOwner, entity => {
            entity.toTable('generated_owners');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer').isRequired()
                .valueGeneratedOnAdd();
        });
        model.entity(GeneratedProfile, entity => {
            entity.toTable('generated_profiles');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.ownerId).hasColumnType('integer').isRequired();
            entity.hasOne(GeneratedOwner, row => row.owner).withOne(row => row.profile)
                .hasForeignKey(row => row.ownerId).onDelete(DeleteBehavior.Cascade);
        });
        model.entity(GeneratedBigIntOwner, entity => {
            entity.toTable('generated_bigint_owners');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('bigint').isRequired()
                .valueGeneratedOnAdd();
        });
        model.entity(GeneratedBigIntProfile, entity => {
            entity.toTable('generated_bigint_profiles');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.ownerId).hasColumnType('bigint').isRequired();
            entity.hasOne(GeneratedBigIntOwner, row => row.owner)
                .withOne(row => row.profile)
                .hasForeignKey(row => row.ownerId)
                .onDelete(DeleteBehavior.Cascade);
        });
    }
}

function expectConflict(operation: () => void): void {
    expect(operation).toThrow(
        'has more than one explicit dependent for the same principal',
    );
}

describe('one-to-one final owner provider identities', () => {
    it('matches tracked numeric claims', () => {
        const db = IdentityMatrixContext.create(new RecordingDatabaseConnection());
        db.numericOwners.attach(Object.assign(new NumericOwner(), { id: 7 }));
        db.numericProfiles.add(Object.assign(new NumericProfile(), { id: 'a', ownerId: 7 }));
        db.numericProfiles.add(Object.assign(new NumericProfile(), { id: 'b', ownerId: 7 }));

        expectConflict(() => {
            db.changeTracker.detectChanges();
        });
    });

    it('matches untracked BigInt FK-only claims', () => {
        const db = IdentityMatrixContext.create(new RecordingDatabaseConnection());
        db.bigintProfiles.add(Object.assign(new BigIntProfile(), { id: 'a', ownerId: 7n }));
        db.bigintProfiles.add(Object.assign(new BigIntProfile(), { id: 'b', ownerId: 7n }));

        expectConflict(() => {
            db.changeTracker.detectChanges();
        });
    });

    it('matches converted claims by normalized provider value', () => {
        const db = IdentityMatrixContext.create(new RecordingDatabaseConnection());
        db.convertedProfiles.add(Object.assign(new ConvertedProfile(), {
            id: 'a', ownerId: new StrongOwnerId('OWNER-7'),
        }));
        db.convertedProfiles.add(Object.assign(new ConvertedProfile(), {
            id: 'b', ownerId: new StrongOwnerId('owner-7'),
        }));

        expectConflict(() => {
            db.changeTracker.detectChanges();
        });
    });

    it('captures one untracked converted navigation target once', () => {
        const db = IdentityMatrixContext.create(new RecordingDatabaseConnection());
        const owner = Object.assign(new ConvertedOwner(), {
            id: new StrongOwnerId('OWNER-7'),
        });
        db.convertedProfiles.add(Object.assign(new ConvertedProfile(), {
            id: 'a', owner,
        }));
        db.convertedProfiles.add(Object.assign(new ConvertedProfile(), {
            id: 'b', owner,
        }));
        observedStrongId = owner.id;
        observedStrongIdConversions = 0;

        try {
            expectConflict(() => {
                db.changeTracker.detectChanges();
            });
            expect(observedStrongIdConversions).toBe(1);
        } finally {
            observedStrongId = undefined;
        }
    });

    it('matches composite FK-only claims as ordered provider tuples', () => {
        const db = IdentityMatrixContext.create(new RecordingDatabaseConnection());
        db.compositeProfiles.add(Object.assign(new CompositeProfile(), {
            id: 'a', ownerId: 7, ownerRegion: 'north',
        }));
        db.compositeProfiles.add(Object.assign(new CompositeProfile(), {
            id: 'b', ownerId: 7, ownerRegion: 'north',
        }));

        expectConflict(() => {
            db.changeTracker.detectChanges();
        });
    });

    it('rejects an FK-only claim beside temporary numeric navigation', () => {
        const db = IdentityMatrixContext.create(new RecordingDatabaseConnection());
        const owner = new GeneratedOwner();
        db.generatedOwners.add(owner);
        db.generatedProfiles.add(Object.assign(new GeneratedProfile(), {
            id: 'a', owner,
        }));
        db.generatedProfiles.add(Object.assign(new GeneratedProfile(), {
            id: 'b', ownerId: 0,
        }));

        expect(() => {
            db.changeTracker.detectChanges();
        }).toThrow('cannot infer a newly added principal');
    });

    it('rejects an FK-only claim beside temporary BigInt navigation', () => {
        const db = IdentityMatrixContext.create(new RecordingDatabaseConnection());
        const owner = new GeneratedBigIntOwner();
        db.generatedBigIntOwners.add(owner);
        db.generatedBigIntProfiles.add(Object.assign(
            new GeneratedBigIntProfile(), { id: 'a', owner },
        ));
        db.generatedBigIntProfiles.add(Object.assign(
            new GeneratedBigIntProfile(), { id: 'b', ownerId: 0n },
        ));

        expect(() => {
            db.changeTracker.detectChanges();
        }).toThrow('cannot infer a newly added principal');
    });

    it('rejects an ambiguous FK shared by temporary generated principals', () => {
        const db = IdentityMatrixContext.create(new RecordingDatabaseConnection());
        db.generatedOwners.add(new GeneratedOwner());
        db.generatedOwners.add(new GeneratedOwner());
        db.generatedProfiles.add(Object.assign(new GeneratedProfile(), {
            id: 'a', ownerId: 0,
        }));

        expect(() => {
            db.changeTracker.detectChanges();
        }).toThrow('more than one tracked principal has the same unresolved');
    });

    it('keeps distinct temporary generated principals isolated', () => {
        const db = IdentityMatrixContext.create(new RecordingDatabaseConnection());
        const firstOwner = new GeneratedOwner();
        const secondOwner = new GeneratedOwner();
        db.generatedOwners.add(firstOwner);
        db.generatedOwners.add(secondOwner);
        db.generatedProfiles.add(Object.assign(new GeneratedProfile(), {
            id: 'a', owner: firstOwner,
        }));
        db.generatedProfiles.add(Object.assign(new GeneratedProfile(), {
            id: 'b', owner: secondOwner,
        }));

        expect(() => {
            db.changeTracker.detectChanges();
        }).not.toThrow();
    });

    it('validates a large FK-only tracker without principal rescans', () => {
        const db = IdentityMatrixContext.create(
            new RecordingDatabaseConnection(),
        );
        for (let index = 1; index <= 2_000; index++) {
            db.bigintProfiles.add(Object.assign(new BigIntProfile(), {
                id: `profile-${String(index)}`,
                ownerId: BigInt(index),
            }));
        }

        expect(() => {
            db.changeTracker.detectChanges();
        }).not.toThrow();
    });
});
