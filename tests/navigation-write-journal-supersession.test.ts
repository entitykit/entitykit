import { RestorationScope } from '../src/restoration-scope';
import { NavigationWriteJournal } from '../src/tracking/navigation-write-journal';

interface GraphNode {
    readonly id: string;
    items: object[];
    peer: object | null;
}

function graphNode(id: string, items: object[] = []): GraphNode {
    return { id, items, peer: null };
}

/** The refusal the journal reports for a navigation it no longer owns. */
function supersession(entityName: string, property: string): string {
    return `Navigation '${entityName}.${property}' changed while its load ` +
        'was in progress; rollback cannot safely overwrite the newer value.';
}

/** Report what the scope raises once every restoration phase has run. */
function failureFrom(scope: RestorationScope): Error {
    let thrown: unknown;
    try {
        scope.throwIfFailed();
    } catch (error) {
        thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    return thrown as Error;
}

/** The individual failures behind one collected restoration error. */
function failureMessages(failure: Error): string[] {
    return failure instanceof AggregateError
        ? (failure.errors as unknown[]).map(error => (error as Error).message)
        : [failure.message];
}

describe('navigation write journal supersession', () => {
    let marked: unknown[];
    let scope: RestorationScope;

    beforeEach(() => {
        marked = [];
        scope = new RestorationScope(failure => {
            marked.push(failure);
        });
    });

    it('refuses to restore a collection a newer value replaced', () => {
        const loaded = graphNode('loaded');
        const linked = graphNode('linked');
        const node = graphNode('node');
        const journal = new NavigationWriteJournal();

        journal.write(node, 'items', [loaded], 'Node');
        // The `link()` a paused load has no way of seeing.
        node.items = [loaded, linked];
        journal.rollback(scope);

        expect(node.items).toEqual([loaded, linked]);
        expect(failureFrom(scope).message).toBe(supersession('Node', 'items'));
        expect(marked).toHaveLength(1);
        expect((marked[0] as Error).message).toBe(supersession('Node', 'items'));
    });

    it('refuses to restore a reference a newer value replaced', () => {
        const loaded = graphNode('loaded');
        const moved = graphNode('moved');
        const node = graphNode('node');
        const journal = new NavigationWriteJournal();

        journal.write(node, 'peer', loaded, 'Node');
        node.peer = moved;
        journal.rollback(scope);

        expect(node.peer).toBe(moved);
        expect(failureFrom(scope).message).toBe(supersession('Node', 'peer'));
    });

    it('refuses to restore a container mutated in place after the write', () => {
        const loaded = graphNode('loaded');
        const pushed = graphNode('pushed');
        const node = graphNode('node');
        const journal = new NavigationWriteJournal();

        journal.write(node, 'items', [loaded], 'Node');
        // Domain code that mutates the live collection instead of replacing it
        // supersedes the load just as squarely; the journal compares against a
        // copy of what it published so the mutation is still visible here.
        node.items.push(pushed);
        journal.rollback(scope);

        expect(node.items).toEqual([loaded, pushed]);
        expect(failureFrom(scope).message).toBe(supersession('Node', 'items'));
    });

    it('still attempts every other phase around a superseded write', () => {
        const item = graphNode('item');
        const newer = graphNode('newer');
        const first = graphNode('first');
        const second = graphNode('second');
        const third = graphNode('third');
        const journal = new NavigationWriteJournal();

        journal.write(first, 'items', [item], 'First');
        journal.write(second, 'items', [item], 'Second');
        journal.write(third, 'items', [item], 'Third');
        second.items = [item, newer];
        journal.rollback(scope);

        expect(first.items).toEqual([]);
        expect(second.items).toEqual([item, newer]);
        expect(third.items).toEqual([]);
        expect(failureFrom(scope).message).toBe(supersession('Second', 'items'));
    });

    it('refuses the whole chain when one navigation moved on after both writes', () => {
        const first = graphNode('first');
        const second = graphNode('second');
        const newer = graphNode('newer');
        const node = graphNode('node', [first]);
        const journal = new NavigationWriteJournal();

        journal.write(node, 'items', [first, second], 'Node');
        journal.write(node, 'items', [second], 'Node');
        node.items = [newer];
        journal.rollback(scope);

        // The inner write cannot hand its value back, so the outer one must not
        // either: a partial unwind would publish an intermediate collection
        // that never described the graph anybody asked for.
        expect(node.items).toEqual([newer]);
        expect(failureMessages(failureFrom(scope))).toEqual([
            supersession('Node', 'items'),
            supersession('Node', 'items'),
        ]);
    });

    it('restores a forward write that threw before it was verified', () => {
        const refused = new Error('validating setter rejects the value');
        const before = graphNode('before');
        const after = graphNode('after');
        const node = graphNode('node');
        let stored: object[] = [before];
        Object.defineProperty(node, 'items', {
            configurable: true,
            enumerable: true,
            get: () => stored,
            // Half-applies, then rejects: the write leaves the navigation
            // holding something the journal never got to verify.
            set: (value: object[]) => {
                stored = [...value];
                throw refused;
            },
        });
        const journal = new NavigationWriteJournal();

        expect(() => journal.write(node, 'items', [after], 'Node'))
            .toThrow(refused);
        expect(node.items).toEqual([after]);
        journal.rollback(scope);

        // Nothing about that write can be claimed, but leaving it half applied
        // is worse than undoing it, so restoration stays unconditional.
        expect(node.items).toEqual([before]);
        expect(() => {
            scope.throwIfFailed();
        }).not.toThrow();
        expect(marked).toEqual([]);
    });

    it('fails closed when the conflict check cannot read the navigation', () => {
        const hostile = new Error('getter turned hostile after the write');
        const loaded = graphNode('loaded');
        const node = graphNode('node');
        const journal = new NavigationWriteJournal();
        journal.write(node, 'items', [loaded], 'Node');
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

        journal.rollback(scope);

        // Ownership is unknowable, so nothing is overwritten and the read
        // failure joins the operation's cleanup failures on its own.
        expect(assigned).toBe(0);
        expect(failureFrom(scope)).toBe(hostile);
        expect(marked).toEqual([hostile]);
    });
});
