import path from 'path';

export function resolveProjectPath(
    projectRoot: string,
    candidate: string,
): string {
    return path.isAbsolute(candidate)
        ? candidate
        : path.resolve(projectRoot, candidate);
}
