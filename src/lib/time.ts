/** Clock-style timestamps (CLI-like): time only, date when the day changes. */

/** Sidebar chat list: "Jul 27, 3:45 PM" from ISO strings. */
export function formatSessionWhen(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  try {
    return new Date(t).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export function formatClock(at: number | undefined | null): string {
  if (at == null || !Number.isFinite(at)) return "";
  try {
    return new Date(at).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "";
  }
}

/** Short day label for separators, e.g. "Mon, Jul 27". */
export function formatDayLabel(at: number): string {
  try {
    const d = new Date(at);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    if (sameCalendarDay(d, today)) return "Today";
    if (sameCalendarDay(d, yesterday)) return "Yesterday";
    return d.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year:
        d.getFullYear() !== today.getFullYear() ? "numeric" : undefined,
    });
  } catch {
    return "";
  }
}

export function sameCalendarDay(
  a: Date | number,
  b: Date | number,
): boolean {
  const da = a instanceof Date ? a : new Date(a);
  const db = b instanceof Date ? b : new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

/** Full datetime for hover title. */
export function formatFullTimestamp(at: number | undefined | null): string {
  if (at == null || !Number.isFinite(at)) return "";
  try {
    return new Date(at).toLocaleString();
  } catch {
    return "";
  }
}
