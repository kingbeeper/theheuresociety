# The Heure Society — Rediseño

Vitrina de relojes de lujo (sin venta online) con inventario autogestionado, descripciones generadas por IA y citas.

## Decisiones
| Tema | Decisión |
|---|---|
| Plataforma | Next.js 16 + Tailwind 4, alojado en Vercel (sale de Shopify) |
| Base de datos / fotos / login admin | Supabase (Postgres + Storage + Auth) — ver `supabase/schema.sql` |
| Descripciones | API de Claude: foto + referencia → título, ficha técnica y descripción EN/ES |
| Idioma | Bilingüe EN/ES, detectado por región/navegador (`/en`, `/es`), con selector manual |
| Precios | Visibles; el cliente los fija al publicar cada reloj |
| Citas | Oficina con cita previa o videollamada → Cal.com integrado (sincroniza con Google Calendar) |
| Contacto | Botón WhatsApp por reloj con mensaje prellenado |
| Mantenimiento | Inicialmente el desarrollador; luego el cliente desde `/admin` |

## Páginas públicas
- `/` Portada: reloj protagonista, novedades, confianza (autenticidad, garantía), citas
- `/watches` Catálogo con filtros (marca, precio, estado)
- `/watches/[slug]` Ficha: galería grande, ficha técnica, precio, WhatsApp, "Agendar para verlo"
- `/sell` Vende tu reloj (formulario con fotos)
- `/appointments` Agendar: presencial u online
- `/about`, `/contact`

## Panel del cliente (`/admin`, móvil primero)
1. Subir fotos + escribir referencia (ej. `Rolex 126711CHNR`)
2. IA rellena título, ficha y descripción EN/ES
3. Cliente confirma: precio, estado, año, caja/papeles → **Publicar**
4. Un toque para marcar Reservado / Vendido

## Fases
1. **Diseño visual** con fotos reales (portada + ficha)
2. Web pública con datos de ejemplo
3. Supabase + panel admin
4. Generación con IA
5. Citas (Cal.com) + WhatsApp
6. Migración de dominio desde Shopify y lanzamiento

## Cuentas necesarias (a nombre del cliente)
- Supabase, Vercel, Anthropic (API key), Cal.com, número de WhatsApp Business
