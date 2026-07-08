import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { walkRepo } from './walk.js';

describe('walkRepo', () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'orion-rag-walk-'));
    await writeFile(join(root, 'index.ts'), 'export const a = 1;\n');
    await writeFile(join(root, 'README.md'), '# hello\n');
    await writeFile(join(root, 'logo.png'), 'binarydata');
    await writeFile(join(root, 'empty.ts'), '');

    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src', 'app.tsx'), 'export const App = () => null;\n');

    await mkdir(join(root, 'node_modules', 'pkg'), { recursive: true });
    await writeFile(join(root, 'node_modules', 'pkg', 'index.js'), 'module.exports = {};\n');

    await mkdir(join(root, 'dist'), { recursive: true });
    await writeFile(join(root, 'dist', 'bundle.js'), 'console.log(1);\n');

    await mkdir(join(root, '.git'), { recursive: true });
    await writeFile(join(root, '.git', 'config'), '[core]\n');
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('lists indexable text files and skips excluded dirs, binaries and empty files', async () => {
    const files = (await walkRepo(root)).sort();
    expect(files).toContain('index.ts');
    expect(files).toContain('README.md');
    expect(files).toContain('src/app.tsx');
    // Excluded directories.
    expect(files.some((f) => f.startsWith('node_modules'))).toBe(false);
    expect(files.some((f) => f.startsWith('dist'))).toBe(false);
    expect(files.some((f) => f.startsWith('.git'))).toBe(false);
    // Non-allowlisted extension and empty file.
    expect(files).not.toContain('logo.png');
    expect(files).not.toContain('empty.ts');
  });

  it('respects the maxFiles bound', async () => {
    const files = await walkRepo(root, { maxFiles: 1 });
    expect(files).toHaveLength(1);
  });

  it('respects the maxFileBytes bound', async () => {
    const files = await walkRepo(root, { maxFileBytes: 1 });
    expect(files).toHaveLength(0);
  });
});
