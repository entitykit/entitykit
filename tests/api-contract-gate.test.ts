import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createManagedTempDirectory } from './support/managed-temp-directory';

const declaration = `
interface Payload { readonly amount: number; }
export declare class Ledger<T extends string> {
    constructor(id: T);
    readonly payload: Payload;
    read(id: string): Promise<T>;
    read(id: number): Promise<T>;
    private storage;
}
`;

function fixture(): string {
    const directory = createManagedTempDirectory('entitykit-api-contract-');
    fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({
        name: '@entitykit/api-probe', version: '1.0.0', private: true, type: 'commonjs',
    }));
    fs.writeFileSync(path.join(directory, 'index.d.ts'), declaration);
    fs.mkdirSync(path.join(directory, 'reports'));
    fs.mkdirSync(path.join(directory, 'pending'));
    fs.symlinkSync(path.join(process.cwd(), 'node_modules'), path.join(directory, 'node_modules'), 'junction');
    expect(run(directory, true).status).toBe(0);
    return directory;
}

function run(directory: string, accept = false): ReturnType<typeof spawnSync> {
    return spawnSync(process.execPath, ['-e', `
        const path = require('node:path');
        const { extractApiContract } = require('./scripts/extract-api-contract');
        const project = process.argv[1];
        const succeeded = extractApiContract(project, path.join(project, 'index.d.ts'),
            'probe', path.join(project, 'reports'), path.join(project, 'pending'),
            process.argv[2] === 'true');
        process.exitCode = succeeded ? 0 : 1;
    `, directory, String(accept)], { encoding: 'utf8', timeout: 15_000 });
}

describe('API contract gate', () => {
    it('accepts unchanged signatures and records nested reachable declarations', () => {
        const directory = fixture();
        expect(run(directory).status).toBe(0);
        const report = fs.readFileSync(path.join(directory, 'reports', 'probe.api.md'), 'utf8');
        expect(report).toContain('interface Payload');
        expect(report).toContain('readonly amount: number');
    });

    it.each([
        ['nested field type', 'readonly amount: number', 'readonly amount: string'],
        ['generic constraint', 'T extends string', 'T extends number'],
        ['constructor parameter', 'constructor(id: T)', 'constructor(id: T, owner: string)'],
        ['removed overload', 'read(id: number): Promise<T>;', ''],
    ])('rejects a changed %s without overwriting the approved baseline', (_label, before, after) => {
        const directory = fixture();
        const report = path.join(directory, 'reports', 'probe.api.md');
        const original = fs.readFileSync(report, 'utf8');
        fs.writeFileSync(path.join(directory, 'index.d.ts'), declaration.replace(before, after));
        const checked = run(directory);
        expect(checked.status).toBe(1);
        expect(fs.readFileSync(report, 'utf8')).toBe(original);
    });
});
