import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Run a git command in `cwd` and return trimmed stdout. */
export async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, maxBuffer: 1024 * 1024 * 32 });
  return stdout.trim();
}

/** Run a git command from an arbitrary directory (e.g. for `clone`). */
export async function gitRoot(args: string[], cwd: string = process.cwd()): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, maxBuffer: 1024 * 1024 * 32 });
  return stdout.trim();
}
