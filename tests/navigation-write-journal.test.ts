import { RestorationScope } from '../src/restoration-scope';
import { NavigationWriteJournal } from '../src/tracking/navigation-write-journal';

interface GraphNode {
    readonly id: string;
    items: object[];
}

const writeLog: string[] = [];

function graphNode(id: string, items: object[] = []): GraphNode {
    return { id, items };
}

/** Log every collection assignment and let the fixture decide what is kept. */
function interceptItems(
    node: GraphNode,
    store: (value: object[]) => object[],
): void {
    let stored = node.items;
    Object.defineProperty(node, 'items', {
        configurable: true,
        enumerable: true,
        get: () => stored,
        set: (value: object[]) => {
            writeLog.push(`${node.id}=${value.map(item =>
                (item as GraphNode).id).join(',')}`);
            stored = store(value);
        },
    });
}

describe('navigation write journal', () => {
    beforeEach(() => {
        writeLog.length = 0;
    });

    it('restores every journaled write in reverse order', () => {
        const left = graphNode('left');
        const right = graphNode('right');
        const item = graphNode('item');
        interceptItems(left, value => value);
        interceptItems(right, value => value);
        const journal = new NavigationWriteJournal();

        journal.write(left, 'items', [item], 'Left');
        journal.write(right, 'items', [item], 'Right');
        writeLog.length = 0;
        const scope = new RestorationScope(() => undefined);
        journal.rollback(scope);

        expect(writeLog).toEqual(['right=', 'left=']);
        expect(left.items).toEqual([]);
        expect(right.items).toEqual([]);
        expect(() => {
            scope.throwIfFailed();
        }).not.toThrow();
    });

    it('unwinds several writes to one navigation back to the original', () => {
        const first = graphNode('first');
        const second = graphNode('second');
        const node = graphNode('node', [first]);
        interceptItems(node, value => value);
        const journal = new NavigationWriteJournal();

        journal.write(node, 'items', [first, second], 'Node');
        journal.write(node, 'items', [second], 'Node');
        writeLog.length = 0;
        const scope = new RestorationScope(() => undefined);
        journal.rollback(scope);

        // Each write hands back what the write before it published, so the
        // chain lands on the value the load found rather than on an
        // intermediate one -- and no step mistakes its own predecessor's
        // value for someone else having moved the navigation on.
        expect(writeLog).toEqual(['node=first,second', 'node=first']);
        expect(node.items).toEqual([first]);
        expect(() => {
            scope.throwIfFailed();
        }).not.toThrow();
    });

    it('attempts every restoration phase when one of them throws', () => {
        const hostile = new Error('restoration setter exploded');
        const first = graphNode('first');
        const second = graphNode('second');
        const third = graphNode('third');
        const item = graphNode('item');
        interceptItems(first, value => value);
        interceptItems(third, value => value);
        const journal = new NavigationWriteJournal();
        journal.write(first, 'items', [item], 'First');
        journal.write(second, 'items', [item], 'Second');
        journal.write(third, 'items', [item], 'Third');
        interceptItems(second, value => {
            if (value.length === 0) throw hostile;
            return value;
        });
        writeLog.length = 0;
        const marked: unknown[] = [];
        const scope = new RestorationScope(failure => {
            marked.push(failure);
        });

        journal.rollback(scope);

        expect(writeLog).toEqual(['third=', 'second=', 'first=']);
        expect(first.items).toEqual([]);
        expect(third.items).toEqual([]);
        expect(() => {
            scope.throwIfFailed();
        }).toThrow(hostile);
        expect(marked).toEqual([hostile]);
    });

    it('keeps the exact primary failure and poisons a refused restoration', () => {
        const before = graphNode('before');
        const after = graphNode('after');
        const node = graphNode('node', [before]);
        interceptItems(node, value => value.map(item =>
            ({ ...(item as GraphNode) })));
        const journal = new NavigationWriteJournal();
        const marked: unknown[] = [];
        const scope = new RestorationScope(failure => {
            marked.push(failure);
        });

        let primary: unknown;
        try {
            journal.write(node, 'items', [after], 'Node');
        } catch (error) {
            primary = error;
        }
        expect((primary as Error).message).toBe(
            'Navigation \'Node.items\' refused its assigned value.',
        );
        scope.capturePrimary(primary);
        journal.rollback(scope);

        expect(() => {
            scope.rethrowPrimary();
        }).toThrow(primary as Error);
        expect(marked).toHaveLength(1);
        expect((marked[0] as Error).message).toBe(
            'Navigation \'Node.items\' refused its restoration value.',
        );
        expect(writeLog).toEqual(['node=after', 'node=before']);
    });

    it('forgives a refused restoration the navigation already satisfies', () => {
        const live: object[] = [];
        const node = graphNode('node');
        Object.defineProperty(node, 'items', {
            configurable: true,
            enumerable: true,
            get: () => live,
        });
        const journal = new NavigationWriteJournal();
        const marked: unknown[] = [];
        const scope = new RestorationScope(failure => {
            marked.push(failure);
        });

        let primary: unknown;
        try {
            journal.write(node, 'items', [graphNode('item')], 'Node');
        } catch (error) {
            primary = error;
        }
        expect(primary).toBeInstanceOf(TypeError);
        scope.capturePrimary(primary);
        journal.rollback(scope);

        expect(node.items).toBe(live);
        expect(node.items).toEqual([]);
        expect(() => {
            scope.throwIfFailed();
        }).not.toThrow();
        expect(marked).toEqual([]);
        expect(() => {
            scope.rethrowPrimary();
        }).toThrow(primary as TypeError);
    });

    it('fails a refused restoration the navigation does not satisfy', () => {
        const refused = new Error('restoration setter refuses');
        const before = graphNode('before');
        const after = graphNode('after');
        const node = graphNode('node', [before]);
        let calls = 0;
        let stored = node.items;
        Object.defineProperty(node, 'items', {
            configurable: true,
            enumerable: true,
            get: () => stored,
            // Accept the forward write, then refuse to be rolled back.
            set: (value: object[]) => {
                calls += 1;
                if (calls > 1) throw refused;
                stored = value;
            },
        });
        const journal = new NavigationWriteJournal();
        const marked: unknown[] = [];
        const scope = new RestorationScope(failure => {
            marked.push(failure);
        });

        journal.write(node, 'items', [after], 'Node');
        journal.rollback(scope);

        expect(calls).toBe(2);
        expect(node.items).toEqual([after]);
        expect(() => {
            scope.throwIfFailed();
        }).toThrow(refused);
        expect(marked).toEqual([refused]);
    });

    it('fails closed when a refused restoration cannot read the navigation', () => {
        const hostile = new Error('getter turned hostile');
        const refused = new Error('setter refuses every write');
        const node = graphNode('node');
        let readable = true;
        Object.defineProperty(node, 'items', {
            configurable: true,
            enumerable: true,
            get: (): object[] => {
                if (!readable) throw hostile;
                return [];
            },
            set: (): never => {
                throw refused;
            },
        });
        const journal = new NavigationWriteJournal();
        const marked: unknown[] = [];
        const scope = new RestorationScope(failure => {
            marked.push(failure);
        });

        expect(() => journal.write(node, 'items', [], 'Node')).toThrow(refused);
        readable = false;
        journal.rollback(scope);

        expect(() => {
            scope.throwIfFailed();
        }).toThrow(refused);
        expect(marked).toEqual([refused]);
    });

    it('records nothing and writes nothing when the current value is unreadable', () => {
        const hostile = new Error('getter is hostile');
        const node = graphNode('node');
        let assigned = 0;
        Object.defineProperty(node, 'items', {
            configurable: true,
            enumerable: true,
            get: (): never => {
                throw hostile;
            },
            set: () => {
                assigned += 1;
            },
        });
        const journal = new NavigationWriteJournal();

        expect(() => journal.write(node, 'items', [], 'Node')).toThrow(hostile);
        expect(assigned).toBe(0);
        expect(journal.restorationActions()).toEqual([]);
    });
});
