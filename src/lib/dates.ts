// Fechas y horas para Telegram, como se leen en Miami: mes primero y hora con a. m. / p. m.

const TZ = "America/New_York";

// «2026-10-25» → «oct 25 · dom» (con día de la semana) u «oct 25»
export function monthFirst(iso: string, withWeekday = true) {
  const d = new Date(`${iso}T12:00:00Z`);
  const month = new Intl.DateTimeFormat("es-ES", { timeZone: "UTC", month: "short" }).format(d).replace(".", "");
  const weekday = new Intl.DateTimeFormat("es-ES", { timeZone: "UTC", weekday: "short" }).format(d).replace(".", "");
  return `${month} ${d.getUTCDate()}${withWeekday ? ` · ${weekday}` : ""}`;
}

// Instante → «3:30 p. m.» en la hora de Miami
export const hour12 = (d: Date) => new Intl.DateTimeFormat("es-US", { timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: true }).format(d);
