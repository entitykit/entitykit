import {
    consumerSourceFiles,
    corePublicEntries,
    corePublicEntryNames,
    coreSourceFiles,
    corePackageConsumers,
    crossPackageReferences,
    workspacePackageOf,
    type CrossPackageReference,
} from './package-access-test-support';

/**
 * The access discipline the monorepo cutover established.
 *
 * `packages/{sqlite,postgres,mysql,cli,testing}` are packages of their own now,
 * and a published consumer only ever gets what a package specifier resolves to.
 * Three properties keep that honest:
 *
 *   1. no relative import leaves the package that wrote it — a path that walks
 *      out of `packages/<name>/src` would resolve in this repository and
 *      nowhere else;
 *   2. every cross-package reference lands in core, through one of core's
 *      declared public entries, binding only names that entry re-exports; and
 *   3. core references nothing from a consumer package, so the dependency arrow
 *      never has to be reversed.
 *
 * Break any of them and an installed package is broken in a way no test that
 * runs from source would otherwise notice, which is why this file has no
 * whitelist.
 */

const entries = corePublicEntryNames();
const publicSpecifiers = Object.keys(corePublicEntries).join(', ');

function describeReference(reference: CrossPackageReference): string {
    const names = reference.names.length > 0 ? reference.names.join(', ') : '<no named bindings>';
    return `${reference.from}:${String(reference.line)} -> ${reference.specifier} (${names})`;
}

const consumerReferences = consumerSourceFiles().flatMap(crossPackageReferences);
const coreReferences = coreSourceFiles().flatMap(crossPackageReferences);

describe('package access boundaries', () => {
    it('assigns every source file to exactly one package', () => {
        expect(workspacePackageOf('packages/core/src/index.ts')).toBe('core');
        expect(workspacePackageOf('packages/postgres/src/index.ts')).toBe('postgres');
        expect(workspacePackageOf('packages/cli/src/api.ts')).toBe('cli');
        expect(workspacePackageOf('packages/testing/src/index.ts')).toBe('testing');
        expect(workspacePackageOf('tests/architecture/file-conventions.test.ts')).toBeUndefined();
        expect(corePackageConsumers).toEqual(
            ['mysql', 'postgres', 'sqlite', 'cli', 'testing'],
        );
        expect(consumerSourceFiles().length).toBeGreaterThan(0);
        expect(coreSourceFiles().length).toBeGreaterThan(0);
    });

    it('publishes a non-empty export closure for every public core entry', () => {
        for (const [specifier, names] of entries) {
            expect(`${specifier}:${String(names.size > 0)}`).toBe(`${specifier}:true`);
        }
    });

    it('keeps every relative import inside the package that wrote it', () => {
        const offenders = [...consumerReferences, ...coreReferences]
            .filter(reference => reference.relativeEscape)
            .map(describeReference);

        expect(offenders).toEqual([]);
    });

    it('sends every cross-package reference from a consumer package into core', () => {
        const offenders = consumerReferences
            .filter(reference => reference.toPackage !== 'core')
            .map(describeReference);

        expect(offenders).toEqual([]);
    });

    it('names what it imports, so the specifier can be checked against the entry', () => {
        // A namespace import, a default import, a bare side-effect import, or a
        // runtime `require` across the seam cannot be checked for reachability
        // by inspection.
        const offenders = consumerReferences
            .filter(reference => reference.opaque)
            .map(describeReference);

        expect(offenders).toEqual([]);
    });

    it(`reaches core only through one of: ${publicSpecifiers}`, () => {
        const offenders = consumerReferences
            .filter(reference => !(reference.specifier in corePublicEntries))
            .map(describeReference);

        expect(offenders).toEqual([]);
    });

    it('binds only names the entry it names actually re-exports', () => {
        const offenders = consumerReferences.flatMap(reference => {
            const exported = entries.get(reference.specifier);
            if (exported === undefined) {
                return [];
            }
            const absent = reference.names.filter(name => !exported.has(name));
            return absent.length === 0
                ? []
                : [`${describeReference(reference)} — ${reference.specifier} is missing ${absent.join(', ')}`];
        });

        expect(offenders).toEqual([]);
    });

    it('keeps core free of references to providers, the CLI, and testing', () => {
        const offenders = coreReferences.map(describeReference);

        expect(offenders).toEqual([]);
    });
});
