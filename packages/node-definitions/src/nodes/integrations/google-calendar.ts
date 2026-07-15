import { z } from 'zod';
import { defineNode, NodeExecutionError } from '../../contract';

const configSchema = z.object({
  /** Credencial HTTP Bearer con un access token OAuth de Google Calendar. */
  credentialId: z.string().optional().default(''),
  calendarId: z.string().max(200).default('primary'),
  summary: z.string().min(1, 'El título del evento es obligatorio').max(500),
  description: z.string().max(5000).optional().default(''),
  /** Inicio en ISO 8601, p.ej. 2026-08-01T15:00:00. */
  startDateTime: z.string().min(1, 'Definí el inicio (ISO 8601)').max(40),
  endDateTime: z.string().min(1, 'Definí el fin (ISO 8601)').max(40),
  timezone: z.string().max(60).default('America/Argentina/Buenos_Aires'),
  /** Invitados por email, separados por coma. */
  attendees: z.string().max(1000).optional().default(''),
});

type Config = z.infer<typeof configSchema>;

/**
 * Crea un evento en Google Calendar. Autenticación v1: una credencial HTTP
 * Bearer con un access token OAuth de Google (scope calendar.events). El nodo
 * llama a la API de Calendar vía el servicio HTTP (con protección SSRF).
 * NOTA: requiere que consigas el token OAuth de Google (app en Google Cloud);
 * el flujo OAuth completo con refresh es una mejora futura.
 */
export const googleCalendarNode = defineNode<Config, unknown, unknown>({
  type: 'integrations.google-calendar',
  version: 1,
  category: 'integrations',
  displayName: 'Google Calendar: crear evento',
  description: 'Agenda una reunión en Google Calendar (con un token OAuth de Google).',
  icon: 'calendar-plus',
  configSchema,
  defaultConfig: {
    credentialId: '',
    calendarId: 'primary',
    summary: 'Reunión con {{trigger.name}}',
    description: '',
    startDateTime: '2026-08-01T15:00:00',
    endDateTime: '2026-08-01T15:30:00',
    timezone: 'America/Argentina/Buenos_Aires',
    attendees: '',
  },
  uiHints: [
    {
      field: 'credentialId',
      label: 'Credencial (Google OAuth token)',
      widget: 'credential',
      credentialTypes: ['http-bearer'],
      helpText: 'HTTP Bearer con un access token OAuth de Google (scope calendar).',
    },
    { field: 'calendarId', label: 'Calendario', widget: 'text', placeholder: 'primary' },
    { field: 'summary', label: 'Título', widget: 'text', supportsExpressions: true },
    { field: 'description', label: 'Descripción', widget: 'textarea', supportsExpressions: true },
    { field: 'startDateTime', label: 'Inicio (ISO)', widget: 'text', supportsExpressions: true, placeholder: '2026-08-01T15:00:00' },
    { field: 'endDateTime', label: 'Fin (ISO)', widget: 'text', supportsExpressions: true, placeholder: '2026-08-01T15:30:00' },
    { field: 'timezone', label: 'Zona horaria', widget: 'text' },
    { field: 'attendees', label: 'Invitados (emails, coma)', widget: 'text', supportsExpressions: true },
  ],
  inputs: [{ id: 'main', label: 'Entrada' }],
  outputs: [{ id: 'main', label: 'Salida' }],
  credentials: [{ type: 'http-bearer', required: false }],
  outputVariables: [
    { path: 'output.eventId', description: 'Id del evento creado' },
    { path: 'output.htmlLink', description: 'Link al evento' },
  ],
  exportable: true,
  documentation:
    'Necesita un access token OAuth de Google con scope de Calendar, guardado como credencial HTTP Bearer. Conseguí el token con tu app de Google Cloud (o el OAuth Playground para probar). Los tiempos van en ISO 8601.',
  async execute({ config, services }) {
    if (!services.http) {
      throw new NodeExecutionError('HTTP_SERVICE_UNAVAILABLE', 'El nodo de Calendar solo corre en worker/runtime.');
    }
    const attendees = config.attendees
      ? config.attendees.split(',').map((e) => e.trim()).filter(Boolean).map((email) => ({ email }))
      : undefined;
    const event: Record<string, unknown> = {
      summary: config.summary,
      description: config.description || undefined,
      start: { dateTime: config.startDateTime, timeZone: config.timezone },
      end: { dateTime: config.endDateTime, timeZone: config.timezone },
      ...(attendees && attendees.length > 0 ? { attendees } : {}),
    };
    const res = await services.http.request({
      method: 'POST',
      url: `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(config.calendarId)}/events`,
      body: event,
      credentialId: config.credentialId || undefined,
    });
    if (!res.ok) {
      throw new NodeExecutionError('CALENDAR_ERROR', `Google Calendar respondió HTTP ${res.status}`, {
        details: { body: res.body },
      });
    }
    const body = (res.body ?? {}) as { id?: string; htmlLink?: string };
    return { output: { eventId: body.id ?? null, htmlLink: body.htmlLink ?? null, created: true } };
  },
});
