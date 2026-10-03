export interface ReleasePolicy {
    readonly version: string;
    readonly channel: 'alpha' | 'stable';
    readonly targetTag: 'alpha' | 'latest';
    readonly candidateTag: 'alpha-candidate' | 'stable-candidate';
    readonly parts: readonly bigint[];
    readonly prerelease: bigint | undefined;
}
export function releasePolicy(version: unknown): ReleasePolicy;
export function requireReleaseVersion(version: unknown, channel: unknown): ReleasePolicy;
export function requireForwardRelease(
    version: unknown, channel: unknown, current?: string, allowNewPackage?: boolean,
): 'bootstrap' | 'retry' | 'forward';
