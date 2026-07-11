# Skills

Skills are reusable, self-contained instruction bundles — a folder with a `SKILL.md` (plus
optional references and scripts) following the Claude/opencode convention. An agent node opts
into skills by name, and Orion **materializes** the selected skills into the run's isolated
worktree so the harness discovers them natively.

## Using skills

Attach skills to an `agent` node with the `skills` field:

```yaml
workflow:
  nodes:
    - id: implement
      type: agent
      provider: codex
      skills: [conventional-commits, test-driven-change]
```

At run time, Orion resolves each name against the [catalog](#the-catalog) and copies the skill's
files into `<worktree>/.orion/skills/<name>/`, then writes a managed index into the worktree's
`AGENTS.md` (between `<!-- orion:skills:start -->` / `<!-- orion:skills:end -->` markers) so the
harness picks them up. A run **fails fast** with a clear error if an agent references a skill
that isn't in the catalog.

## The catalog

A project's skill catalog is the union of three scopes, with later scopes overriding earlier
ones by name:

1. **Built-in** — shipped with Orion.
2. **Global** — installed under `~/.orion/skills/`, available to every project.
3. **Project** — installed under `<repo>/.orion/skills/`, committed with the repo.

### Built-in skills

| Skill | Purpose |
| --- | --- |
| `conventional-commits` | Enforce the Conventional Commits format for commit messages |
| `test-driven-change` | Add a failing test first, then the change, and confirm the suite passes |
| `pr-description` | Produce structured PR descriptions (summary, changes, verification) |

A project skill of the same name overrides a built-in.

### Recommended skills

Orion surfaces a curated set of recommended skills (from
[anthropics/skills](https://github.com/anthropics/skills)) you can install with one click —
including `webapp-testing`, `mcp-builder`, `frontend-design`, `skill-creator`, `pdf`, `docx`,
`xlsx`, and `pptx`. These are **not** installed by default; browse and install the ones you
want.

## Installing skills

Install a skill from a GitHub repository. Orion shallow-clones the repo, discovers the skill
folder, copies it into the target scope, computes a SHA-256 hash, records it in a lock file for
reproducibility, and optionally runs a security scan. Private repos are supported via
`GITHUB_TOKEN`.

Skills can be managed from the web app (the **Skills** page for global skills, and a project's
skills view for project-scoped skills) or over the API:

```http
# List a project's catalog (built-in + global + project).
GET  /api/projects/:id/skills

# Install a project skill from a GitHub repo (owner/repo + path to the skill folder).
POST /api/projects/:id/skills   { "source": "owner/repo", "skillPath": "skills/my-skill", "ref": "main" }

# Re-sync an installed skill from its source.
POST /api/projects/:id/skills/:name/sync

# Remove an installed skill.
DELETE /api/projects/:id/skills/:name
```

Global skills use the parallel `/api/skills` routes. See the [API Reference](./api.md#skills)
for the full list.

## The lock file

Installed skills are recorded in `skills-lock.json` for reproducible checkouts:

- Project scope: `<repo>/.orion/skills-lock.json`
- Global scope: `~/.orion/skills-lock.json`

Each entry records the `source`, `sourceType`, `skillPath`, optional `ref`, the computed hash,
tags, and sync status. Syncing re-clones the source, compares the hash, and replaces the files
if they changed. Commit the project lock file so your whole team resolves the same skills.

## Authoring a skill

A skill is a folder containing a `SKILL.md` with YAML frontmatter:

```markdown
---
name: my-skill
description: One-line summary shown in the catalog and to the agent.
tags: [implement, review]
---

# My Skill

Detailed instructions the agent should follow when this skill is active…
```

Add any supporting reference files or scripts alongside `SKILL.md`; the whole folder is copied
into the worktree. Place it under `.orion/skills/<name>/` (project scope) or `~/.orion/skills/`
(global scope), or publish it to a GitHub repo and install it as above.

## Related reading

- [Workflows](./workflows.md) — the `agent` node that consumes skills.
- [Configuration](./configuration.md) — the rest of `.orion/config.yaml`.
- [Integrations](./integrations.md) — MCP servers, the other way to extend an agent.
