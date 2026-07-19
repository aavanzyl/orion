import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function mergeBaseHead(cwd: string, baseBranch: string): Promise<string> {
  const refs = [baseBranch, `origin/${baseBranch}`];
  for (const ref of refs) {
    try {
      const { stdout } = await execFileAsync('git', ['merge-base', 'HEAD', ref], { cwd });
      return stdout.trim();
    } catch {
      // try next ref
    }
  }
  return '';
}

export async function computeRunDiff(repoPath: string, baseBranch: string): Promise<string> {
  const mergeBase = await mergeBaseHead(repoPath, baseBranch);
  const baseRef = mergeBase || 'HEAD';

  const { stdout: diff } = await execFileAsync('git', ['diff', '--stat', baseRef], {
    cwd: repoPath,
    maxBuffer: 1024 * 1024 * 32,
  });

  let untracked = '';
  try {
    const { stdout } = await execFileAsync('git', ['ls-files', '--others', '--exclude-standard'], {
      cwd: repoPath,
      maxBuffer: 1024 * 1024 * 32,
    });
    untracked = stdout.trim();
  } catch {
    // ignore
  }

  const diffText = diff.trim();
  if (!diffText && !untracked) return '';

  const lines: string[] = [];
  if (diffText) lines.push(diffText);
  if (untracked) {
    for (const file of untracked.split('\n').filter(Boolean)) {
      lines.push(` ?? ${file}`);
    }
  }
  return lines.join('\n');
}
