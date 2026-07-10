import { z } from 'zod';

/* ── Clientes ──────────────────────────────────────────────── */

export const CLIENT_STATUSES = [
  'PROSPECT',
  'IN_DEVELOPMENT',
  'ACTIVE',
  'PAUSED',
  'FINISHED',
  'ARCHIVED',
] as const;
export type ClientStatus = (typeof CLIENT_STATUSES)[number];

export const CLIENT_STATUS_LABELS: Record<ClientStatus, string> = {
  PROSPECT: 'Prospecto',
  IN_DEVELOPMENT: 'En desarrollo',
  ACTIVE: 'Activo',
  PAUSED: 'Pausado',
  FINISHED: 'Finalizado',
  ARCHIVED: 'Archivado',
};

export const createClientSchema = z.object({
  name: z.string().trim().min(1, 'El nombre es obligatorio').max(120),
  legalName: z.string().trim().max(200).optional().or(z.literal('')),
  industry: z.string().trim().max(120).optional().or(z.literal('')),
  contactName: z.string().trim().max(120).optional().or(z.literal('')),
  contactEmail: z.string().trim().email('Email inválido').optional().or(z.literal('')),
  contactPhone: z.string().trim().max(40).optional().or(z.literal('')),
  status: z.enum(CLIENT_STATUSES),
  internalNotes: z.string().max(5000).optional().or(z.literal('')),
});
export const updateClientSchema = createClientSchema.partial();
export type CreateClientInput = z.infer<typeof createClientSchema>;
export type UpdateClientInput = z.infer<typeof updateClientSchema>;

/* ── Proyectos ─────────────────────────────────────────────── */

export const PROJECT_TYPES = [
  'WHATSAPP_BOT',
  'WEBCHAT_BOT',
  'WEBHOOK_AUTOMATION',
  'SCHEDULED_AUTOMATION',
  'SYSTEM_INTEGRATION',
  'AI_AGENT',
  'INTERNAL_AUTOMATION',
  'CUSTOM',
] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

export const PROJECT_TYPE_LABELS: Record<ProjectType, string> = {
  WHATSAPP_BOT: 'Bot de WhatsApp',
  WEBCHAT_BOT: 'Bot de chat web',
  WEBHOOK_AUTOMATION: 'Automatización por webhook',
  SCHEDULED_AUTOMATION: 'Automatización programada',
  SYSTEM_INTEGRATION: 'Integración entre sistemas',
  AI_AGENT: 'Agente de IA',
  INTERNAL_AUTOMATION: 'Automatización interna',
  CUSTOM: 'Proyecto personalizado',
};

export const PROJECT_STATUSES = [
  'DRAFT',
  'IN_DEVELOPMENT',
  'IN_TESTING',
  'READY_FOR_PRODUCTION',
  'EXPORTED',
  'IN_PRODUCTION',
  'PAUSED',
  'ARCHIVED',
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  DRAFT: 'Borrador',
  IN_DEVELOPMENT: 'En desarrollo',
  IN_TESTING: 'En pruebas',
  READY_FOR_PRODUCTION: 'Listo para producción',
  EXPORTED: 'Exportado',
  IN_PRODUCTION: 'En producción',
  PAUSED: 'Pausado',
  ARCHIVED: 'Archivado',
};

export const createProjectSchema = z.object({
  clientId: z.string().min(1, 'Seleccioná un cliente'),
  name: z.string().trim().min(1, 'El nombre es obligatorio').max(120),
  description: z.string().max(2000).optional().or(z.literal('')),
  type: z.enum(PROJECT_TYPES),
});
export const updateProjectSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().max(2000).optional().or(z.literal('')),
  type: z.enum(PROJECT_TYPES).optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

/* ── Entornos ──────────────────────────────────────────────── */

export const ENVIRONMENT_KINDS = ['DEVELOPMENT', 'TESTING', 'PRODUCTION'] as const;
export type EnvironmentKind = (typeof ENVIRONMENT_KINDS)[number];

/* ── Ejecuciones (estados; el motor llega en Fase 3) ───────── */

export const EXECUTION_STATUSES = [
  'QUEUED',
  'RUNNING',
  'WAITING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
  'TIMED_OUT',
] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

export const STEP_STATUSES = [
  'PENDING',
  'RUNNING',
  'WAITING',
  'SUCCEEDED',
  'FAILED',
  'SKIPPED',
  'CANCELLED',
] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

/* ── Error estructurado del motor ──────────────────────────── */

export interface WorkflowError {
  code: string;
  message: string;
  nodeId?: string;
  retryable: boolean;
  details?: Record<string, unknown>;
  stack?: string;
}
