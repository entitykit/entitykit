import { ReleaseWorkflowSandbox, releasePackages } from './support/release-workflow-sandbox';

describe('executed release workflow publication and promotion', () => {
    it.each([
        ['1.0.0', 'stable', '0.9.0'],
        ['0.1.0-alpha.2', 'alpha', '0.1.0-alpha.1'],
    ])('stages %s before moving its public tags', (version, channel, current) => {
        const sandbox = new ReleaseWorkflowSandbox(version, channel);
        sandbox.setTags(current);
        expect(sandbox.preflight().status).toBe(0);
        sandbox.publish();
        const candidates = sandbox.state();
        const published = candidates.calls.filter(call => call[0] === 'publish');
        expect(published.map(call => call[1]))
            .toEqual(releasePackages.map(name => sandbox.tarball(name)));
        expect(published.every(call => call.includes('--provenance') && call.at(-1) === `${channel}-candidate`)).toBe(true);
        for (const name of releasePackages) {
            expect(candidates.tags[`@entitykit/${name}@${sandbox.targetTag}`]).toBe(current);
            expect(candidates.tags[`@entitykit/${name}@${channel}-candidate`]).toBe(version);
        }
        expect(sandbox.promote().status).toBe(0);
        const state = sandbox.state();
        for (const name of releasePackages) expect(state.tags[`@entitykit/${name}@${sandbox.targetTag}`]).toBe(version);
    }, 20_000);

    it('completes the first stable family when latest tags are absent', () => {
        const sandbox = new ReleaseWorkflowSandbox();
        expect(sandbox.preflight().status).toBe(0);
        sandbox.publish();
        expect(sandbox.promote().status).toBe(0);
        expect(sandbox.state().tags['@entitykit/cli@latest']).toBe('1.0.0');
    }, 20_000);

    it('resumes matching bytes and refuses conflicting immutable versions', () => {
        const sandbox = new ReleaseWorkflowSandbox();
        sandbox.holdAcceptedBytes();
        sandbox.publish();
        expect(sandbox.state().calls.some(call => call[0] === 'publish')).toBe(false);
        const state = sandbox.state();
        state.integrities['@entitykit/core@1.0.0'] = 'sha512-other-bytes';
        sandbox.writeState(state);
        const result = sandbox.run('publish', 'Publish @entitykit/core');
        expect(result.status).toBe(1);
        expect(result.output).toContain('different bytes');
    });

    it.each(['E401', 'ECONNRESET'])('never publishes after a %s metadata lookup', code => {
        const sandbox = new ReleaseWorkflowSandbox();
        const state = sandbox.state();
        state.failures['view:@entitykit/core@1.0.0'] = { code, message: 'E404 occurred elsewhere' };
        sandbox.writeState(state);
        expect(sandbox.run('publish', 'Publish @entitykit/core').status).toBe(1);
        expect(sandbox.state().calls.some(call => call[0] === 'publish')).toBe(false);
    });

    it('verifies every registry integrity before the first tag move', () => {
        const sandbox = new ReleaseWorkflowSandbox();
        sandbox.holdAcceptedBytes();
        const state = sandbox.state();
        state.integrities['@entitykit/cli@1.0.0'] = 'sha512-other-bytes';
        sandbox.writeState(state);
        expect(sandbox.promote().status).toBe(1);
        expect(sandbox.state().calls.some(call => call[0] === 'dist-tag')).toBe(false);
    });

    it('rechecks public tag movement after candidate publication', () => {
        const sandbox = new ReleaseWorkflowSandbox();
        sandbox.setTags('0.9.0');
        expect(sandbox.preflight().status).toBe(0);
        sandbox.publish();
        const state = sandbox.state();
        state.tags['@entitykit/cli@latest'] = '1.0.1';
        sandbox.writeState(state);
        const result = sandbox.promote();
        expect(result.status).toBe(1);
        expect(result.output).toContain('older than current latest');
        expect(sandbox.state().calls.some(call => call[0] === 'dist-tag')).toBe(false);
    }, 20_000);

    it('bounds failed tag retries and converges an interrupted family on rerun', () => {
        const sandbox = new ReleaseWorkflowSandbox();
        sandbox.setTags('0.9.0');
        sandbox.holdAcceptedBytes();
        const state = sandbox.state();
        state.failures['tag:@entitykit/mysql@1.0.0'] = { code: 'ETIMEDOUT', remaining: 3 };
        sandbox.writeState(state);
        expect(sandbox.promote().status).toBe(1);
        const interrupted = sandbox.state();
        expect(interrupted.calls.filter(call => call[0] === 'dist-tag' && call[2] === '@entitykit/mysql@1.0.0')).toHaveLength(3);
        expect(interrupted.tags['@entitykit/core@latest']).toBe('1.0.0');
        expect(interrupted.tags['@entitykit/cli@latest']).toBe('0.9.0');
        expect(sandbox.preflight().status).toBe(0);
        sandbox.publish();
        expect(sandbox.promote().status).toBe(0);
        for (const name of releasePackages) expect(sandbox.state().tags[`@entitykit/${name}@latest`]).toBe('1.0.0');
    }, 20_000);
});
