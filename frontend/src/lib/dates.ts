export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function dueBadge(dueDate: string | null): { label: string; className: string } | null {
  if (!dueDate) return null;
  const today = todayIso();
  if (dueDate < today) return { label: `Overdue ${dueDate}`, className: 'pill overdue' };
  if (dueDate === today) return { label: 'Due today', className: 'pill due-soon' };
  return { label: dueDate, className: 'pill' };
}

export function formatMinutes(minutes: number): string {
  if (!minutes) return '0m';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}
