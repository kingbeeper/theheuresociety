-- Hora del recordatorio de seguimiento (para el calendario). Ejecutar DESPUÉS de 2026-10-24-appointment-followups.sql
alter table appointment_followups add column if not exists due_time text; -- HH:MM, hora de Miami (vacío = todo el día)
