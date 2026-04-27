import { resolve, relative, isAbsolute, sep } from 'path';

/**
 * Checks if a target path is a child of or equals the current working directory (cwd).
 * Used to prevent Path Traversal vulnerabilities in file operations.
 *
 * @param cwd The allowed base directory (current working directory).
 * @param targetPath The requested file or directory path.
 * @returns boolean `true` if the target path is safe, `false` otherwise.
 */
export function isPathSafe(cwd: string, targetPath: string): boolean {
  const resolvedTarget = resolve(cwd, targetPath);
  const rel = relative(cwd, resolvedTarget);
  // If the relative path starts with '..' or is an absolute path (on Windows it can happen across drives), it's outside
  return !(rel === '..' || rel.startsWith('..' + sep)) && !isAbsolute(rel);
}
