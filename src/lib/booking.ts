import "server-only";
import { booking } from "./site";

// Horarios de cita en la hora de Miami, para el chatbot (la web usa la misma configuración de site.ts)
export const TIME_ZONE = "America/New_York";

const parts = (d: Date) =>
  Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short",
    }).formatToParts(d).map((p) => [p.type, p.value])
  );

// "2026-10-09" de hoy en Miami
export function todayInMiami(now = new Date()) {
  const p = parts(now);
  return `${p.year}-${p.month}-${p.day}`;
}

// Fecha y hora locales de Miami → instante UTC (tiene en cuenta el horario de verano)
export function miamiToUtc(dateKey: string, time: string) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const p = parts(new Date(guess));
  const shown = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute));
  return new Date(guess - (shown - guess));
}

// Próximos días con horario (desde mañana), quitando los huecos ya ocupados
export function upcomingSlots(taken: Date[], fromKey?: string, maxDays = 7) {
  const takenSet = new Set(taken.map((t) => t.getTime()));
  const start = new Date(miamiToUtc(todayInMiami(), "12:00"));
  const out: { date: string; weekday: string; times: string[] }[] = [];
  for (let i = 1; i <= booking.daysAhead && out.length < maxDays; i++) {
    const day = new Date(start.getTime() + i * 86_400_000);
    const p = parts(day);
    const key = `${p.year}-${p.month}-${p.day}`;
    if (fromKey && key < fromKey) continue;
    const weekdayIndex = new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day))).getUTCDay();
    const times = (booking.slots[weekdayIndex] ?? []).filter((t) => !takenSet.has(miamiToUtc(key, t).getTime()));
    if (times.length) out.push({ date: key, weekday: p.weekday, times });
  }
  return out;
}

export function isBookable(dateKey: string, time: string) {
  const today = todayInMiami();
  const last = new Date(miamiToUtc(today, "12:00").getTime() + booking.daysAhead * 86_400_000);
  const [y, m, d] = dateKey.split("-").map(Number);
  const weekdayIndex = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dateKey > today && miamiToUtc(dateKey, "12:00") <= last && (booking.slots[weekdayIndex] ?? []).includes(time);
}
