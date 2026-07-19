// Deterministic money arithmetic in integer cents. Ordinary binary floating
// point must never be used to add or subtract quoted amounts: 616.69 - 585
// is 31.690000000000055 in IEEE-754, which would leak into stored savings
// and evidence comparisons.

export function toCents(value: number): number {
  return Math.round(value * 100);
}

export function fromCents(cents: number): number {
  return cents / 100;
}

export function sumAmounts(...values: Array<number | undefined | null>): number {
  return fromCents(
    values.reduce<number>((total, value) => total + (value == null ? 0 : toCents(value)), 0),
  );
}

export function subtractAmounts(minuend: number, subtrahend: number): number {
  return fromCents(toCents(minuend) - toCents(subtrahend));
}
