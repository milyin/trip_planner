let seq = 1;

/** Monotonic id generator for new records (`r1`, `r2`, …). */
export const nextId = (): string => 'r' + seq++;
