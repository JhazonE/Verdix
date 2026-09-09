export type TreeProduct = { id: string; parentId?: string | null };

/**
 * All descendants of `rootId` (children, grandchildren, …), excluding `rootId`.
 * Cycle-safe: a visited set guarantees termination even on malformed data.
 */
export function getDescendantIds(rootId: string, products: TreeProduct[]): Set<string> {
  const childrenByParent = new Map<string, string[]>();
  for (const p of products) {
    const parent = p.parentId ?? null;
    if (parent === null) continue;
    if (!childrenByParent.has(parent)) childrenByParent.set(parent, []);
    childrenByParent.get(parent)!.push(p.id);
  }

  const result = new Set<string>();
  const stack = [...(childrenByParent.get(rootId) ?? [])];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (result.has(id) || id === rootId) continue;
    result.add(id);
    for (const child of childrenByParent.get(id) ?? []) stack.push(child);
  }
  return result;
}

/**
 * The set of product ids that may NOT become `childId`'s new parent:
 * the child itself (a product can't parent itself) plus all its descendants
 * (which would create a parent_id loop and break findUltimateRoot).
 */
export function getIllegalReassignTargets(childId: string, products: TreeProduct[]): Set<string> {
  const illegal = getDescendantIds(childId, products);
  illegal.add(childId);
  return illegal;
}

/**
 * The set of product ids that may NOT become a child of `parentId`:
 * the parent itself (a product can't be its own child) plus all its ancestors
 * (attaching an ancestor under its own descendant would create a parent_id loop).
 *
 * This is the mirror of getIllegalReassignTargets, asked from the parent's side.
 * Descendants are deliberately NOT excluded: re-attaching a grandchild one level
 * up is a legitimate move that reassignParent allows.
 */
export function getIllegalChildTargets(parentId: string, products: TreeProduct[]): Set<string> {
  const parentById = new Map<string, string | null>();
  for (const p of products) parentById.set(p.id, p.parentId ?? null);

  const illegal = new Set<string>([parentId]);
  let current = parentById.get(parentId) ?? null;
  // A visited set guarantees termination even if the data contains a loop.
  while (current !== null && !illegal.has(current)) {
    illegal.add(current);
    current = parentById.get(current) ?? null;
  }
  return illegal;
}
