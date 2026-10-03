import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createManagedTempDirectory } from './managed-temp-directory';

export const releasePackages = ['core', 'sqlite', 'postgres', 'mysql', 'nestjs', 'testing', 'cli'];
export interface RegistryState {
    tags: Record<string, string>;
    integrities: Record<string, string>;
    failures: Record<string, { code: string; message?: string; remaining?: number }>;
    calls: string[][];
}

function stepScript(job: string, step: string): string {
    const workflow = fs.readFileSync(path.join(process.cwd(), '.github/workflows/release.yml'), 'utf8');
    const jobBody = workflow.split(`\n  ${job}:\n`).at(1)?.split(/\n {2}\S/u).at(0);
    if (jobBody === undefined) throw new Error(`Missing workflow job ${job}.`);
    const lines = jobBody.split(`      - name: ${step}\n`).at(1)?.split('\n');
    if (lines === undefined) throw new Error(`Missing workflow step ${step}.`);
    const start = lines.indexOf('        run: |') + 1;
    if (start === 0) throw new Error(`Missing shell body for ${step}.`);
    const script: string[] = [];
    for (const line of lines.slice(start)) {
        if (line.trim() !== '' && !line.startsWith('          ')) break;
        script.push(line.slice(10));
    }
    return `${script.join('\n')}\n`;
}

export class ReleaseWorkflowSandbox {
    public readonly directory = createManagedTempDirectory('entitykit-release-workflow-');
    public readonly statePath = path.join(this.directory, 'registry.json');
    public readonly outputPath = path.join(this.directory, 'outputs');
    public readonly targetTag: string;

    constructor(public readonly version = '1.0.0', public readonly channel = 'stable') {
        this.targetTag = channel === 'stable' ? 'latest' : 'alpha';
        fs.mkdirSync(path.join(this.directory, 'tarballs'));
        fs.mkdirSync(path.join(this.directory, 'bin'));
        const fixture = fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/release-registry.cjs'), 'utf8');
        fs.writeFileSync(path.join(this.directory, 'bin/npm'), `#!${process.execPath}\n${fixture}`, { mode: 0o755 });
        fs.writeFileSync(path.join(this.directory, 'bin/sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
        fs.copyFileSync(path.join(process.cwd(), 'scripts/release-channel-policy.js'),
            path.join(this.directory, 'tarballs/release-channel-policy.js'));
        this.writeState({ tags: {}, integrities: {}, failures: {}, calls: [] });
        for (const name of releasePackages) this.pack(name);
    }

    public state(): RegistryState {
        return JSON.parse(fs.readFileSync(this.statePath, 'utf8')) as RegistryState;
    }

    public writeState(state: RegistryState): void {
        fs.writeFileSync(this.statePath, JSON.stringify(state));
    }

    public setTags(version: string): void {
        const state = this.state();
        for (const name of releasePackages) state.tags[`@entitykit/${name}@${this.targetTag}`] = version;
        this.writeState(state);
    }

    public pack(name: string, version = this.version, tag = this.targetTag): void {
        const source = path.join(this.directory, 'source');
        fs.mkdirSync(path.join(source, 'package'), { recursive: true });
        fs.writeFileSync(path.join(source, 'package/package.json'), JSON.stringify({
            name: `@entitykit/${name}`, version, publishConfig: { access: 'public', tag },
        }));
        const result = spawnSync('tar', ['-czf', this.tarball(name), '-C', source, 'package'], {
            encoding: 'utf8', timeout: 10_000,
        });
        if (result.status !== 0) throw new Error(`Packing fixture failed: ${result.stderr}`);
    }

    public tarball(name: string): string {
        return path.join(this.directory, `tarballs/entitykit-${name}-${this.version}.tgz`);
    }

    public holdAcceptedBytes(): void {
        const state = this.state();
        for (const name of releasePackages) {
            state.integrities[`@entitykit/${name}@${this.version}`] =
                `sha512-${createHash('sha512').update(fs.readFileSync(this.tarball(name))).digest('base64')}`;
        }
        this.writeState(state);
    }

    public run(job: string, step: string, environment: NodeJS.ProcessEnv = {}): { status: number | null; output: string } {
        const env: NodeJS.ProcessEnv = {
            ...process.env, PATH: `${path.join(this.directory, 'bin')}:${process.env.PATH ?? ''}`,
            ENTITYKIT_RELEASE_TEST_STATE: this.statePath, GITHUB_OUTPUT: this.outputPath,
            CHANNEL: this.channel, TARGET_TAG: this.targetTag, CANDIDATE_TAG: `${this.channel}-candidate`,
            VERSION: this.version, ...environment,
        };
        delete env.NODE_AUTH_TOKEN;
        const result = spawnSync('bash', ['-c', stepScript(job, step)], {
            cwd: this.directory, encoding: 'utf8', env, timeout: 20_000,
        });
        return { status: result.status, output: `${result.stdout}${result.stderr}` };
    }

    public preflight(): { status: number | null; output: string } {
        return this.run('publish', 'Preflight the packed tarballs');
    }

    public publish(): void {
        for (const name of releasePackages) {
            const result = this.run('publish', `Publish @entitykit/${name}`);
            if (result.status !== 0) throw new Error(result.output);
        }
    }

    public promote(): { status: number | null; output: string } {
        for (const step of [
            'Require the registry to hold the accepted bytes',
            'Require forward public tag movement',
            'Move the public dist-tag onto the published version',
        ]) {
            const result = this.run('promote', step);
            if (result.status !== 0) return result;
        }
        return { status: 0, output: '' };
    }
}
