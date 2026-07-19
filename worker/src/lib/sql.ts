export function placeholders(count: number, startAt = 1): string {
  return Array.from({ length: count }, (_, i) => `?${i + startAt}`).join(', ');
}
