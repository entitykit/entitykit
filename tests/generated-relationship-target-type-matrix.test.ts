import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import { DbContext, valueConverter } from '../src';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

class BigTarget {
    public id = 0n;
    public dependents: BigDependent[] = [];
}

class BigDependent {
    public id = '';
    public targetId: bigint | null | undefined = 0n;
    public target: BigTarget | null = null;
}

class ConvertedTarget {
    public id = '0';
    public dependents: ConvertedDependent[] = [];
}

class ConvertedDependent {
    public id = '';
    public targetId = '0';
    public target: ConvertedTarget | null = null;
}

class CompositeTarget {
    public region = '';
    public id = 0;
    public dependents: CompositeDependent[] = [];
}

class CompositeDependent {
    public id = '';
    public targetRegion = '';
    public targetId = 0;
    public target: CompositeTarget | null = null;
}

class TenantTarget {
    public id = 0;
    public tenantId = '';
    public dependents: TenantDependent[] = [];
}

class TenantDependent {
    public id = '';
    public tenantId = '';
    public targetId = 0;
    public target: TenantTarget | null = null;
}

const stringNumber = valueConverter<string, number>({
    toProvider: value => Number(value),
    fromProvider: value => String(value),
});

let currentTypeTenant = 'tenant-b';

class RelationshipTargetTypeContext extends DbContext {
    public bigTargets = this.set(BigTarget);
    public bigDependents = this.set(BigDependent);
    public convertedTargets = this.set(ConvertedTarget);
    public convertedDependents = this.set(ConvertedDependent);
    public compositeTargets = this.set(CompositeTarget);
    public compositeDependents = this.set(CompositeDependent);
    public tenantTargets = this.set(TenantTarget);
    public tenantDependents = this.set(TenantDependent);

    constructor(private readonly connection: RecordingDatabaseConnection) {
        super();
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(this.connection)
            .useTenantScope(() => currentTypeTenant);
    }

    protected override model(model: ModelBuilder): void {
        model.entity(BigTarget, entity => {
            entity.toTable('big_targets');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('bigint')
                .isRequired().valueGeneratedOnAdd();
        });
        model.entity(BigDependent, entity => {
            entity.toTable('big_dependents');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.targetId).hasColumnType('bigint')
                .isOptional();
            entity.hasOne(BigTarget, row => row.target)
                .withMany(row => row.dependents)
                .hasForeignKey(row => row.targetId);
        });
        model.entity(ConvertedTarget, entity => {
            entity.toTable('converted_targets');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer')
                .hasConversion(stringNumber).isRequired().valueGeneratedOnAdd();
        });
        model.entity(ConvertedDependent, entity => {
            entity.toTable('converted_dependents');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.targetId).hasColumnType('integer')
                .hasConversion(stringNumber).isRequired();
            entity.hasOne(ConvertedTarget, row => row.target)
                .withMany(row => row.dependents)
                .hasForeignKey(row => row.targetId);
        });
        model.entity(CompositeTarget, entity => {
            entity.toTable('composite_targets');
            entity.hasKey(row => [row.region, row.id]);
            entity.property(row => row.region).hasColumnType('text').isRequired();
            entity.property(row => row.id).hasColumnType('integer')
                .isRequired().valueGeneratedOnAdd();
        });
        model.entity(CompositeDependent, entity => {
            entity.toTable('composite_dependents');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.targetRegion).hasColumnType('text')
                .isRequired();
            entity.property(row => row.targetId).hasColumnType('integer')
                .isRequired();
            entity.hasOne(CompositeTarget, row => row.target)
                .withMany(row => row.dependents)
                .hasForeignKey(row => [row.targetRegion, row.targetId]);
        });
        model.entity(TenantTarget, entity => {
            entity.toTable('tenant_targets');
            entity.hasKey(row => row.id);
            entity.tenantKey(row => row.tenantId);
            entity.property(row => row.id).hasColumnType('integer')
                .isRequired().valueGeneratedOnAdd();
            entity.property(row => row.tenantId).hasColumnType('text')
                .isRequired();
        });
        model.entity(TenantDependent, entity => {
            entity.toTable('tenant_dependents');
            entity.hasKey(row => row.id);
            entity.tenantKey(row => row.tenantId);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.tenantId).hasColumnType('text')
                .isRequired();
            entity.property(row => row.targetId).hasColumnType('integer')
                .isRequired();
            entity.hasOne(TenantTarget, row => row.target)
                .withMany(row => row.dependents)
                .hasForeignKey(row => row.targetId);
        });
    }
}

function context(): RelationshipTargetTypeContext {
    currentTypeTenant = 'tenant-b';
    return RelationshipTargetTypeContext.create(
        new RecordingDatabaseConnection(),
    );
}

function expectAmbiguous(operation: () => void): void {
    expect(operation).toThrow('has an ambiguous FK-only target');
}

describe('generated relationship target type matrix', () => {
    it('rejects repeated BigInt zero placeholders', () => {
        const db = context();
        db.bigTargets.add(new BigTarget());
        db.bigTargets.add(new BigTarget());
        db.bigDependents.add(Object.assign(new BigDependent(), { id: 'child' }));

        expectAmbiguous(() => {
            db.changeTracker.detectChanges();
        });
    });

    it('rejects converted string zero placeholders by provider value', () => {
        const db = context();
        db.convertedTargets.add(new ConvertedTarget());
        db.convertedTargets.add(new ConvertedTarget());
        db.convertedDependents.add(Object.assign(new ConvertedDependent(), {
            id: 'child', targetId: '0',
        }));

        expectAmbiguous(() => {
            db.changeTracker.detectChanges();
        });
    });

    it('rejects a repeated temporary component in a composite tuple', () => {
        const db = context();
        db.compositeTargets.add(Object.assign(new CompositeTarget(), {
            region: 'north',
        }));
        db.compositeTargets.add(Object.assign(new CompositeTarget(), {
            region: 'north',
        }));
        db.compositeDependents.add(Object.assign(new CompositeDependent(), {
            id: 'child', targetRegion: 'north', targetId: 0,
        }));

        expectAmbiguous(() => {
            db.changeTracker.detectChanges();
        });
    });

    it.each([null, undefined] as const)(
        'treats %s as no optional relationship target',
        targetId => {
            const db = context();
            const dependent = Object.assign(new BigDependent(), {
                id: 'child', targetId,
            });
            db.bigTargets.add(new BigTarget());
            db.bigTargets.add(new BigTarget());
            db.bigDependents.add(dependent);

            expect(() => {
                db.changeTracker.detectChanges();
            }).not.toThrow();
            expect(dependent.target).toBeNull();
        },
    );

    it('scopes equal temporary provider keys to the dependent tenant', () => {
        const db = context();
        const tenantA = Object.assign(new TenantTarget(), {
            tenantId: 'tenant-a',
        });
        const tenantB = Object.assign(new TenantTarget(), {
            tenantId: 'tenant-b',
        });
        const dependent = Object.assign(new TenantDependent(), {
            id: 'child', tenantId: 'tenant-b', targetId: 0,
        });
        currentTypeTenant = 'tenant-a';
        db.tenantTargets.add(tenantA);
        currentTypeTenant = 'tenant-b';
        db.tenantTargets.add(tenantB);
        db.tenantDependents.add(dependent);

        expect(() => {
            db.changeTracker.detectChanges();
        }).not.toThrow();

        expect(dependent.target).toBe(tenantB);
        expect(tenantA.dependents).toEqual([]);
        expect(tenantB.dependents).toEqual([dependent]);
    });

    it('propagates a generated BigInt key through one explicit added graph', async () => {
        const connection = new RecordingDatabaseConnection();
        const db = RelationshipTargetTypeContext.create(connection);
        const target = new BigTarget();
        const dependent = Object.assign(new BigDependent(), {
            id: 'child', target,
        });
        db.bigDependents.add(dependent);
        db.bigTargets.add(target);
        connection.queueResult({ rows: [{ id: 41n }], rowCount: 1 });
        connection.queueResult({ rowCount: 1 });

        await expect(db.saveChanges()).resolves.toBe(2);

        expect(target.id).toBe(41n);
        expect(dependent.targetId).toBe(41n);
        expect(connection.statements[1]?.values).toContain(41n);
    });

    it('propagates a converted generated key through one explicit added graph', async () => {
        const connection = new RecordingDatabaseConnection();
        const db = RelationshipTargetTypeContext.create(connection);
        const target = new ConvertedTarget();
        const dependent = Object.assign(new ConvertedDependent(), {
            id: 'child', target,
        });
        db.convertedDependents.add(dependent);
        db.convertedTargets.add(target);
        connection.queueResult({ rows: [{ id: 41 }], rowCount: 1 });
        connection.queueResult({ rowCount: 1 });

        await expect(db.saveChanges()).resolves.toBe(2);

        expect(target.id).toBe('41');
        expect(dependent.targetId).toBe('41');
        expect(connection.statements[1]?.values).toContain(41);
    });

    it('propagates one generated component through an added composite graph', async () => {
        const connection = new RecordingDatabaseConnection();
        const db = RelationshipTargetTypeContext.create(connection);
        const target = Object.assign(new CompositeTarget(), {
            region: 'north',
        });
        const dependent = Object.assign(new CompositeDependent(), {
            id: 'child', target,
        });
        db.compositeDependents.add(dependent);
        db.compositeTargets.add(target);
        connection.queueResult({ rows: [{ id: 41 }], rowCount: 1 });
        connection.queueResult({ rowCount: 1 });

        await expect(db.saveChanges()).resolves.toBe(2);

        expect(target.id).toBe(41);
        expect(dependent).toMatchObject({
            targetRegion: 'north', targetId: 41,
        });
        expect(connection.statements[1]?.values).toContain(41);
    });
});
