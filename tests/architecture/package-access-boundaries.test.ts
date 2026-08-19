import {
    consumerSourceFiles,
    corePublicEntries,
    corePublicEntryNames,
    coreSourceFiles,
    corePackageConsumers,
    crossPackageReferences,
    futurePackageOf,
    servingEntries,
    type CrossPackageReference,
} from './package-access-test-support';

/**
 * The access discipline the monorepo cutover depends on.
 *
 * Once `src/providers/*`, `src/cli`, and `src/testing` become packages of their
 * own, a relative import that reaches across one of those boundaries has to be
 * rewritten into a package specifier. That rewrite is only mechanical while two
 * things hold:
 *
 *   1. every cross-boundary import from a consumer package lands in core, and
 *      binds only names some public core entry already re-exports; and
 *   2. core imports nothing from a consumer package, so the dependency arrow
 *      never has to be reversed.
 *
 * Break either and the split stops being a move and becomes a redesign, which
 * is why this file has no whitelist. Reachability is judged by name rather than
 * by module, matching what the rewrite will do: it repoints the specifier and
 * keeps the import clause.
 */

const entries = corePublicEntryNames();
const publicSubpaths = Object.keys(corePublicEntries).join(', ');

function describeReference(reference: CrossPackageReference): string {
    const names = reference.names.length > 0 ? reference.names.join(', ') : '<no named bindings>';
    return `${reference.from}:${String(reference.line)} -> ${reference.to} (${names})`;
}

const consumerReferences = consumerSourceFiles().flatMap(crossPackageReferences);

describe('package access boundaries', () => {
    it('assigns every source file to exactly one future package', () => {
        expect(futurePackageOf('src/index.ts')).toBe('core');
        expect(futurePackageOf('src/providers/postgres/index.ts')).toBe('postgres');
        expect(futurePackageOf('src/cli/api.ts')).toBe('cli');
        expect(futurePackageOf('src/testing/index.ts')).toBe('testing');
        expect(corePackageConsumers).toEqual(
            ['mysql', 'postgres', 'sqlite', 'cli', 'testing'],
        );
        expect(consumerSourceFiles().length).toBeGreaterThan(0);
        expect(coreSourceFiles().length).toBeGreaterThan(0);
    });

    it('publishes a non-empty export closure for every public core entry', () => {
        for (const [subpath, names] of entries) {
            expect(`${subpath}:${String(names.size > 0)}`).toBe(`${subpath}:true`);
        }
    });

    it('sends every cross-package import from a consumer package into core', () => {
        const offenders = consumerReferences
            .filter(reference => reference.toPackage !== 'core')
            .map(describeReference);

        expect(offenders).toEqual([]);
    });

    it('names what it imports, so the rewrite has something to repoint', () => {
        // A namespace import, a default import, a bare side-effect import, or a
        // runtime `require` across the seam cannot be checked for reachability
        // and cannot be rewritten by inspection.
        const offenders = consumerReferences
            .filter(reference => reference.opaque)
            .map(describeReference);

        expect(offenders).toEqual([]);
    });

    it(`reaches core only through names public on one of: ${publicSubpaths}`, () => {
        const offenders = consumerReferences
            .filter(reference => servingEntries(reference.names, entries).length === 0)
            .map(reference => {
                const [nearest] = [...entries]
                    .map(([subpath, exported]) => ({
                        subpath,
                        absent: reference.names.filter(name => !exported.has(name)),
                    }))
                    .sort((left, right) => left.absent.length - right.absent.length);
                return `${describeReference(reference)} — nearest ${nearest.subpath} is missing ${nearest.absent.join(', ')}`;
            });

        expect(offenders).toEqual([]);
    });

    it('keeps core free of imports from providers, the CLI, and testing', () => {
        const offenders = coreSourceFiles()
            .flatMap(crossPackageReferences)
            .map(describeReference);

        expect(offenders).toEqual([]);
    });
});
