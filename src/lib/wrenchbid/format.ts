export function money(n: number | undefined | null, currency = "USD") {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
}

export function pct(n: number) {
  return `${Math.round(n * 100)}%`;
}

export function shortDate(iso: string | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function timestamp(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function shortHash(h: string | undefined) {
  if (!h) return "—";
  return h.slice(0, 12) + "…" + h.slice(-4);
}
