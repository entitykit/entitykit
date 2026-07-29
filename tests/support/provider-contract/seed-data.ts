import type { ProviderContractDbContext } from './model';
import { ProviderContractChild, ProviderContractParent, ProviderContractValue } from './model';

/** Four values with two active/inactive each, for aggregate/group/filter shapes. */
export async function seedAggregateValues(db: ProviderContractDbContext): Promise<void> {
    const at = new Date('2026-03-04T05:06:07.000Z');
    const payload = { unit: 'celsius', samples: [] as number[] };
    const rows: ReadonlyArray<readonly [string, number, boolean]> = [
        ['a1', 10, true],
        ['a2', 20, true],
        ['a3', 30, false],
        ['a4', 40, false],
    ];
    for (const [id, score, isActive] of rows) {
        db.values.add(new ProviderContractValue({ id, isActive, recordedAt: at, payload, score, label: null }));
    }
    await db.saveChanges();
    db.changeTracker.clear();
}

/** Three parents (one childless) and three children, for join shapes. */
export async function seedJoinData(db: ProviderContractDbContext): Promise<void> {
    db.parents.add(new ProviderContractParent({ id: 'p1', name: 'Ana' }));
    db.parents.add(new ProviderContractParent({ id: 'p2', name: 'Bo' }));
    db.parents.add(new ProviderContractParent({ id: 'p3', name: 'Cy' }));
    await db.saveChanges();
    db.children.add(new ProviderContractChild({ id: 'c1', parentId: 'p1', score: 10 }));
    db.children.add(new ProviderContractChild({ id: 'c2', parentId: 'p1', score: 20 }));
    db.children.add(new ProviderContractChild({ id: 'c3', parentId: 'p2', score: 30 }));
    await db.saveChanges();
    db.changeTracker.clear();
}
