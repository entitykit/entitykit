import fs from 'node:fs';
import path from 'node:path';

describe('TypeScript config', () => {
    it('includes Jest and Node globals explicitly for CI typecheck', () => {
        const tsconfig = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'tsconfig.json'), 'utf8')) as {
            compilerOptions?: {
                types?: string[];
            };
        };

        expect(tsconfig.compilerOptions?.types).toEqual(expect.arrayContaining(['jest', 'node']));
    });
});
