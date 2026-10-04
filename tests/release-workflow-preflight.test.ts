import fs from 'node:fs';
import { ReleaseWorkflowSandbox } from './support/release-workflow-sandbox';

describe('executed release workflow preflight', () => {
    it.each(['alpha', 'stable'])('requires a matching %s confirmation', channel => {
        const sandbox = new ReleaseWorkflowSandbox('1.0.0', channel);
        const run = (confirm: string): { status: number | null; output: string } =>
            sandbox.run('confirm', 'Require the channel confirmation phrase', { CONFIRM: confirm });
        expect(run(`publish-${channel}`).status).toBe(0);
        expect(run(channel === 'stable' ? 'publish-alpha' : 'publish-stable').status).toBe(1);
        expect(sandbox.run('confirm', 'Require the channel confirmation phrase', {
            CHANNEL: 'latest', CONFIRM: 'publish-latest',
        }).status).toBe(1);
    });

    it('refuses publication from the hardening branch', () => {
        const sandbox = new ReleaseWorkflowSandbox();
        expect(sandbox.run('guard', 'Require refs/heads/main', { REF: 'refs/heads/hardening', SHA: 'fixture' }).status).toBe(1);
        expect(sandbox.run('guard', 'Require refs/heads/main', { REF: 'refs/heads/main', SHA: 'fixture' }).status).toBe(0);
    });

    it('bootstraps stable tags only after every absent lookup returns E404', () => {
        const sandbox = new ReleaseWorkflowSandbox();
        const result = sandbox.preflight();
        expect(result.output).toContain('Accepted bootstrap movement');
        expect(result.status).toBe(0);
        expect(fs.readFileSync(sandbox.outputPath, 'utf8')).toContain('version=1.0.0');
        expect(sandbox.state().calls).toHaveLength(7);
    });

    it.each(['0.9.0', '1.0.0', '1.0.0-alpha.2'])('accepts a stable movement from %s', current => {
        const sandbox = new ReleaseWorkflowSandbox();
        sandbox.setTags(current);
        expect(sandbox.preflight().status).toBe(0);
    });

    it('refuses an alpha candidate selected for stable publication', () => {
        const sandbox = new ReleaseWorkflowSandbox('0.1.0-alpha.2');
        const result = sandbox.preflight();
        expect(result.status).toBe(1);
        expect(result.output).toContain('belongs to alpha');
        expect(sandbox.state().calls).toEqual([]);
    });

    it('accepts the first alpha NestJS sibling while requiring an existing core anchor', () => {
        const sandbox = new ReleaseWorkflowSandbox('0.1.0-alpha.2', 'alpha');
        sandbox.setTags('0.1.0-alpha.1');
        const state = sandbox.state();
        delete state.tags['@entitykit/nestjs@alpha'];
        sandbox.writeState(state);
        expect(sandbox.preflight().status).toBe(0);
        delete state.tags['@entitykit/core@alpha'];
        sandbox.writeState(state);
        expect(sandbox.preflight().status).toBe(1);
    });

    it('checks every public tag and refuses a newer sibling', () => {
        const sandbox = new ReleaseWorkflowSandbox();
        sandbox.setTags('0.9.0');
        const state = sandbox.state();
        state.tags['@entitykit/mysql@latest'] = '1.0.1';
        sandbox.writeState(state);
        expect(sandbox.preflight().output).toContain('older than current latest');
        expect(sandbox.state().calls.every(call => call[0] === 'view')).toBe(true);
    });

    it.each(['ECONNRESET', 'E401'])('refuses %s even when an error message mentions E404', code => {
        const sandbox = new ReleaseWorkflowSandbox();
        const state = sandbox.state();
        state.failures['view:@entitykit/core@latest'] = { code, message: 'unrelated log mentioned E404' };
        sandbox.writeState(state);
        const result = sandbox.preflight();
        expect(result.status).toBe(1);
        expect(result.output).toContain(code);
    });

    it.each(['', 'garbage', '1.0.0-beta.1', '1. 0.0'])('refuses an invalid current version %s', current => {
        const sandbox = new ReleaseWorkflowSandbox();
        sandbox.setTags(current);
        expect(sandbox.preflight().status).toBe(1);
    });

    it('requires the exact family roster, version and public tag', () => {
        const sandbox = new ReleaseWorkflowSandbox();
        sandbox.pack('mysql', '1.0.1');
        expect(sandbox.preflight().output).toContain('tarballs carry versions');
        sandbox.pack('mysql', '1.0.0', 'alpha');
        expect(sandbox.preflight().output).toContain('declares tag alpha');
        fs.rmSync(sandbox.tarball('mysql'));
        expect(sandbox.preflight().output).toContain('exactly the seven');
    });
});
