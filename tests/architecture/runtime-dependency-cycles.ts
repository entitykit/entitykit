import type { RuntimeDependencyGraph } from './runtime-dependency-graph';

export function findRuntimeDependencyCycles(
    graph: RuntimeDependencyGraph,
): ReadonlyArray<readonly string[]> {
    const complete: Set<string> = new Set();
    const activeIndex: Map<string, number> = new Map();
    const stack: string[] = [];
    const cycles: Map<string, readonly string[]> = new Map();

    const visit = (module: string): void => {
        const cycleStart = activeIndex.get(module);
        if (cycleStart !== undefined) {
            const cycle = canonicalCycle([...stack.slice(cycleStart), module]);
            cycles.set(cycle.join('\0'), cycle);
            return;
        }
        if (complete.has(module)) {
            return;
        }

        activeIndex.set(module, stack.length);
        stack.push(module);
        for (const dependency of graph.get(module) ?? []) {
            visit(dependency);
        }
        stack.pop();
        activeIndex.delete(module);
        complete.add(module);
    };

    for (const module of [...graph.keys()].sort()) {
        visit(module);
    }

    return [...cycles.values()].sort((left, right) =>
        left.join('\0').localeCompare(right.join('\0')),
    );
}

function canonicalCycle(cycle: readonly string[]): readonly string[] {
    const nodes = cycle.slice(0, -1);
    let first = 0;
    for (let index = 1; index < nodes.length; index += 1) {
        if ((nodes[index] ?? '').localeCompare(nodes[first] ?? '') < 0) {
            first = index;
        }
    }
    const ordered = [...nodes.slice(first), ...nodes.slice(0, first)];
    return [...ordered, ordered[0] ?? ''];
}
