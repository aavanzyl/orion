---
name: e2e-testing
description: End-to-end test the LIVE Orion deployment (docker compose). USE WHEN user says "e2e test", "end-to-end test", "test the live app", "test the workflow engine live", "integration test against the deployment", "run e2e", "verify the deployment", "smoke test the app", "test docker deployment". Test the real orchestrator, web UI, and Postgres — not mocked unit/integration tests.
---

# E2E Testing Against the Live Deployment

You are testing the Orion monorepo deployed via docker compose on this machine. Exercise the real web UI (Playwright), orchestrator API, and workflow engine end-to-end.

## Environment

| Service      | URL                           | Notes                                        |
| ------------ | ----------------------------- | -------------------------------------------- |
| Web          | `http://127.0.0.1:8401`       | Vite dev/preview served from container       |
| Orchestrator | `http://127.0.0.1:8400/api/*` | Express API over Postgres                    |
| Postgres     | `127.0.0.1:8402`              | Direct DB access if needed                   |

- This machine IS `mini.local`. Use `127.0.0.1` in scripts (Python `getaddrinfo` can't resolve `.local` mDNS).
- Check running services: `docker compose ps`
- Deploy after code changes: `docker compose up -d --build` (rebuilds changed layers; ~1–3 min). Verify with:

```bash
curl -s http://127.0.0.1:8400/api/settings -o /dev/null -w "%{http_code}"
curl -s http://127.0.0.1:8401 -o /dev/null -w "%{http_code}"
```

- The orchestrator container mounts `$HOME` at the same host path, so `local` projects resolve.
- HTTP nodes inside workflows can call the orchestrator at `http://localhost:3333/api/...` (inside-container address) — a reliable test endpoint.

## Golden Rules

1. **Back up project config first.** `GET /api/projects/:id/config/raw` → save to a temp file. Restore it (PUT) and delete all test tickets when finished.
2. **Prefix all mock tickets with `"E2E "`** so cleanup is a title-filter + `DELETE /api/tickets/:id` loop.
3. **Mix surfaces.** Exercise the UI (Playwright) for user-click flows (config editor, template picker, ticket create/move, approve/cancel/retry buttons, debug page), and the REST API for fast setup/verification (config PUT, ticket create/move, run/event polling).
4. **Agent nodes:** use provider `deepseek`, model `deepseek-v4-flash` (cheap, ~$0.10/turn). Keep instructions inline, tiny, deterministic — a sentinel reply like `"Reply with exactly ORION-E2E-OK"` or a bounded file-creating task.
5. **Shell nodes** must be harmless: `echo`, `sleep`, `git rev-parse`. They run in an isolated git worktree of the real project repo.
6. **Fix + re-verify cycle:** after every fix, run the relevant nx tests + typecheck/lint, `docker compose up -d --build`, then **re-verify the exact failing scenario live** before moving on.

## Trigger Model

- Moving a ticket into a swimlane that matches a **START node's swimlane** (a node with no `dependsOn`) starts the workflow resolved for the ticket's issue type (`issueTypes[].workflow`, falling back to the main workflow).
- Active run on ticket → `409` on move. Use `force:'cancel'` or cancel first. Moving a ticket back to a failed node's swimlane **retries** that run.
- Ticket auto-moves through swimlanes as nodes with `swimlane:` set become active. Approval nodes pause the run in `waiting` (Approve button in ticket sheet or `POST /runs/:id/approve`).

## Key API Endpoints

All under `http://127.0.0.1:8400/api`. Use `curl` for fast setup/verification.

### Config

```bash
# Save original config
curl -s http://127.0.0.1:8400/api/projects/<id>/config/raw > /tmp/orig-config.json

# PUT updated config (validates; 422 with message on invalid)
curl -s -X PUT http://127.0.0.1:8400/api/projects/<id>/config/raw \
  -H "Content-Type: application/json" -d @/tmp/test-config.json
```

### Tickets

```bash
# Create
curl -s -X POST http://127.0.0.1:8400/api/projects/<id>/tickets \
  -H "Content-Type: application/json" \
  -d '{"title":"E2E Test Ticket","type":"task","swimlane":"backlog"}'

# Move (returns {ticket, trigger:{action, runId}})
curl -s -X POST http://127.0.0.1:8400/api/tickets/<ticketId>/move \
  -H "Content-Type: application/json" \
  -d '{"swimlane":"in-progress"}'

# Delete
curl -s -X DELETE http://127.0.0.1:8400/api/tickets/<id>
```

### Runs

```bash
# List runs for a project
curl -s 'http://127.0.0.1:8400/api/runs?projectId=<id>'

# Get run detail (nodes + statuses)
curl -s http://127.0.0.1:8400/api/runs/<runId>

# Get events (filter by type, nodeId accepts nodeKey or UUID)
curl -s 'http://127.0.0.1:8400/api/runs/<runId>/events?type=node.started&nodeId=<nodeKey>'

# Approve / cancel / retry
curl -s -X POST http://127.0.0.1:8400/api/runs/<runId>/approve \
  -H "Content-Type: application/json" -d '{"nodeKey":"approval-node"}'
curl -s -X POST http://127.0.0.1:8400/api/runs/<runId>/cancel
curl -s -X POST http://127.0.0.1:8400/api/runs/<runId>/retry
```

### SSE Streams

```bash
curl -s -N http://127.0.0.1:8400/api/runs/<runId>/stream
curl -s -N 'http://127.0.0.1:8400/api/projects/<id>/board/stream'
```

## Node-Type Test Recipes

Below is a compact YAML config exercising every major node type. Adapt `projectId` and swimlane names to the project under test.

```yaml
workflows:
  main:
    nodes:
      start:
        type: shell
        command: "echo 'E2E START'"
        swimlane: "todo"
        description: "Trigger: move ticket to 'todo' to start"
      http-test:
        dependsOn: [start]
        type: http
        url: "http://localhost:3333/api/settings"
        method: GET
        description: "HTTP request to orchestrator's own API"
      condition-test:
        dependsOn: [http-test]
        type: condition
        conditions:
          - condition: "nodes.http-test.status == 200"
            transitionTo: "success-branch"
          - condition: "true"
            transitionTo: "failure-branch"
      success-branch:
        type: message
        message: "{{ nodes.http-test.status }} OK"
      failure-branch:
        type: message
        message: "HTTP node returned {{ nodes.http-test.status }}"
        onFailureTransitionTo: "todo"  # loop-back swimlane reset
      approval-gate:
        dependsOn: [success-branch]
        type: approval
        swimlane: "review"
        description: "Pauses run; approve via UI or API"
      agent-test:
        dependsOn: [approval-gate]
        type: agent
        provider: deepseek
        model: deepseek-v4-flash
        instructions: "Reply with exactly ORION-E2E-OK"
        loop:
          maxIterations: 3
          until: "response contains 'ORION-E2E-OK'"
      shell-retry:
        dependsOn: [agent-test]
        type: shell
        command: "echo done"
        retries: 2
        continueOnError: true
      http-bad-url:
        dependsOn: [shell-retry]
        type: http
        url: "http://example.invalid/e2e-test"
        method: GET
        continueOnError: true
        description: "Tests graceful failure handling"
```

### Notes on condition syntax

- Node references in conditions use bare `nodes.<id>.<field>` syntax (e.g., `nodes.http-test.status == 200`).
- Template expressions `{{ nodes.x.y }}` are used in `message`, `url`, `command`, and `instructions` fields.
- `onFailureTransitionTo` can target a swimlane name (loop-back) or a node key.

### Node types not covered above

- **Sub-workflow**: use `type: workflow` with `workflow:` pointing to another workflow name.
- **SCM checkout_branch**: `type: scm`, `action: checkout_branch` — works local-only.
- **GraphQL / SCM PR / SCM merge**: need external endpoints. Test their **failure handling** instead (bad URL + `continueOnError: true`).

## Playwright UI Notes

- **Board drag-and-drop (dnd-kit) does not work** with Playwright's `dragTo`. Move tickets via ticket sheet Edit → Swimlane select, or the API.
- **Radix selects** are not native `<select>`: click the combobox trigger, then click the option role in the popover.
- The **builder page** has a `beforeunload` guard when dirty. Accept the dialog or save first.
- **Useful check pattern:** after moving a ticket, poll `GET /runs?projectId=` for the trigger result, then assert node statuses via `GET /runs/:id`.

```javascript
// Example: polling for a run after ticket move (in-browser via page.evaluate)
const run = await page.evaluate(async (projectId) => {
  for (let i = 0; i < 20; i++) {
    const res = await fetch(`/api/runs?projectId=${projectId}`);
    const runs = await res.json();
    const active = runs.find(r => r.status !== 'completed' && r.status !== 'failed');
    if (active) return active;
    await new Promise(r => setTimeout(r, 500));
  }
  return null;
}, projectId);
```

## Parallel Testing Isolation

When running concurrent test agents:

- Create **throwaway local projects** — one per concurrent test agent — under `~/Documents/Development/orion-e2e-scratch/<name>/`. Initialize with `git init` and register via `POST /api/projects {"name","sourceKind":"local","rootPath":"..."}`.
- **Never share** a project's config between parallel agents. Each agent owns its project and its config end-to-end.
- Delete projects at campaign end: `DELETE /api/projects/:id` for each scratch project.

```bash
# Create a scratch project for one agent
mkdir -p ~/Documents/Development/orion-e2e-scratch/agent-1
cd ~/Documents/Development/orion-e2e-scratch/agent-1 && git init
PROJECT_ID=$(curl -s -X POST http://127.0.0.1:8400/api/projects \
  -H "Content-Type: application/json" \
  -d '{"name":"E2E Agent 1","sourceKind":"local","rootPath":"'"$HOME"'/Documents/Development/orion-e2e-scratch/agent-1"}' \
  | jq -r '.id')
```

## Global Run Concurrency Limit

The orchestrator caps concurrent runs at **3** (`ORION_MAX_CONCURRENT_RUNS`). Implications for testing:

- **Parallel campaigns queue**: if more than 3 runs are active across all projects, additional runs enter `queued` status and drain as slots free.
- **Sequence agent-node runs** within a single task — fire one, wait for completion, then fire the next. This avoids self-induced queueing that confuses timing-dependent assertions.
- **Expect `run.queued`** events when testing concurrency behaviour. Verify queued runs eventually start and complete correctly.

## Browser Stale-Bundle Phantom

After every `docker compose up -d --build`, a long-lived Playwright browser may still hold a pre-deploy HTML document (with stale JS bundle references). We shipped a `no-cache` header fix for `index.html`, but a browser that loaded the page before the fix was deployed will not benefit from it retroactively.

**Before trusting any UI test result after a deploy**, run this verification:

```javascript
// 1. Hard-refresh with cache-busting query
await page.goto(`http://127.0.0.1:8401/?cachebust=${Date.now()}`, { waitUntil: 'networkidle' });

// 2. Collect all script src hashes in the current page
const pageHashes = await page.evaluate(() =>
  [...document.querySelectorAll('script[src]')].map(s => s.src)
);

// 3. Compare against the server's current index.html
// (run from host: curl -s http://127.0.0.1:8401/ | grep -oP 'index-[A-Za-z0-9]+\.js')
// If they differ, close the browser context and create a fresh one.
```

If hashes mismatch, close the browser context and create a fresh one — do not trust the stale page.

## YAML Config Gotchas

Any YAML scalar containing `: ` (colon followed by a space) **must be quoted**. The YAML parser interprets unquoted `: ` as a mapping key separator and will reject the config with a 422 parse error.

```yaml
# WRONG — will 422
command: "echo key: value"

# RIGHT — but only works because the whole string is quoted in JSON
# When editing raw YAML (not JSON-wrapped), wrap the value:
command: "echo 'key: value'"
# or
command: >
  echo "key: value"
```

Common offenders: shell commands that echo `"key: value"`, HTTP response assertions, and agent instructions that contain colon-space patterns.

## Public Endpoints for Happy-Path Testing

Use these stable, free endpoints for deterministic happy-path tests:

| Node type | Endpoint | Notes |
|---|---|---|
| GraphQL | `https://countries.trevorblades.com/` | `query { country(code:"ZA") { name } }` → `"South Africa"` |
| GraphQL (alt) | `https://rickandmortyapi.com/graphql` | `query { character(id:1) { name } }` → `"Rick Sanchez"` |
| HTTP slow/timeout | `https://httpbin.org/delay/10` | Returns after 10s; test timeout behaviour |
| HTTP timeout (no response) | `http://10.255.255.1/` | Non-routable IP; connection hangs until OS-level timeout |

## Destructive-Op Coordination

- **`docker restart` or `docker compose down/up` kills ALL active runs** on the box. Never do this while any test agent has runs in flight — you'll lose run state and trigger incomplete `cancelled`/`failed` statuses.
- **Restart-recovery tests (`recoverInterruptedRuns`) go LAST** in every campaign, after all other scenarios have been verified and no agents have active runs.
- If you must restart during a campaign, coordinate: drain all active runs (wait for completion or cancel them), confirm with all agents, then proceed.

## Test Plan Discipline

`docs/e2e-test-plan.md` is a **catalog of testable features** — every scenario that *can* be tested, how to exercise it, and what to expect. It is NOT a tracker: no statuses, no bug ledger, no test dates.

1. **Add rows** for any feature/scenario you discover that isn't in the plan; remove rows for features that no longer exist.
2. **Keep "How to test" / "Expected" accurate** when behaviour changes.
3. **Report results elsewhere**: campaign outcomes, bugs found, fixes, and verification go in your campaign report to the user — never into the plan.

## Known Environment Blocks

These areas are permanently blocked on `mini.local` until secrets are provisioned:

- **`GITHUB_TOKEN` absent** → `open_pull_request` fails at `git push` with "could not read Username". All GitHub-dependent actions (push, PR, merge, review, tag_release) are unreachable. Report as environment-blocked, not a bug.
- **Linear / Jira / Trello board sync** — no API keys.
- **Codex provider** — no API key.
- **Slack / webhook notify delivery** — no webhook URLs configured.

## Iteration Protocol

1. **Keep a findings list:** bug description → root cause `file:line` → fix → verify status.
2. **Spawn subagents** for fixes with exact repro steps + verification commands while continuing to test.
3. **Batch deploy rounds:** group multiple fixes into one `docker compose up -d --build`, then verify each fix against its original repro.
4. **Update `apps/web-e2e` specs** (mocked Playwright suite) to lock in every UI behaviour you fixed:

```bash
npx nx run web-e2e:e2e
```

## Cleanup Checklist

1. `PUT` the original config back: `curl -s -X PUT .../projects/<id>/config/raw -H "Content-Type: application/json" -d @/tmp/orig-config.json`
2. `DELETE` all `"E2E "` tickets (fetch tickets, filter by title prefix, delete each).
3. Delete any scratch projects created for parallel testing: `DELETE /api/projects/:id`.
4. Confirm board looks like before: `GET /projects/:id/board`.
5. Add any newly-discovered testable features to `docs/e2e-test-plan.md` (catalog only — results go in your campaign report).
6. Leave docker running (do not `docker compose down`).
7. Report uncommitted changes; **never commit unless asked**.

## Board-Sync (Linear) Testing

- The board connection lives per-project: `GET/PUT /api/projects/:id/board-connection`, `POST .../sync`, `GET .../containers|/states`. API keys are encrypted at rest; never write them to files or docs.
- **Before the first sync of a real workspace, check the blast radius**: `importNew: true` imports EVERY remote issue, and any issue whose mapped state lands in a trigger swimlane would historically auto-start a run. `triggerOnImport` (default false) now guards this — leave it off for real workspaces; state-CHANGE triggers still fire.
- If a runaway happens anyway: list active runs (`GET /runs?projectId=`) and cancel them all immediately; check whether ticket comments leaked to the tracker (only `message` nodes with `messageTarget: comment` push remotely — agent final responses are local `ticket.comment` events only).
- Controlled test recipe (single issue, near-zero cost): create one remote issue via the provider API in an UNMAPPED/backlog state → sync → verify import; use a shell-only workflow on the trigger lane; drive state changes from the provider side and re-sync to test sync-triggered runs; use a `message` comment node to verify comment routing; move the Orion ticket to verify outbound state push.
- Free-plan Linear workspaces can hit issue-creation quotas: re-test imports by DELETING the Orion ticket and re-syncing (the remote issue re-imports as new).
- Neutralize triggers during risky syncs by saving a config whose only start node sits in an unmapped swimlane (quarantine lane).
