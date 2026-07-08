/**
 * Built-in skills shipped with Orion. They are always part of every project's
 * skill catalog and can be selected by agents without being installed. Each is
 * embedded as a string constant (rather than a bundled file) so it is available
 * regardless of how the package is built or deployed.
 */

export interface BuiltinSkill {
  name: string;
  description: string;
  /** Full `SKILL.md` contents, including frontmatter. */
  content: string;
  /** Optional SDLC tags. */
  tags?: string[];
}

const CONVENTIONAL_COMMITS = `---
name: conventional-commits
description: Use when writing git commit messages or preparing a pull request. Enforces the Conventional Commits format (type(scope): summary) so history stays machine-readable and changelogs can be generated.
---

# Conventional Commits

Write every commit subject as \`type(scope): summary\`.

- **type** is one of: \`feat\`, \`fix\`, \`docs\`, \`style\`, \`refactor\`, \`perf\`, \`test\`, \`build\`, \`ci\`, \`chore\`, \`revert\`.
- **scope** is optional and names the affected area, e.g. \`feat(auth):\`.
- **summary** is imperative, lower-case, and under ~72 characters. No trailing period.

Add a body separated by a blank line to explain *what* and *why* when the change is non-trivial. Reference the ticket if one exists. Use \`BREAKING CHANGE:\` in the footer for incompatible changes.

Examples:

\`\`\`
feat(cart): recompute totals when an item is removed
fix(api): return 404 instead of 500 for unknown project ids
test(engine): cover the dependency-cycle detection path
\`\`\`
`;

const TEST_DRIVEN_CHANGE = `---
name: test-driven-change
description: Use when implementing a bug fix or feature that should be verified with automated tests. Guides adding a failing test first, then the change, and confirming the suite passes before finishing.
---

# Test-Driven Change

Before finishing any behavioural change, make sure it is covered by a test.

1. **Reproduce first.** For a bug, add a test that fails for the current behaviour. For a feature, add a test that describes the desired behaviour.
2. **Match the project's conventions.** Find neighbouring test files and reuse the same framework, helpers, and naming. Never introduce a new test runner.
3. **Implement the change**, then run the relevant test target and confirm it passes.
4. **Run the surrounding suite** (not just your new test) to catch regressions.
5. Keep tests deterministic — no reliance on real network, wall-clock time, or ordering between tests.

If you cannot run the tests in the environment, say so explicitly and describe exactly which command should be run.
`;

const PR_DESCRIPTION = `---
name: pr-description
description: Use when opening a pull request or summarizing completed work. Produces a clear PR description with a summary, the reasoning behind the change, and how it was verified.
---

# Pull Request Description

Structure every pull request description as:

## Summary
A one or two sentence overview of what changed and why it matters.

## Changes
A short bullet list of the concrete changes, grouped by area when helpful.

## Verification
Exactly how the change was checked — the test/lint/build commands run and their result. If something could not be verified, call it out.

Keep it factual and scoped to this change. Link the ticket. Do not describe work that is not part of the diff.
`;

export const BUILTIN_SKILLS: BuiltinSkill[] = [
  {
    name: 'conventional-commits',
    description:
      'Use when writing git commit messages or preparing a pull request. Enforces the Conventional Commits format (type(scope): summary) so history stays machine-readable and changelogs can be generated.',
    tags: ['implement', 'review'],
    content: CONVENTIONAL_COMMITS,
  },
  {
    name: 'test-driven-change',
    description:
      'Use when implementing a bug fix or feature that should be verified with automated tests. Guides adding a failing test first, then the change, and confirming the suite passes before finishing.',
    tags: ['implement', 'review'],
    content: TEST_DRIVEN_CHANGE,
  },
  {
    name: 'pr-description',
    description:
      'Use when opening a pull request or summarizing completed work. Produces a clear PR description with a summary, the reasoning behind the change, and how it was verified.',
    tags: ['review'],
    content: PR_DESCRIPTION,
  },
];

export const BUILTIN_SKILLS_BY_NAME: ReadonlyMap<string, BuiltinSkill> = new Map(
  BUILTIN_SKILLS.map((s) => [s.name, s]),
);
