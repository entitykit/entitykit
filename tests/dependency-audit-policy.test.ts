import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const policy = JSON.parse(fs.readFileSync('docs/security-tooling-review.json', 'utf8')) as {
    expires: string;
    advisory: string;
};
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
        ...overrides,
    };
    const result = spawnSync(process.execPath, ['-e', `
        const fs = require('node:fs');
        const { evaluateAudits } = require('./scripts/dependency-audit-policy');
        const policy = require('./docs/security-tooling-review.json');
        const input = JSON.parse(fs.readFileSync(0, 'utf8'));
        console.log(JSON.stringify(evaluateAudits(
            input.runtime, input.full, input.lock, policy, new Date(input.now),
        )));
    `], { encoding: 'utf8', input: JSON.stringify(input) });
    expect(result.status).toBe(0);
    return JSON.parse(result.stdout) as string[];
}

describe('dependency audit policy', () => {
    it('accepts only the reviewed development path and advisory', () => {
        expect(evaluate()).toEqual([]);
    });

    it.each(['packages', 'examples'])('rejects %s runtime findings regardless of tooling review', scope => {
        expect(evaluate({ runtime: { [scope]: report({ braces: finding }) } }))
            .toContain(`${scope}: runtime advisory affects braces`);
    });

    it('rejects an expired review at its exact expiry', () => {
        expect(evaluate({ now: policy.expires })).toContain('tooling: advisory review expired');
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
});
