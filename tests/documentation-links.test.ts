import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const requiredPublicDocs = [
    'README.md',
    'USAGE.md',
    'API.md',
    'CONTRIBUTING.md',
    'SECURITY.md',
    'docs/architecture.md',
    'docs/compatibility.md',
    'docs/migrations.md',
    'docs/releasing.md',
] as const;
const packageNames = [
    'core',
    'sqlite',
    'postgres',
    'mysql',
    'cli',
    'testing',
] as const;
const communityFiles = [
    '.github/ISSUE_TEMPLATE/bug.yml',
    '.github/ISSUE_TEMPLATE/feature.yml',
    '.github/ISSUE_TEMPLATE/config.yml',
    '.github/pull_request_template.md',
] as const;

describe('public documentation', () => {
    it('ships one progressive documentation path', () => {
        for (const file of requiredPublicDocs) {
            expect(`${file}:${String(fs.existsSync(path.join(root, file)))}`)
                .toBe(`${file}:true`);
        }
    });

    it.each(packageNames)('gives @entitykit/%s a standalone package page', name => {
        const readme = fs.readFileSync(
            path.join(root, 'packages', name, 'README.md'),
            'utf8',
        );

        expect(readme).toContain(`@entitykit/${name}`);
        expect(readme).toContain(`@entitykit/${name}@alpha`);
        expect(readme).toContain(
            'https://raw.githubusercontent.com/entitykit/entitykit/main/entitykit-logo.svg',
        );
        expect(readme).toContain(
            'https://github.com/entitykit/entitykit/blob/main/',
        );
    });

    it('provides public issue and pull request paths', () => {
        for (const file of communityFiles) {
            expect(`${file}:${String(fs.existsSync(path.join(root, file)))}`)
                .toBe(`${file}:true`);
        }
        const config = fs.readFileSync(
            path.join(root, '.github/ISSUE_TEMPLATE/config.yml'),
            'utf8',
        );
        expect(config).toContain(
            '/entitykit/entitykit/security/advisories/new',
        );
    });

    it.each(documentationFiles())('resolves every local link in %s', file => {
        const absoluteFile = path.join(root, file);
        const markdown = stripCodeFences(fs.readFileSync(absoluteFile, 'utf8'));

        for (const target of linkTargets(markdown)) {
            assertLocalTarget(file, target);
        }
    });

    it('does not point shipped source comments at retired private docs', () => {
        const source = fs.readFileSync(
            path.join(root, 'packages/core/src/core/lazy-loading.ts'),
            'utf8',
        );

        expect(source).not.toContain('docs/product/lazy-loading-design.md');
        expect(source).toContain('USAGE.md');
    });
});

function documentationFiles(): string[] {
    return [
        ...requiredPublicDocs,
        ...packageNames.map(name => `packages/${name}/README.md`),
        ...communityFiles.filter(file => file.endsWith('.md')),
        ...markdownFilesBelow(path.join(root, 'docs')),
    ].filter((file, index, files) => files.indexOf(file) === index).sort();
}

function markdownFilesBelow(directory: string): string[] {
    if (!fs.existsSync(directory)) {
        return [];
    }
    return fs.readdirSync(directory, { withFileTypes: true })
        .flatMap(entry => {
            const absolute = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                return markdownFilesBelow(absolute);
            }
            return entry.isFile() && entry.name.endsWith('.md')
                ? [path.relative(root, absolute)]
                : [];
        });
}

function stripCodeFences(markdown: string): string {
    return markdown.replace(/```[\s\S]*?```/gu, '');
}

function linkTargets(markdown: string): string[] {
    const markdownLinks = [...markdown.matchAll(
        /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gu,
    )].map(match => match[1]);
    const htmlLinks = [...markdown.matchAll(
        /\b(?:href|src)="([^"]+)"/gu,
    )].map(match => match[1]);

    return [...markdownLinks, ...htmlLinks];
}

function assertLocalTarget(sourceFile: string, rawTarget: string): void {
    const repositoryTarget = localRepositoryTarget(rawTarget);
    if (isExternal(repositoryTarget)) {
        return;
    }

    const [rawPath = '', rawAnchor] = repositoryTarget.split('#', 2);
    const decodedPath = decodeURIComponent(rawPath);
    const sourceAbsolute = path.join(root, sourceFile);
    let targetAbsolute = decodedPath.length === 0
        ? sourceAbsolute
        : path.resolve(path.dirname(sourceAbsolute), decodedPath);

    const staysInside = targetAbsolute === root
        || targetAbsolute.startsWith(`${root}${path.sep}`);
    expect(`${sourceFile} -> ${rawTarget}:${String(staysInside)}`)
        .toBe(`${sourceFile} -> ${rawTarget}:true`);

    const exists = fs.existsSync(targetAbsolute);
    expect(`${sourceFile} -> ${rawTarget}:${String(exists)}`)
        .toBe(`${sourceFile} -> ${rawTarget}:true`);

    if (fs.existsSync(targetAbsolute) && fs.statSync(targetAbsolute).isDirectory()) {
        targetAbsolute = path.join(targetAbsolute, 'README.md');
    }
    if (rawAnchor && targetAbsolute.endsWith('.md')) {
        const anchors = markdownAnchors(stripCodeFences(
            fs.readFileSync(targetAbsolute, 'utf8'),
        ));
        expect(`${sourceFile} -> ${rawTarget}:${String(
            anchors.has(decodeURIComponent(rawAnchor)),
        )}`).toBe(`${sourceFile} -> ${rawTarget}:true`);
    }
}

function isExternal(target: string): boolean {
    return /^(?:https?:|mailto:)/u.test(target);
}

function localRepositoryTarget(target: string): string {
    const githubPrefix = 'https://github.com/entitykit/entitykit/blob/main/';
    const rawPrefix = 'https://raw.githubusercontent.com/entitykit/entitykit/main/';
    if (target.startsWith(githubPrefix)) {
        return path.join(root, target.slice(githubPrefix.length));
    }
    if (target.startsWith(rawPrefix)) {
        return path.join(root, target.slice(rawPrefix.length));
    }
    return target;
}

function markdownAnchors(markdown: string): ReadonlySet<string> {
    return new Set([...markdown.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gmu)]
        .map(match => githubAnchor(match[1])));
}

function githubAnchor(heading: string): string {
    return heading
        .replace(/<[^>]+>/gu, '')
        .trim()
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s_-]/gu, '')
        .replace(/\s+/gu, '-');
}
