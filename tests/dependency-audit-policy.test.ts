import { spawnSync } from 'node:child_process';
// Policy behavior stays covered even when the repository has no active exceptions.
const reviews = [{
    package: 'braces', advisory: 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm',
    expires: '2026-11-02T00:00:00Z', nodes: { 'node_modules/braces': '3.0.3' },
}, {
    package: 'sprintf-js', advisory: 'https://github.com/advisories/GHSA-hp3w-g68c-fv3c',
    expires: '2026-10-20T00:00:00Z', nodes: {
        'node_modules/sprintf-js': '1.0.3', 'node_modules/argparse': '1.0.10',
    },
}];
const policy = reviews[0];
const empty = { auditReportVersion: 2, vulnerabilities: {}, metadata: { vulnerabilities: { total: 0 } } };
const finding = {
    name: 'braces', nodes: ['node_modules/braces'],
    via: [{ url: policy.advisory }],
};
const report = (vulnerabilities: object): object => ({
    auditReportVersion: 2, vulnerabilities,
    metadata: { vulnerabilities: { total: Object.keys(vulnerabilities).length } },
});

function evaluate(overrides: object = {}): string[] {
    const input = {
        runtime: { packages: empty, examples: empty },
        full: report({ braces: finding }),
        lock: { packages: { 'node_modules/braces': { version: '3.0.3', dev: true } } },
        now: '2026-10-03T12:00:00Z',
        policy: { reviews },
        ...overrides,
    };
    const result = spawnSync(process.execPath, ['-e', `
        const fs = require('node:fs');
        const { evaluateAudits } = require('./scripts/dependency-audit-policy');
        const input = JSON.parse(fs.readFileSync(0, 'utf8'));
        console.log(JSON.stringify(evaluateAudits(
            input.runtime, input.full, input.lock, input.policy, new Date(input.now),
        )));
    `], { encoding: 'utf8', input: JSON.stringify(input) });
    expect(result.status).toBe(0);
    return JSON.parse(result.stdout) as string[];
}

describe('dependency audit policy', () => {
    it('accepts an empty exception list only for a clean audit', () => {
        expect(evaluate({ full: empty, policy: { reviews: [] } })).toEqual([]);
        expect(evaluate({ policy: { reviews: [] } }))
            .toContain(`tooling: unreviewed advisory ${policy.advisory}`);
    });

    it('keeps runtime rejection with an empty exception list', () => {
        expect(evaluate({ full: empty, policy: { reviews: [] }, runtime: { packages: report({ braces: finding }) } }))
            .toContain('packages: runtime advisory affects braces');
    });

    it('accepts only the reviewed development path and advisory', () => {
        expect(evaluate()).toEqual([]);
    });

    it.each(['packages', 'examples'])('rejects %s runtime findings regardless of tooling review', scope => {
        expect(evaluate({ runtime: { [scope]: report({ braces: finding }) } }))
            .toContain(`${scope}: runtime advisory affects braces`);
    });

    it('rejects an expired review at its exact expiry', () => {
        expect(evaluate({ now: policy.expires })).toContain(`tooling: advisory review expired (${policy.package})`);
    });

    it.each([
        { version: '3.0.3', dev: false },
        { version: '3.0.4', dev: true },
        { version: '3.0.3' },
    ])('rejects unreviewed installation metadata %j', installed => {
        expect(evaluate({ lock: { packages: { 'node_modules/braces': installed } } }))
            .toContain('tooling: unreviewed dependency path node_modules/braces');
    });

    it('rejects new advisories on the same package', () => {
        expect(evaluate({ full: report({ braces: { ...finding, via: [{ url: 'https://example.com/new' }] } }) }))
            .toContain('tooling: unreviewed advisory https://example.com/new');
    });

    it('rejects new paths even when their advisory and dev flag match', () => {
        expect(evaluate({ full: report({ braces: { ...finding, nodes: ['node_modules/other/node_modules/braces'] } }) }))
            .toContain('tooling: unreviewed dependency path node_modules/other/node_modules/braces');
    });

    it('rejects missing audit data and registry errors', () => {
        expect(evaluate({ runtime: { packages: { error: { code: 'ENOAUDIT' } } } }))
            .toContain('packages: incomplete npm audit report');
        expect(evaluate({ full: { ...empty, metadata: { vulnerabilities: { total: 1 } } } }))
            .toContain('tooling: incomplete npm audit report');
    });

    it('rejects incomplete or cyclic transitive advisory chains', () => {
        expect(evaluate({ full: report({ braces: { ...finding, via: ['missing'] } }) }))
            .toContain('tooling: incomplete advisory chain for missing');
        expect(evaluate({ full: report({ braces: { ...finding, via: ['braces'] } }) }))
            .toContain('tooling: incomplete advisory chain for braces');
    });

    it('rejects a second review at its own earlier expiry', () => {
        expect(evaluate({ now: reviews[1].expires })).toContain(`tooling: advisory review expired (${reviews[1].package})`);
    });

    it('accepts independent reviewed chains without sharing their authorizations', () => {
        expect(evaluate({
            full: report({
                braces: finding,
                'sprintf-js': {
                    nodes: ['node_modules/sprintf-js'], via: [{ url: reviews[1].advisory }],
                },
                argparse: { nodes: ['node_modules/argparse'], via: ['sprintf-js'] },
            }),
            lock: { packages: {
                'node_modules/braces': { version: '3.0.3', dev: true },
                'node_modules/sprintf-js': { version: '1.0.3', dev: true },
                'node_modules/argparse': { version: '1.0.10', dev: true },
            } },
        })).toEqual([]);
    });

    it('requires every ancestor to be pinned in the matching advisory review', () => {
        expect(evaluate({
            full: report({ braces: finding, parent: { nodes: ['node_modules/sprintf-js'], via: ['braces'] } }),
            lock: { packages: {
                'node_modules/braces': { version: '3.0.3', dev: true },
                'node_modules/sprintf-js': { version: '1.0.3', dev: true },
            } },
        })).toContain('tooling: unreviewed dependency path node_modules/sprintf-js');
    });

    it.each([
        { reviews: [] }, {}, { reviews: [null] },
        { reviews: [{ ...policy, nodes: [] }] }, { reviews: [policy, policy] },
    ])('rejects incomplete or ambiguous policy %j', value => {
        expect(evaluate({ policy: value }).length).toBeGreaterThan(0);
    });
});
