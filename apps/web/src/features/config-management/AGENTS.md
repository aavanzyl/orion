# AGENTS.md — Config management (config editor + visual builder)

This folder contains **two different UIs that edit the exact same thing**: a
project's `.orion/config.yaml` (`ProjectConfig` from `@orion/models`).

```
config-management/
  shared/     Shared model + components used by BOTH surfaces. Change here first.
  config/     The form/YAML config editor  (route: /projects/:projectId/config)
  builder/    The visual React Flow builder (route: /projects/:projectId/builder)
```

## The golden rule: the two surfaces MUST mirror each other

`config/` and `builder/` are **two distinct ways of managing the same config**,
offered so users can pick whichever fits how they think — a structured
form/raw-YAML editor, or a drag-and-drop DAG canvas. They are **not** a
"basic" and an "advanced" editor.

Therefore:

- **Every config capability must exist in BOTH surfaces.** If you add, change, or
  remove a feature in one, you must do the same in the other in the same change.
- Neither surface may be lossy: opening a config in either editor and saving it
  must never silently drop fields the other editor (or the YAML) can express.
- When in doubt about UX or defaults, follow the **config editor** — it is the
  reference implementation for shared behaviours (instructions defaulting,
  template picker, inline validation, etc.).

If you genuinely cannot bring a feature to one surface, stop and raise it rather
than shipping asymmetry.

## How the mirroring is enforced in code

Almost all of the logic is shared so the two surfaces cannot drift:

- **`shared/node-model.ts`** is the single source of truth for a node:
  - `NodeData` — the canonical editable shape of one workflow node.
  - `nodeConfigToData()` / `dataToNodeConfig()` — the only reader/writer between
    `WorkflowNodeConfig` (YAML) and `NodeData`. Both surfaces use these, so
    round-tripping is identical and lossless.
  - `NODE_TYPES`, `NODE_TYPE_LABELS`, `NODE_TYPE_DESCRIPTIONS`, `SCM_ACTIONS`,
    `SCM_ACTION_LABELS`, `validateNodeData()`, `defaultInstructionsPath()`.
- **`shared/node-properties/*`** — the per-type field editors (agent extras, scm,
  notify, comment, condition, http, loop, matrix). Both the
  builder's `node-properties-panel.tsx` and the config's `workflow-node-dialog.tsx`
  render these same components.
- **`shared/instructions-field.tsx`** — the instructions editor (file path with
  autocomplete + "Edit file", or inline text) used by both.
- **`shared/markdown-file-editor.tsx`**, **`shared/workflow-template-dialog.tsx`** —
  shared dialogs used by both.

Surface-specific serialization:

- `builder/builder-model.ts` — graph ⇄ workflow conversion + `buildFullYaml()`,
  which overlays the edited sections onto the parsed raw YAML so untouched
  top-level keys survive a save.
- `config/config-model.ts` — form model ⇄ workflow conversion. `parseConfigToModel`
  keeps the parsed root as `baseline`, and `modelToYaml` overlays the edited
  sections onto it for the same preservation guarantee.

## Checklist when adding a config feature

1. Add the field to `NodeData` (node-level) **or** `ConfigFormModel` +
   `BuilderConfig`/settings (config-level).
2. Wire it through `nodeConfigToData` + `dataToNodeConfig` (node-level), and both
   `config-model.ts` and `builder-model.ts` (config-level), so it round-trips.
3. Add/extend a `shared/node-properties/*` editor when it is node-type specific.
4. Surface it in **both** `config/workflow-node-dialog.tsx` (or `config-form.tsx`
   for config-level) **and** `builder/node-properties-panel.tsx` (or the builder
   page's Settings dialog for config-level).
5. Mirror validation via `validateNodeData` (shared) and the per-surface
   `validateModel` / `validateGraph`.
6. Verify: `npx nx run @orion/web:typecheck`, `npx nx run @orion/web:lint`, and
   the web build. Manually confirm the field survives a Form → YAML → Form and a
   builder → save → config round-trip.

## Event recording and notifications

When a feature changes how state is mutated (new node types, new workflow actions,
or config-driven side effects), ensure the corresponding events are emitted so the
debug page, SSE streams, and notification provider can surface them:

- **Engine events**: Extend `RunEventType` in `packages/shared/models/src/lib/event.model.ts`.
  Emit appropriate events (both lifecycle and `transition` events) in the workflow engine
  (`packages/core/workflow-engine/src/lib/engine.ts`).
- **Notification events**: If the new feature should notify users, add a key to
  `NotificationEventKey` in `packages/shared/models/src/lib/settings.model.ts`.
- **Notification defaults**: Add defaults in `apps/web/src/lib/use-preferences.ts`
  (`DEFAULT_EVENT_PREFS`) and render the toggle in the Notifications tab.
- **Notification provider**: Wire the new event type into
  `apps/web/src/features/notifications/run-notifications-provider.tsx`.
