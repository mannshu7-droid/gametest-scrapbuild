/** シード付きPRNG（mulberry32）。core内の乱数はこれのみ使用可。 */
export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** [0, n) の整数 */
export function randInt(rng: Rng, n: number): number {
  return Math.floor(rng() * n);
}
