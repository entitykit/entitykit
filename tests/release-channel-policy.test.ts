import {
    releasePolicy,
    requireForwardRelease,
    requireReleaseVersion,
} from '../scripts/release-channel-policy.js';

describe('release channel policy', () => {
    it.each([
        ['0.1.0-alpha.2', 'alpha', 'alpha', 'alpha-candidate'],
        ['0.1.0', 'stable', 'latest', 'stable-candidate'],
        ['1.0.0', 'stable', 'latest', 'stable-candidate'],
    ])('routes %s through its candidate tag', (version, channel, targetTag, candidateTag) => {
        expect(releasePolicy(version)).toMatchObject({ channel, targetTag, candidateTag });
    });

    it.each([
        '', 'v1.0.0', '1.0', '01.0.0', '1.00.0', '1.0.00',
        '1.0.0-alpha.01', '1.0.0-beta.1', '1.0.0-rc.1', '1.0.0+build',
        '1.0.0\n', ' 1.0.0', '1.0.0;exit 0', undefined, null, 100,
        `${'1'.repeat(129)}.0.0`,
    ])('rejects noncanonical version %s', version => {
        expect(() => releasePolicy(version)).toThrow('Unsupported release version');
    });

    it('refuses current prereleases in a stable dispatch and stable versions in alpha', () => {
        expect(() => requireReleaseVersion('0.1.0-alpha.2', 'stable')).toThrow('belongs to alpha');
        expect(() => requireReleaseVersion('1.0.0', 'alpha')).toThrow('belongs to stable');
        expect(() => requireReleaseVersion('1.0.0', 'latest')).toThrow('Unsupported release channel');
    });

    it.each([
        ['0.1.0-alpha.2', 'alpha', '0.1.0-alpha.1', 'forward'],
        ['0.1.0-alpha.2', 'alpha', '0.1.0-alpha.2', 'retry'],
        ['0.1.0', 'stable', '0.1.0-alpha.2', 'forward'],
        ['1.0.0', 'stable', '1.0.0', 'retry'],
        ['1.0.1', 'stable', '1.0.0', 'forward'],
        ['1.0.0', 'stable', undefined, 'bootstrap'],
        ['9007199254740993.0.0', 'stable', '9007199254740992.0.0', 'forward'],
        ['1.0.0-alpha.9007199254740993', 'alpha', '1.0.0-alpha.9007199254740992', 'forward'],
    ])('accepts %s as a monotonic %s movement', (version, channel, current, expected) => {
        expect(requireForwardRelease(version, channel, current)).toBe(expected);
    });

    it.each([
        ['1.0.0', 'stable', '1.0.1'],
        ['1.0.0', 'stable', '1.0.1-alpha.1'],
        ['0.1.0-alpha.2', 'alpha', '0.1.0-alpha.3'],
        ['9007199254740992.0.0', 'stable', '9007199254740993.0.0'],
        ['1.0.0-alpha.9007199254740992', 'alpha', '1.0.0-alpha.9007199254740993'],
    ])('refuses backwards movement from %s', (version, channel, current) => {
        expect(() => requireForwardRelease(version, channel, current)).toThrow('older than current');
    });

    it('fails closed on missing alpha or an incomparable current tag', () => {
        expect(() => requireForwardRelease('0.1.0-alpha.2', 'alpha')).toThrow('must resolve');
        expect(() => requireForwardRelease('0.1.0-alpha.2', 'alpha', '0.1.0')).toThrow('not an alpha');
        expect(() => requireForwardRelease('1.0.0', 'stable', '1.0.0-beta.1')).toThrow('Unsupported');
    });

    it('permits an explicitly absent new alpha sibling after the core anchor is checked', () => {
        expect(requireForwardRelease('0.1.0-alpha.2', 'alpha', '', true)).toBe('bootstrap');
        expect(() => requireForwardRelease('0.1.0-alpha.2', 'alpha', 'garbage', true)).toThrow('Unsupported');
    });
});
