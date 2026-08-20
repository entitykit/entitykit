import fs from 'node:fs';
import path from 'node:path';
import { writeFilesAtomically } from '../packages/core/src/tooling/atomic-file-writer';
import { createManagedTempDirectory } from './support/managed-temp-directory';

describe('atomic file writer', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('restores every original file when a commit fails', () => {
        const directory = createManagedTempDirectory('entitykit-atomic-rollback-');
        const first = path.join(directory, 'first.txt');
        const second = path.join(directory, 'second.txt');
        fs.writeFileSync(first, 'first original');
        fs.writeFileSync(second, 'second original');
        const rename = fs.renameSync.bind(fs);
        const failure = jest.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
            if (String(from).endsWith('.tmp') && to === second) {
                throw new Error('simulated second commit failure');
            }
            rename(from, to);
        });

        expect(() => {
            writeFilesAtomically([
                { path: first, contents: 'first replacement', replace: true },
                { path: second, contents: 'second replacement', replace: true },
            ]);
        }).toThrow('simulated second commit failure');
        failure.mockRestore();

        expect(fs.readFileSync(first, 'utf8')).toBe('first original');
        expect(fs.readFileSync(second, 'utf8')).toBe('second original');
    });

    it('does not roll back committed files when backup cleanup fails', () => {
        const directory = createManagedTempDirectory('entitykit-atomic-cleanup-');
        const destination = path.join(directory, 'output.txt');
        fs.writeFileSync(destination, 'original');
        const unlink = fs.unlinkSync.bind(fs);
        const cleanupFailure = jest.spyOn(fs, 'unlinkSync').mockImplementation(filePath => {
            if (String(filePath).endsWith('.bak')) {
                throw Object.assign(new Error('simulated cleanup failure'), { code: 'EACCES' });
            }
            unlink(filePath);
        });

        expect(() => {
            writeFilesAtomically([
                { path: destination, contents: 'replacement', replace: true },
            ]);
        }).not.toThrow();
        cleanupFailure.mockRestore();

        expect(fs.readFileSync(destination, 'utf8')).toBe('replacement');
    });

    it('never overwrites a file created after preflight', () => {
        const directory = createManagedTempDirectory('entitykit-atomic-race-');
        const destination = path.join(directory, 'output.txt');
        const link = fs.linkSync.bind(fs);
        const competingWrite = jest.spyOn(fs, 'linkSync').mockImplementation((source, target) => {
            fs.writeFileSync(target, 'competing writer');
            link(source, target);
        });

        let thrown: unknown;
        try {
            writeFilesAtomically([{ path: destination, contents: 'entitykit output' }]);
        } catch (error) {
            thrown = error;
        }
        competingWrite.mockRestore();

        expect(thrown).toMatchObject({ code: 'EEXIST' });
        expect(fs.readFileSync(destination, 'utf8')).toBe('competing writer');
    });
});
