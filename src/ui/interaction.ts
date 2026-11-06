export function toggleUnits(current: Set<number>, clicked: number[], additive: boolean) {
  if (!additive) return new Set(clicked);
  const result = new Set(current), remove = clicked.every(id => result.has(id));
  for (const id of clicked) { if (remove) result.delete(id); else result.add(id); }
  return result;
}
export const orderGesture = (distance: number, milliseconds: number) => distance >= 6 || milliseconds >= 280;
