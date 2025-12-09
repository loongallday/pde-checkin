export const EPSILON = 1e-9;

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || !b.length || a.length !== b.length) {
    return 0;
  }

  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < a.length; i += 1) {
    const valA = a[i];
    const valB = b[i];
    dot += valA * valB;
    magA += valA * valA;
    magB += valB * valB;
  }

  if (magA === 0 || magB === 0) {
    return 0;
  }

  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

export function normalizeVector(values: number[]): number[] {
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min;

  if (range <= EPSILON) {
    return values.map(() => 0);
  }

  return values.map((value) => (value - min) / range);
}
