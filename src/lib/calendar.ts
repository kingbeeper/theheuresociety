import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

// Calendario de citas para suscribirse desde el iPhone o Google Calendar. La dirección lleva una
// clave derivada de CRON_SECRET: quien no la tenga no puede leerlo.
export function calendarKey() {
  const secret = process.env.CRON_SECRET;
  return secret ? createHmac("sha256", secret).update("calendar-feed").digest("hex").slice(0, 32) : null;
}

export function validCalendarKey(key: string | null) {
  const expected = calendarKey();
  if (!expected || !key || key.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(key), Buffer.from(expected));
}
