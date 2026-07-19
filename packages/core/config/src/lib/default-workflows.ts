/**
 * Built-in catalog of ready-made workflow templates shipped with Orion. Each
 * template provides a full `workflow` DAG plus the agents and board columns it
 * assumes, so it can be dropped into a project's `.orion/config.yaml`. Templates
 * are embedded as TS data (rather than bundled files) so they are available
 * regardless of how the package is built or deployed.
 *
 * Adding a template later is intentionally trivial: define its `WorkflowTemplate`
 * and append it to `DEFAULT_WORKFLOW_TEMPLATES`.
 */

import { stringify } from 'yaml';
import type {
  WorkflowConfig,
  WorkflowTemplateSummary,
} from '@orion/models';

export interface WorkflowTemplate {
  /** Stable id, kebab-case. */
  name: string;
  /** Human title. */
  title: string;
  /** One or two sentences on when to use it. */
  description: string;
  /** Optional free-form tags for grouping/filtering. */
  tags?: string[];
  /** The workflow DAG this template installs. */
  workflow: WorkflowConfig;
  /** Board swimlanes the workflow's nodes move tickets through. */
  suggestedSwimlanes?: string[];
}

/** The single default agent config every template uses unless it needs more. */
const DEFAULT_PROVIDER = 'codex';
const DEFAULT_MODEL = 'gpt-5-codex';

const REVIEW_SECURITY_PROMPT =
  'You are the SECURITY reviewer on a parallel review panel. Review ONLY security concerns in the working changes on branch $BRANCH (base $BASE_BRANCH) of repository $REPOSITORY for the ticket "$TICKET_TITLE": injection, authentication/authorization, secrets handling, unsafe deserialization, SSRF, path traversal, and dependency/supply-chain risks. This is a READ-ONLY review — do NOT modify any code. Return a concise findings list, each with a severity (BLOCKER/MAJOR/MINOR/NIT), the file location, and a suggested remediation. If you find no security issues, say so explicitly.\n\nTicket details:\n$ARGUMENTS';

const REVIEW_PERFORMANCE_PROMPT =
  'You are the PERFORMANCE reviewer on a parallel review panel. Review ONLY performance concerns in the working changes on branch $BRANCH (base $BASE_BRANCH) of repository $REPOSITORY for the ticket "$TICKET_TITLE": hot paths, algorithmic complexity, N+1 queries, unnecessary allocations, blocking I/O, missing caching, and resource leaks. This is a READ-ONLY review — do NOT modify any code. Return a concise findings list, each with a severity (BLOCKER/MAJOR/MINOR/NIT), the file location, and a suggested remediation. If you find no performance issues, say so explicitly.\n\nTicket details:\n$ARGUMENTS';

const REVIEW_CORRECTNESS_PROMPT =
  'You are the CORRECTNESS reviewer on a parallel review panel. Review ONLY correctness concerns in the working changes on branch $BRANCH (base $BASE_BRANCH) of repository $REPOSITORY for the ticket "$TICKET_TITLE": logic errors, unhandled edge cases, off-by-one mistakes, error handling, null/undefined safety, race conditions, and whether the change actually satisfies the ticket. This is a READ-ONLY review — do NOT modify any code. Return a concise findings list, each with a severity (BLOCKER/MAJOR/MINOR/NIT), the file location, and a suggested remediation. If you find no correctness issues, say so explicitly.\n\nTicket details:\n$ARGUMENTS';

const REVIEW_TESTS_PROMPT =
  'You are the TESTS reviewer on a parallel review panel. Review ONLY test concerns in the working changes on branch $BRANCH (base $BASE_BRANCH) of repository $REPOSITORY for the ticket "$TICKET_TITLE": coverage of the new behaviour, missing edge-case tests, flaky or brittle assertions, and whether the tests assert the right things. This is a READ-ONLY review — do NOT modify any code. Return a concise findings list, each with a severity (BLOCKER/MAJOR/MINOR/NIT), the file location, and a suggested remediation. If you find no test issues, say so explicitly.\n\nTicket details:\n$ARGUMENTS';

const REVIEW_STYLE_PROMPT =
  'You are the STYLE reviewer on a parallel review panel. Review ONLY style and maintainability concerns in the working changes on branch $BRANCH (base $BASE_BRANCH) of repository $REPOSITORY for the ticket "$TICKET_TITLE": readability, naming, consistency with existing conventions, dead code, and documentation. This is a READ-ONLY review — do NOT modify any code. Return a concise findings list, each with a severity (BLOCKER/MAJOR/MINOR/NIT), the file location, and a suggested remediation. If you find no style issues, say so explicitly.\n\nTicket details:\n$ARGUMENTS';

const SYNTHESIZE_PROMPT =
  'You are the review synthesizer. You have received independent findings from several specialist reviewers for the ticket "$TICKET_TITLE". Merge them into a single, deduplicated report prioritized by severity (BLOCKER, then MAJOR, MINOR, NIT). For each item give the concern area, the file location, and a recommended fix. End with an overall recommendation of APPROVE or REQUEST CHANGES. This is a READ-ONLY review — do NOT modify any code.';

const DEFAULT: WorkflowTemplate = {
  name: 'default',
  title: 'Default (investigate → implement → verify → PR)',
  description:
    'The balanced starting point: investigate the ticket, implement the change, run a verification script, pause for human approval, then open a pull request.',
  tags: ['general', 'recommended'],
  suggestedSwimlanes: ['backlog', 'investigating', 'in_progress', 'review', 'done'],
  workflow: {
    name: 'default',
    nodes: [
      { id: 'investigate', type: 'agent', provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL, swimlane: 'investigating' },
      {
        id: 'implement',
        type: 'agent',
        provider: DEFAULT_PROVIDER,
        model: DEFAULT_MODEL,
        dependsOn: ['investigate'],
        swimlane: 'in_progress',
      },
      {
        id: 'verify',
        type: 'shell',
        script: 'echo "run your test suite here"',
        dependsOn: ['implement'],
        swimlane: 'in_progress',
      },
      { id: 'approval', type: 'approval', dependsOn: ['verify'], swimlane: 'review' },
      {
        id: 'open_pr',
        type: 'scm',
        action: 'open_pull_request',
        dependsOn: ['approval'],
        swimlane: 'done',
      },
    ],
  },
};

const INVESTIGATE_ONLY: WorkflowTemplate = {
  name: 'investigate-only',
  title: 'Investigate only',
  description:
    'A single read-only investigation turn that produces findings without touching code, then parks the ticket in review for a human to decide next steps.',
  tags: ['research', 'triage'],
  suggestedSwimlanes: ['backlog', 'investigating', 'review'],
  workflow: {
    name: 'investigate-only',
    nodes: [
      { id: 'investigate', type: 'agent', provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL, swimlane: 'investigating' },
      { id: 'review', type: 'approval', dependsOn: ['investigate'], swimlane: 'review' },
    ],
  },
};

const PLAN_IMPLEMENT_VERIFY: WorkflowTemplate = {
  name: 'plan-implement-verify',
  title: 'Plan → implement (loop) → verify',
  description:
    'Draft a plan first, then implement it iteratively — the implement node loops until the agent reports ALL_TASKS_COMPLETE — before verifying, gating on approval, and opening a PR.',
  tags: ['general', 'iterative'],
  suggestedSwimlanes: ['backlog', 'planning', 'in_progress', 'review', 'done'],
  workflow: {
    name: 'plan-implement-verify',
    nodes: [
      { id: 'plan', type: 'agent', provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL, swimlane: 'planning' },
      {
        id: 'implement',
        type: 'agent',
        provider: DEFAULT_PROVIDER,
        model: DEFAULT_MODEL,
        dependsOn: ['plan'],
        swimlane: 'in_progress',
        loop: { maxIterations: 10, until: 'ALL_TASKS_COMPLETE' },
      },
      {
        id: 'verify',
        type: 'shell',
        script: 'echo "run your test suite here"',
        dependsOn: ['implement'],
        swimlane: 'in_progress',
      },
      { id: 'approval', type: 'approval', dependsOn: ['verify'], swimlane: 'review' },
      {
        id: 'open_pr',
        type: 'scm',
        action: 'open_pull_request',
        dependsOn: ['approval'],
        swimlane: 'done',
      },
    ],
  },
};

const TDD: WorkflowTemplate = {
  name: 'tdd',
  title: 'Test-driven development',
  description:
    'Write failing tests that capture the desired behaviour first, then loop on the implementation until the tests pass, run the suite, and open a PR.',
  tags: ['testing', 'iterative'],
  suggestedSwimlanes: ['backlog', 'in_progress', 'review', 'done'],
  workflow: {
    name: 'tdd',
    nodes: [
      { id: 'write_failing_tests', type: 'agent', provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL, swimlane: 'in_progress' },
      {
        id: 'implement',
        type: 'agent',
        provider: DEFAULT_PROVIDER,
        model: DEFAULT_MODEL,
        dependsOn: ['write_failing_tests'],
        swimlane: 'in_progress',
        loop: { maxIterations: 15, until: 'TESTS_PASS' },
      },
      {
        id: 'verify',
        type: 'shell',
        script: 'npm test',
        dependsOn: ['implement'],
        swimlane: 'in_progress',
      },
      {
        id: 'open_pr',
        type: 'scm',
        action: 'open_pull_request',
        dependsOn: ['verify'],
        swimlane: 'done',
      },
    ],
  },
};

const FIX_BUG: WorkflowTemplate = {
  name: 'fix-bug',
  title: 'Fix a bug',
  description:
    'Reproduce the reported bug, apply a targeted fix, verify it with tests, then gate on approval before opening a PR.',
  tags: ['bugfix'],

  suggestedSwimlanes: ['backlog', 'investigating', 'in_progress', 'review', 'done'],
  workflow: {
    name: 'fix-bug',
    nodes: [
      { id: 'reproduce', type: 'agent', provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL, swimlane: 'investigating' },
      {
        id: 'fix',
        type: 'agent',
        provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL,
        dependsOn: ['reproduce'],
        swimlane: 'in_progress',
      },
      {
        id: 'verify',
        type: 'shell',
        script: 'npm test',
        dependsOn: ['fix'],
        swimlane: 'in_progress',
      },
      { id: 'approval', type: 'approval', dependsOn: ['verify'], swimlane: 'review' },
      {
        id: 'open_pr',
        type: 'scm',
        action: 'open_pull_request',
        dependsOn: ['approval'],
        swimlane: 'done',
      },
    ],
  },
};

const FEATURE_DEVELOPMENT: WorkflowTemplate = {
  name: 'feature-development',
  title: 'Feature development',
  description:
    'A straightforward feature flow: plan the work, implement it, verify with a script, gate on approval, and open a PR.',
  tags: ['feature'],

  suggestedSwimlanes: ['backlog', 'planning', 'in_progress', 'review', 'done'],
  workflow: {
    name: 'feature-development',
    nodes: [
      { id: 'plan', type: 'agent', provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL, swimlane: 'planning' },
      {
        id: 'implement',
        type: 'agent',
        provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL,
        dependsOn: ['plan'],
        swimlane: 'in_progress',
      },
      {
        id: 'verify',
        type: 'shell',
        script: 'echo "run your test suite here"',
        dependsOn: ['implement'],
        swimlane: 'in_progress',
      },
      { id: 'approval', type: 'approval', dependsOn: ['verify'], swimlane: 'review' },
      {
        id: 'open_pr',
        type: 'scm',
        action: 'open_pull_request',
        dependsOn: ['approval'],
        swimlane: 'done',
      },
    ],
  },
};

const REFACTOR_SAFELY: WorkflowTemplate = {
  name: 'refactor-safely',
  title: 'Refactor safely (parallel gates)',
  description:
    'Refactor without changing behaviour, then fan out to run typecheck, lint (advisory), and tests in parallel before approval and a PR.',
  tags: ['refactor', 'quality'],

  suggestedSwimlanes: ['backlog', 'in_progress', 'review', 'done'],
  workflow: {
    name: 'refactor-safely',
    nodes: [
      { id: 'refactor', type: 'agent', provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL, swimlane: 'in_progress' },
      {
        id: 'typecheck',
        type: 'shell',
        script: 'npm run typecheck',
        dependsOn: ['refactor'],
        swimlane: 'in_progress',
      },
      {
        id: 'lint',
        type: 'shell',
        script: 'npm run lint',
        dependsOn: ['refactor'],
        swimlane: 'in_progress',
        continueOnError: true,
      },
      {
        id: 'test',
        type: 'shell',
        script: 'npm test',
        dependsOn: ['refactor'],
        swimlane: 'in_progress',
      },
      {
        id: 'approval',
        type: 'approval',
        dependsOn: ['typecheck', 'lint', 'test'],
        swimlane: 'review',
      },
      {
        id: 'open_pr',
        type: 'scm',
        action: 'open_pull_request',
        dependsOn: ['approval'],
        swimlane: 'done',
      },
    ],
  },
};

const QUICK_FIX: WorkflowTemplate = {
  name: 'quick-fix',
  title: 'Quick fix (no approval)',
  description:
    'For low-risk changes: implement, verify with a script, and open a PR straight away with no human approval gate.',
  tags: ['bugfix', 'fast'],

  suggestedSwimlanes: ['backlog', 'in_progress', 'done'],
  workflow: {
    name: 'quick-fix',
    nodes: [
      { id: 'implement', type: 'agent', provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL, swimlane: 'in_progress' },
      {
        id: 'verify',
        type: 'shell',
        script: 'npm test',
        dependsOn: ['implement'],
        swimlane: 'in_progress',
      },
      {
        id: 'open_pr',
        type: 'scm',
        action: 'open_pull_request',
        dependsOn: ['verify'],
        swimlane: 'done',
      },
    ],
  },
};

const DOCS_UPDATE: WorkflowTemplate = {
  name: 'docs-update',
  title: 'Documentation update',
  description:
    'Update or write documentation for a change, then open a PR. No build or test step since only docs change.',
  tags: ['docs', 'fast'],

  suggestedSwimlanes: ['backlog', 'in_progress', 'done'],
  workflow: {
    name: 'docs-update',
    nodes: [
      { id: 'update_docs', type: 'agent', provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL, swimlane: 'in_progress' },
      {
        id: 'open_pr',
        type: 'scm',
        action: 'open_pull_request',
        dependsOn: ['update_docs'],
        swimlane: 'done',
      },
    ],
  },
};

const DEPENDENCY_UPGRADE: WorkflowTemplate = {
  name: 'dependency-upgrade',
  title: 'Dependency upgrade',
  description:
    'Bump one or more dependencies and reconcile any breaking changes, verify the build and test suite still pass, then gate on approval before a PR.',
  tags: ['maintenance'],

  suggestedSwimlanes: ['backlog', 'in_progress', 'review', 'done'],
  workflow: {
    name: 'dependency-upgrade',
    nodes: [
      { id: 'upgrade', type: 'agent', provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL, swimlane: 'in_progress' },
      {
        id: 'verify',
        type: 'shell',
        script: 'npm install && npm test',
        dependsOn: ['upgrade'],
        swimlane: 'in_progress',
      },
      { id: 'approval', type: 'approval', dependsOn: ['verify'], swimlane: 'review' },
      {
        id: 'open_pr',
        type: 'scm',
        action: 'open_pull_request',
        dependsOn: ['approval'],
        swimlane: 'done',
      },
    ],
  },
};

const CODE_REVIEW: WorkflowTemplate = {
  name: 'code-review',
  title: 'Code review',
  description:
    'A single reviewer agent audits the working changes against the ticket, reports issues grouped by severity, then gates on human approval. Read-only: it never edits code.',
  tags: ['review', 'quality'],

  suggestedSwimlanes: ['backlog', 'reviewing', 'review', 'done'],
  workflow: {
    name: 'code-review',
    nodes: [
      {
        id: 'review',
        type: 'agent',
        provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL,
        swimlane: 'reviewing',
        instructions:
          'You are a meticulous code reviewer. Review the working changes on branch $BRANCH (base $BASE_BRANCH) of repository $REPOSITORY against the ticket "$TICKET_TITLE". This is a READ-ONLY review — do NOT modify any code. Assess correctness, security, performance, tests, and style. Report every issue grouped by severity (BLOCKER, MAJOR, MINOR, NIT), each with its file location and a concrete suggested fix, then give an overall recommendation of APPROVE or REQUEST CHANGES. If you find no issues, say so explicitly.\n\nTicket details:\n$ARGUMENTS',
      },
      { id: 'approval', type: 'approval', dependsOn: ['review'], swimlane: 'review' },
    ],
  },
};

const MULTI_AGENT_REVIEW: WorkflowTemplate = {
  name: 'multi-agent-review',
  title: 'Multi-agent review (parallel reviewers → synthesis)',
  description:
    'The headline pipeline: summarize the diff, fan out to five specialist reviewers (security, performance, correctness, tests, style) running in parallel, synthesize their findings into one prioritized report, then gate on approval.',
  tags: ['review', 'quality', 'parallel'],

  suggestedSwimlanes: ['backlog', 'reviewing', 'review', 'done'],
  workflow: {
    name: 'multi-agent-review',
    nodes: [
      {
        id: 'gather',
        type: 'agent',
        provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL,
        swimlane: 'reviewing',
        instructions:
          'Summarize the changes to be reviewed so the specialist reviewers can work in parallel. On branch $BRANCH (base $BASE_BRANCH) of repository $REPOSITORY, inspect the diff for the ticket "$TICKET_TITLE" and produce a concise summary: which files changed, the intent of each change, and any areas that look risky. This is a READ-ONLY review — do NOT modify any code.\n\nTicket details:\n$ARGUMENTS',
      },
      {
        id: 'review_security',
        type: 'agent',
        provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL,
        dependsOn: ['gather'],
        swimlane: 'reviewing',
        instructions: REVIEW_SECURITY_PROMPT,
      },
      {
        id: 'review_performance',
        type: 'agent',
        provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL,
        dependsOn: ['gather'],
        swimlane: 'reviewing',
        instructions: REVIEW_PERFORMANCE_PROMPT,
      },
      {
        id: 'review_correctness',
        type: 'agent',
        provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL,
        dependsOn: ['gather'],
        swimlane: 'reviewing',
        instructions: REVIEW_CORRECTNESS_PROMPT,
      },
      {
        id: 'review_tests',
        type: 'agent',
        provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL,
        dependsOn: ['gather'],
        swimlane: 'reviewing',
        instructions: REVIEW_TESTS_PROMPT,
      },
      {
        id: 'review_style',
        type: 'agent',
        provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL,
        dependsOn: ['gather'],
        swimlane: 'reviewing',
        instructions: REVIEW_STYLE_PROMPT,
      },
      {
        id: 'synthesize',
        type: 'agent',
        provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL,
        dependsOn: [
          'review_security',
          'review_performance',
          'review_correctness',
          'review_tests',
          'review_style',
        ],
        swimlane: 'reviewing',
        instructions: SYNTHESIZE_PROMPT,
      },
      { id: 'approval', type: 'approval', dependsOn: ['synthesize'], swimlane: 'review' },
    ],
  },
};

const REVIEW_AND_FIX: WorkflowTemplate = {
  name: 'review-and-fix',
  title: 'Review and fix (parallel review → synthesize → self-fix loop → PR)',
  description:
    'The full adversarial pipeline: fan out to parallel reviewers, synthesize their findings, then loop an implementer that addresses every issue until the review is clean, verify with the test suite, gate on approval, and open a pull request.',
  tags: ['review', 'quality', 'iterative', 'parallel'],

  suggestedSwimlanes: ['backlog', 'reviewing', 'in_progress', 'review', 'done'],
  workflow: {
    name: 'review-and-fix',
    nodes: [
      {
        id: 'review_security',
        type: 'agent',
        provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL,
        swimlane: 'reviewing',
        instructions: REVIEW_SECURITY_PROMPT,
      },
      {
        id: 'review_correctness',
        type: 'agent',
        provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL,
        swimlane: 'reviewing',
        instructions: REVIEW_CORRECTNESS_PROMPT,
      },
      {
        id: 'review_tests',
        type: 'agent',
        provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL,
        swimlane: 'reviewing',
        instructions: REVIEW_TESTS_PROMPT,
      },
      {
        id: 'synthesize',
        type: 'agent',
        provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL,
        dependsOn: ['review_security', 'review_correctness', 'review_tests'],
        swimlane: 'reviewing',
        instructions: SYNTHESIZE_PROMPT,
      },
      {
        id: 'fix',
        type: 'agent',
        provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL,
        dependsOn: ['synthesize'],
        swimlane: 'in_progress',
        loop: { maxIterations: 5, until: 'REVIEW_CLEAN' },
        instructions:
          'Address every finding in the synthesized review report for the ticket "$TICKET_TITLE" on branch $BRANCH (base $BASE_BRANCH) of repository $REPOSITORY. Make the code changes needed to resolve each issue, starting with the highest severity. After making your changes, re-check the report: if and only if every issue is fully resolved and no new issues remain, print exactly REVIEW_CLEAN on its own line. Otherwise describe what still remains so the next iteration can continue.\n\nTicket details:\n$ARGUMENTS',
      },
      {
        id: 'verify',
        type: 'shell',
        script: 'npm test',
        dependsOn: ['fix'],
        swimlane: 'in_progress',
      },
      { id: 'approval', type: 'approval', dependsOn: ['verify'], swimlane: 'review' },
      {
        id: 'open_pr',
        type: 'scm',
        action: 'open_pull_request',
        dependsOn: ['approval'],
        swimlane: 'done',
      },
    ],
  },
};

const SMART_PR_REVIEW: WorkflowTemplate = {
  name: 'smart-pr-review',
  title: 'Smart PR review (classify → parallel reviewers → synthesis)',
  description:
    "Assess a pull request's complexity and scope first, fan out to specialist reviewers in parallel, then synthesize a single prioritized review before gating on approval.",
  tags: ['review', 'quality', 'parallel', 'pr'],

  suggestedSwimlanes: ['backlog', 'reviewing', 'review', 'done'],
  workflow: {
    name: 'smart-pr-review',
    nodes: [
      {
        id: 'classify',
        type: 'agent',
        provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL,
        swimlane: 'reviewing',
        instructions:
          'Assess the pull request for the ticket "$TICKET_TITLE" on branch $BRANCH (base $BASE_BRANCH) of repository $REPOSITORY before it is reviewed in depth. Classify its complexity (trivial / moderate / complex), its scope (which subsystems it touches), and its risk level, and call out the areas that most warrant scrutiny. This is a READ-ONLY review — do NOT modify any code.\n\nTicket details:\n$ARGUMENTS',
      },
      {
        id: 'review_security',
        type: 'agent',
        provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL,
        dependsOn: ['classify'],
        swimlane: 'reviewing',
        instructions: REVIEW_SECURITY_PROMPT,
      },
      {
        id: 'review_performance',
        type: 'agent',
        provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL,
        dependsOn: ['classify'],
        swimlane: 'reviewing',
        instructions: REVIEW_PERFORMANCE_PROMPT,
      },
      {
        id: 'review_correctness',
        type: 'agent',
        provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL,
        dependsOn: ['classify'],
        swimlane: 'reviewing',
        instructions: REVIEW_CORRECTNESS_PROMPT,
      },
      {
        id: 'review_tests',
        type: 'agent',
        provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL,
        dependsOn: ['classify'],
        swimlane: 'reviewing',
        instructions: REVIEW_TESTS_PROMPT,
      },
      {
        id: 'review_style',
        type: 'agent',
        provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL,
        dependsOn: ['classify'],
        swimlane: 'reviewing',
        instructions: REVIEW_STYLE_PROMPT,
      },
      {
        id: 'synthesize',
        type: 'agent',
        provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL,
        dependsOn: [
          'review_security',
          'review_performance',
          'review_correctness',
          'review_tests',
          'review_style',
        ],
        swimlane: 'reviewing',
        instructions: SYNTHESIZE_PROMPT,
      },
      { id: 'approval', type: 'approval', dependsOn: ['synthesize'], swimlane: 'review' },
    ],
  },
};

const CONTEXT_AWARE_FIX: WorkflowTemplate = {
  name: 'context-aware-fix',
  title: 'Context-aware fix (codebase search + skills → agent-drafted PR)',
  description:
    'Investigate with the built-in codebase search MCP so the agent can pull the most relevant files into context, implement guided by the test-driven-change and conventional-commits skills, verify, gate on approval, then open a pull request whose title and body the agent drafts from the actual diff.',
  tags: ['bugfix', 'feature', 'rag', 'skills'],
  suggestedSwimlanes: ['backlog', 'investigating', 'in_progress', 'review', 'done'],
  workflow: {
    name: 'context-aware-fix',
    nodes: [
      {
        id: 'investigate',
        type: 'agent',
        provider: DEFAULT_PROVIDER,
        model: DEFAULT_MODEL,
        swimlane: 'investigating',
      },
      {
        id: 'implement',
        type: 'agent',
        provider: DEFAULT_PROVIDER,
        model: DEFAULT_MODEL,
        dependsOn: ['investigate'],
        swimlane: 'in_progress',
        skills: ['test-driven-change', 'conventional-commits'],
      },
      {
        id: 'verify',
        type: 'shell',
        script: 'npm test',
        dependsOn: ['implement'],
        swimlane: 'in_progress',
      },
      { id: 'approval', type: 'approval', dependsOn: ['verify'], swimlane: 'review' },
      {
        id: 'open_pr',
        type: 'scm',
        action: 'open_pull_request',
        provider: DEFAULT_PROVIDER,
        model: DEFAULT_MODEL,
        agentGenerated: true,
        dependsOn: ['approval'],
        swimlane: 'done',
      },
    ],
  },
};

const FAN_OUT_MIGRATION: WorkflowTemplate = {
  name: 'fan-out-migration',
  title: 'Migration workflow (plan → migrate → test → PR)',
  description:
    'Plan the change with an agent, apply the migration across the codebase, run the test suite, gate on approval, and open a pull request. A linear, single-repository workflow for scoped migrations and refactors.',
  tags: ['refactor', 'maintenance', 'linear'],
  suggestedSwimlanes: ['backlog', 'planning', 'in_progress', 'review', 'done'],
  workflow: {
    name: 'fan-out-migration',
    nodes: [
      { id: 'plan', type: 'agent', provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL, swimlane: 'planning' },
      {
        id: 'migrate',
        type: 'agent',
        provider: DEFAULT_PROVIDER,
        model: DEFAULT_MODEL,
        dependsOn: ['plan'],
        swimlane: 'in_progress',
        instructions:
          'Apply the migration planned above. Follow the plan exactly, keep the change tightly scoped, and update tests to match.\n\nTicket details:\n$ARGUMENTS',
      },
      {
        id: 'test',
        type: 'shell',
        script: 'npx nx run-many -t test',
        dependsOn: ['migrate'],
        swimlane: 'in_progress',
      },
      { id: 'approval', type: 'approval', dependsOn: ['test'], swimlane: 'review' },
      {
        id: 'open_pr',
        type: 'scm',
        action: 'open_pull_request',
        dependsOn: ['approval'],
        swimlane: 'done',
      },
    ],
  },
};

const SHIP_AND_ANNOUNCE: WorkflowTemplate = {
  name: 'ship-and-announce',
  title: 'Ship and announce (agent-drafted PR → notify + ticket comment)',
  description:
    'Implement the change, verify it, gate on approval, and open a pull request the agent drafts from the diff — then announce the outcome to the team via the configured notification providers and post a summary comment back on the ticket.',
  tags: ['feature', 'notifications'],
  suggestedSwimlanes: ['backlog', 'in_progress', 'review', 'done'],
  workflow: {
    name: 'ship-and-announce',
    nodes: [
      { id: 'implement', type: 'agent', provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL, swimlane: 'in_progress' },
      {
        id: 'verify',
        type: 'shell',
        script: 'npm test',
        dependsOn: ['implement'],
        swimlane: 'in_progress',
      },
      { id: 'approval', type: 'approval', dependsOn: ['verify'], swimlane: 'review' },
      {
        id: 'open_pr',
        type: 'scm',
        action: 'open_pull_request',
        provider: DEFAULT_PROVIDER,
        model: DEFAULT_MODEL,
        agentGenerated: true,
        dependsOn: ['approval'],
        swimlane: 'done',
      },
      {
        id: 'announce',
        type: 'message',
        messageTarget: 'notify',
        level: 'info',
        provider: DEFAULT_PROVIDER,
        model: DEFAULT_MODEL,
        agentGenerated: true,
        message:
          'Summarize the shipped change for the team channel in one or two sentences, and mention that a pull request has been opened for review.',
        dependsOn: ['open_pr'],
        swimlane: 'done',
      },
      {
        id: 'comment',
        type: 'message',
        messageTarget: 'comment',
        provider: DEFAULT_PROVIDER,
        model: DEFAULT_MODEL,
        agentGenerated: true,
        message:
          'Post a short comment on the ticket summarizing what changed and noting that a pull request is open and awaiting review.',
        dependsOn: ['open_pr'],
        swimlane: 'done',
      },
    ],
  },
};

export const DEFAULT_WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  DEFAULT,
  INVESTIGATE_ONLY,
  PLAN_IMPLEMENT_VERIFY,
  TDD,
  FIX_BUG,
  FEATURE_DEVELOPMENT,
  REFACTOR_SAFELY,
  QUICK_FIX,
  DOCS_UPDATE,
  DEPENDENCY_UPGRADE,
  CODE_REVIEW,
  MULTI_AGENT_REVIEW,
  REVIEW_AND_FIX,
  SMART_PR_REVIEW,
  CONTEXT_AWARE_FIX,
  FAN_OUT_MIGRATION,
  SHIP_AND_ANNOUNCE,
];

export const DEFAULT_WORKFLOW_TEMPLATES_BY_NAME: ReadonlyMap<string, WorkflowTemplate> =
  new Map(DEFAULT_WORKFLOW_TEMPLATES.map((t) => [t.name, t]));

/** All bundled workflow templates. */
export function listWorkflowTemplates(): WorkflowTemplate[] {
  return DEFAULT_WORKFLOW_TEMPLATES;
}

/** Look up a bundled workflow template by its stable name. */
export function getWorkflowTemplate(name: string): WorkflowTemplate | undefined {
  return DEFAULT_WORKFLOW_TEMPLATES_BY_NAME.get(name);
}

/** Build the lean, UI-facing summary of a template. */
export function toWorkflowTemplateSummary(template: WorkflowTemplate): WorkflowTemplateSummary {
  return {
    name: template.name,
    title: template.title,
    description: template.description,
    ...(template.tags ? { tags: template.tags } : {}),
    nodeCount: template.workflow.nodes.length,
    nodeTypes: Array.from(new Set(template.workflow.nodes.map((n) => n.type))),
  };
}

/**
 * Render a template's `workflow` block as YAML text, including the top-level
 * `workflow:` key, so it can be dropped into a project's raw config editor.
 */
export function renderWorkflowTemplateYaml(template: WorkflowTemplate): string {
  return stringify({ workflow: template.workflow }, { indent: 2, lineWidth: 0 });
}
