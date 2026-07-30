import { identifierNames, oversizedFiles } from './architecture-test-support';

export interface IdentifierBoundary {
    readonly file: string;
    readonly forbidden: readonly string[];
}

export interface SizeBudget {
    readonly maximumLines: number;
    readonly files: readonly string[];
}

export function testIdentifierBoundaries(
    boundaries: readonly IdentifierBoundary[],
): void {
    it.each(boundaries)(
        '$file does not take on collaborator responsibilities',
        ({ file, forbidden }) => {
            const identifiers = identifierNames(file);
            const offenders = forbidden.filter(identifier => identifiers.has(identifier));

            expect(offenders).toEqual([]);
        },
    );
}

export function testSizeBudgets(budgets: readonly SizeBudget[]): void {
    it.each(budgets)(
        'keeps focused module families within $maximumLines lines',
        ({ files, maximumLines }) => {
            expect(oversizedFiles(files, maximumLines)).toEqual([]);
        },
    );
}
