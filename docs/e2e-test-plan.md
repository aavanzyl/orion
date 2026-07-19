# Orion E2E Test Plan — Live Coverage Tracker

**Purpose**: Single source of truth for live end-to-end coverage of the Orion deployment. Tracks every scenario tested against the real orchestrator, web UI, and Postgres.

**Environment**: Docker Compose on `mini.local` — Web `:8401`, Orchestrator `:8400`, Postgres `:8402`. Provider: `deepseek` (claude harness, flash/pro models). Board sync: Linear (team "Critiq"). `GITHUB_TOKEN` absent (push/PR blocked).

**E2E testing skill**: [.agents/skills/e2e-testing/SKILL.md](../.agents/skills/e2e-testing/SKILL.md)

**Update protocol**: Update Status/Date after every campaign. Add rows for new scenarios. Move fixed bugs to the ledger. Statuses: `PASS`, `FIXED+PASS`, `BUG-OPEN`, `BLOCKED-ENV`, `PENDING`.

## Config & Editors

| Scenario | Status | Evidence/Notes | Last tested |
|---|---|---|---|
| Form-mode CRUD (all 8 node-type dialogs) | PASS | Shell, HTTP, Condition, Message, Approval, Agent, GraphQL, SCM | 2026-07-17 |
| YAML-mode edit + save | PASS | Full config round-trip via PUT | 2026-07-17 |
| Server validation 422s (dup IDs, cycles, unknown dependsOn, broken issueType refs, YAML parse incl. colon-space) | PASS | Clear actionable messages | 2026-07-18 |
| Template picker insert + issueTypes auto-remap | FIXED+PASS | Remap + server validation + honest trigger name | 2026-07-18 |
| Visual builder (palette, properties panel, View YAML, unsaved guard) | PASS | | 2026-07-17 |
| Round-trip preservation (message model, scm provider/model, workflow ref) | FIXED+PASS | Shared writer no longer lossy | 2026-07-17 |

## Workflow Engine

| Scenario | Status | Evidence/Notes | Last tested |
|---|---|---|---|
| Swimlane triggers per issue type | PASS | Start-node swimlane match starts resolved workflow | 2026-07-17 |
| shell / http / condition (true+false skip) / message (notify+comment) / approval nodes | PASS | | 2026-07-17 |
| GraphQL happy path | PASS | countries.trevorblades.com → "South Africa" | 2026-07-18 |
| GraphQL/HTTP failure paths + retries (`node.retry` events) | PASS | 3 attempts observed | 2026-07-17 |
| Sub-workflow flattening (`workflow:` node) | PASS | | 2026-07-17 |
| Agent loop until-match | PASS | 2 iterations, sentinel match | 2026-07-17 |
| Agent loop maxIterations exhaustion | PASS | `loop reached maxIterations (2) without "..."` | 2026-07-18 |
| Budget `maxCostUsd` enforcement | PASS | `Budget exceeded: maxCostUsd limit (0.001) reached`; downstream node never ran | 2026-07-18 |
| `timeoutMs` → `failed` (not `cancelled`) | PASS | `node timed out after 2000ms` | 2026-07-18 |
| Concurrency: 3 slots, `run.queued`, drain | PASS | 4 simultaneous runs; 4th queued then drained | 2026-07-18 |
| Parallel fan-out | PASS | Gates started 0.01s apart; 5 reviewers same timestamp | 2026-07-18 |
| `continueOnError` advisory skip | PASS | | 2026-07-17 |
| `onFailureTransitionTo` → swimlane | PASS | Ticket moved, run failed, retry-via-move works | 2026-07-17 |
| `onFailureTransitionTo` → node loop-back (recovering) | PASS | flaky→fix marker pattern | 2026-07-17 |
| `onFailureTransitionTo` unbounded loop guard | FIXED+PASS | Was 500+ restarts/3s. Per-node budget (default 3, `onFailureTransitionLimit` override); verified 4 executions then `onFailureTransitionTo limit (3) reached` | 2026-07-18 |
| Cancel → run + node `cancelled` | FIXED+PASS | | 2026-07-17 |
| Retry = full replay (workspace recreated) | FIXED+PASS | All nodes reset; log explains semantics | 2026-07-18 |
| Retry via move + retry endpoint | PASS | | 2026-07-17 |
| Run diff honest | FIXED+PASS | Merge-base local-first + untracked files (was `HEAD~1` noise) | 2026-07-18 |
| Restart recovery | PASS | `docker restart` mid-run → run failed "Interrupted by an orchestrator restart" | 2026-07-18 |

## Agents / Harness

| Scenario | Status | Evidence/Notes | Last tested |
|---|---|---|---|
| deepseek via claude harness (file + inline instructions) | PASS | | 2026-07-18 |
| agentGenerated message/PR drafting with DB provider | FIXED+PASS | Provider→harness/baseUrl/key resolution | 2026-07-18 |
| Single `agent.message` event (harness dedup) | FIXED+PASS | | 2026-07-18 |
| Skills + mcpServers injection | PASS | `Loaded skills: ...`; `mcp__orion-codebase__search_code` invoked | 2026-07-18 |
| Missing instructions file | FIXED+PASS | Was path-as-prompt garbage; now fails: `instructions file "..." not found under .orion/ — create it or switch the node to inline instructions` | 2026-07-18 |

## SCM

| Scenario | Status | Evidence/Notes | Last tested |
|---|---|---|---|
| checkout_branch | PASS | | 2026-07-17 |
| open_pull_request commit path | FIXED+PASS | Git identity injected; single `Orion:` prefix | 2026-07-18 |
| open_pull_request push/PR | BLOCKED-ENV | No `GITHUB_TOKEN` → clean failure at `git push` | 2026-07-18 |
| merge / review / tag_release | BLOCKED-ENV | Need GitHub credentials | 2026-07-18 |

## Runs UX

| Scenario | Status | Evidence/Notes | Last tested |
|---|---|---|---|
| Ticket sheet run rows + live log viewer + Approve | PASS | | 2026-07-18 |
| Cancel / Retry buttons | ADDED+PASS | Active runs cancellable, failed/cancelled retryable | 2026-07-18 |
| Board auto-move per node swimlane | PASS | | 2026-07-17 |
| Debug page (event stream, filters) | PASS | | 2026-07-18 |
| `/runs/:id/events?nodeId=` accepts nodeKey | FIXED+PASS | Was raw 500 | 2026-07-18 |
| Run-failed log carries node error | FIXED+PASS | | 2026-07-18 |
| All 13 app pages render | PASS | issues, timeline, dashboard, analytics, evaluations, schedule, skills, mcp, codebase×2, knowledge-graph, settings, chat | 2026-07-18 |

## Features

| Scenario | Status | Evidence/Notes | Last tested |
|---|---|---|---|
| Schedules CRUD + fire + SSE | FIXED+PASS | Fire 401 fixed (DB-provider resolution); fire → `SCHEDULE-OK`. Note: provider derives from project's first agent node; agent-less projects fall back to codex (backlog: explicit provider field) | 2026-07-18 |
| Evaluations CRUD + summary | PASS | | 2026-07-18 |
| Labels CRUD + assign | PASS | | 2026-07-18 |
| Epics CRUD | PASS | Create requires `title` | 2026-07-18 |
| Timeline includes epic-linked tickets | FIXED+PASS | Filter now includes `epicId` linkage (was `type === 'epic'` only) | 2026-07-18 |
| Ticket relations (blocks/blocked_by inverse) | PASS | | 2026-07-18 |
| Ticket agent assign/unassign | PASS | | 2026-07-18 |
| Settings GET/PUT/restore | PASS | | 2026-07-18 |
| Board 409 + force-cancel move | PASS | | 2026-07-18 |

## Chat / RAG / Knowledge Graph

| Scenario | Status | Evidence/Notes | Last tested |
|---|---|---|---|
| RAG index (local provider, 256-dim) + semantic search + files/dirs | PASS | idle→indexing→ready <3s on small repo | 2026-07-18 |
| Conversations + SSE streaming + context follow-up | PASS | `message.delta`/`usage`/`done` events | 2026-07-18 |
| Intent routing | PASS | `{intent, reasoning}` | 2026-07-18 |
| Knowledge graph build/query/god-nodes/explain | PASS | Static extraction, instant on small repo | 2026-07-18 |
| Call/file/codegen graphs | PASS | Valid-empty for tiny repo | 2026-07-18 |

## Board Sync (Linear — live workspace)

| Scenario | Status | Evidence/Notes | Last tested |
|---|---|---|---|
| Connection status / containers / states endpoints | PASS | Team + 9 workflow states listed | 2026-07-18 |
| Inbound import (Linear issue → Orion ticket) | PASS | `imported:1`; source/externalId/stateMap honored | 2026-07-18 |
| Inbound update (Linear state change → Orion swimlane) | PASS | Scoped→review, `updated:1` | 2026-07-18 |
| Sync-triggered run (Linear state → trigger lane) | PASS | Todo→investigating auto-started run via sync path | 2026-07-18 |
| Comment routing (message node → Linear comment) | PASS | Comment visible on Linear issue, rendered template | 2026-07-18 |
| Outbound state push (Orion move → Linear state) | PASS | Move to investigating set Linear issue to Todo | 2026-07-18 |
| Agent final response stays local | PASS | `ticket.comment` is a local event, not pushed (by design) | 2026-07-18 |
| Mass-import auto-trigger runaway | FIXED+PASS | First sync fired 25+ agent runs for imports. `triggerOnImport` flag (default OFF; column + migration 0030 + UI toggle). Verified: 0 runs when off, 1 when on; state-change triggers unaffected | 2026-07-18 |

## Deployment

| Scenario | Status | Evidence/Notes | Last tested |
|---|---|---|---|
| docker compose rebuild loop | PASS | 6 deploy rounds this campaign | 2026-07-18 |
| Nginx SPA stale-cache | FIXED | `no-cache` index.html; `immutable` hashed assets | 2026-07-18 |
| DB migration on boot | PASS | Migration 0030 applied automatically | 2026-07-18 |

## Templates (17)

| Template | Status | Evidence/Notes | Last tested |
|---|---|---|---|
| default | PASS | Full run; open_pr blocked-env at push | 2026-07-18 |
| investigate-only | PASS | | 2026-07-17 |
| refactor-safely | PASS | Parallel gates, advisory lint | 2026-07-18 |
| plan-implement-verify | PASS | Loop until ALL_TASKS_COMPLETE (2 iterations) | 2026-07-18 |
| multi-agent-review | PASS | 5 reviewers, identical start timestamps, synthesis | 2026-07-18 |
| context-aware-fix | PASS | Skills + codebase-search MCP verified in events | 2026-07-18 |
| tdd, fix-bug, feature-development, quick-fix, docs-update, dependency-upgrade, code-review, review-and-fix, smart-pr-review, ship-and-announce | PASS (validation) | Unmodified YAML accepted by server | 2026-07-18 |
| fan-out-migration | FIXED+PASS (validation) | Description falsely promised matrix fan-out; retitled to linear migration flow | 2026-07-18 |

## Fixed-Bugs Ledger

| # | Bug | Root cause | Fix | Verified |
|---|---|---|---|---|
| 1 | agentGenerated failed for DB provider keys | `agent-text.ts` treated provider key as harness key; wrong baseUrl | Full DB-provider resolution | 2026-07-17 |
| 2 | `events?nodeId=<key>` raw 500 | UUID column got friendly key | Accept nodeKey or UUID | 2026-07-17 |
| 3 | Cancel marked nodes `failed` | Abort treated as normal failure | Run-cancel → `cancelled` (timeouts still fail) | 2026-07-17 |
| 4 | "Run failed: unknown error" | Node error not propagated | Message carries node error | 2026-07-17 |
| 5-7 | Round-trip loss (message model; scm provider/model; workflow ref) | `dataToNodeConfig` writer gaps | Fields preserved + UI inputs added | 2026-07-17 |
| 8 | Duplicate `agent.message` | Claude harness double-yield on result | Dedup identical final yield | 2026-07-17 |
| 9 | No Cancel/Retry UI | API fns unused | Buttons in ticket sheet run rows | 2026-07-17 |
| 10 | Template insert left broken issueTypes | No remap, no validation, dishonest trigger name | Remap helper + server validation + honest resolution | 2026-07-18 |
| 11 | `git commit` failed in container | No git identity | Inject `-c user.name/email` defaults | 2026-07-18 |
| 12 | `Orion: Orion:` commit prefix | Double prefixing | Use prTitle as-is | 2026-07-18 |
| 13 | Bogus run diff | `git diff --stat HEAD~1` | `computeRunDiff`: merge-base (local base first) + untracked | 2026-07-18 |
| 14 | Retry silently lost completed work | Worktree destroyed at terminal state, statuses kept | Full node reset on retry | 2026-07-18 |
| 15 | Stale SPA after deploys | No cache headers on index.html | `no-cache` + immutable assets | 2026-07-18 |
| 16 | `onFailureTransitionTo` unbounded loop | No cycle guard | Per-node transition budget (default 3) | 2026-07-18 |
| 17 | Timeline omitted epic-linked tickets | Filter on literal `type === 'epic'` | Include `epicId` linkage | 2026-07-18 |
| 18 | Schedule fire 401 with DB providers | Raw provider used as harness key | Mirror agent-executor resolution | 2026-07-18 |
| 19 | fan-out-migration template rot | Promised deprecated matrix | Honest title/description/tags | 2026-07-18 |
| 20 | Board-sync mass-import runaway | Import triggers fired unconditionally | `triggerOnImport` flag, default off | 2026-07-18 |
| 21 | Missing instructions file → path-as-prompt | ENOENT fallback rendered path as prompt | Hard fail with actionable error | 2026-07-18 |

## Open Bugs

None. (Last cleared 2026-07-18.)

## Blocked by Environment

| Area | Blocker | Detail |
|---|---|---|
| GitHub push / PR / merge / review / tag | Missing `GITHUB_TOKEN` | Clean failure at `git push`; add token to `.env` to unblock 5 scenarios |
| Slack / webhook notify delivery | No webhook URLs configured | notify target completes gracefully with 0 providers |
| Jira / Trello board sync | No API keys | Linear covered above |
| Codex provider | No API key | Schedule fire on agent-less projects defaults to codex → 401 |
| Linear issue creation quota | Free-plan limit reached | Reuse existing issues: delete Orion ticket → re-sync re-imports |

## Not Yet Covered (Backlog)

| Scenario | Notes |
|---|---|
| Multi-repo workspace projects | |
| MCP OAuth flow | |
| Skills install from GitHub | |
| Web-e2e specs for builder / template picker / notifications | |
| SSE reconnection behaviour | |
| Schedule explicit provider field | Currently derives from project's first agent node |
| Full execution of the 11 validation-only templates | Recompose tested primitives |
| Known config gap: critiq-context references `.orion/instructions/investigate.md` which does not exist in the repo | Next investigate run will fail with the (new, clear) missing-file error — create the file |
