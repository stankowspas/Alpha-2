export function visibleLoadPercent(progress: number, ready: boolean): number {
  if (ready) return 100;
  const normalized = Math.max(0, Math.min(1, progress));
  return Math.min(99, Math.floor(normalized * 100));
}
