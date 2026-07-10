/**
 * Resolve a `nodes.<id>[.<path>]` reference against an outputs map.
 * Returns the value (primitives as-is, objects as-is), or `undefined`
 * when the id is missing or the path doesn't exist.
 *
 * Kept in its own dependency-free module so it can be imported by the
 * browser-safe {@link file://./conditions.ts} without pulling in Node built-ins.
 */
export function resolveNodeReference(
  nodeOutputs: Record<string, unknown>,
  id: string,
  pathSegments: string[],
): unknown {
  const output = nodeOutputs[id];
  if (output === undefined || output === null) return undefined;
  if (pathSegments.length === 0) return output;
  let current: unknown = output;
  for (const seg of pathSegments) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[seg];
  }
  return current;
}
