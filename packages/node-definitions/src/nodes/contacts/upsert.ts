import { z } from 'zod';
import { defineNode, NodeExecutionError } from '../../contract';

const configSchema = z.object({
  phone: z.string().max(200).optional().default('{{trigger.phone}}'),
  email: z.string().max(320).optional().default(''),
  name: z.string().max(200).optional().default('{{trigger.name}}'),
  /** Etapa del pipeline (solo se cambia si va con valor). */
  status: z.string().max(60).optional().default(''),
  /** Etiquetas separadas por coma (solo se agregan si van con valor). */
  tags: z.string().max(500).optional().default(''),
  notes: z.string().max(5000).optional().default(''),
  /** Marca "contactado ahora" (para seguimientos por tiempo). */
  markContacted: z.coerce.boolean().default(false),
});

type Config = z.infer<typeof configSchema>;

/**
 * Crea o actualiza un contacto (identificado por teléfono o email dentro del
 * proyecto). Base del CRM: guardar quién es, en qué etapa está y sus etiquetas.
 */
export const contactUpsertNode = defineNode<Config, unknown, unknown>({
  type: 'contacts.upsert',
  version: 1,
  category: 'contacts',
  displayName: 'Crear/actualizar contacto',
  description: 'Guarda o actualiza un contacto (por teléfono o email) con su estado y etiquetas.',
  icon: 'user-plus',
  configSchema,
  defaultConfig: {
    phone: '{{trigger.phone}}',
    email: '',
    name: '{{trigger.name}}',
    status: '',
    tags: '',
    notes: '',
    markContacted: false,
  },
  uiHints: [
    { field: 'phone', label: 'Teléfono', widget: 'text', supportsExpressions: true },
    { field: 'email', label: 'Email', widget: 'text', supportsExpressions: true },
    { field: 'name', label: 'Nombre', widget: 'text', supportsExpressions: true },
    { field: 'status', label: 'Estado / etapa', widget: 'text', supportsExpressions: true, placeholder: 'new / contacted / replied / meeting / closed' },
    { field: 'tags', label: 'Etiquetas', widget: 'text', supportsExpressions: true, helpText: 'Separadas por coma.' },
    { field: 'notes', label: 'Notas', widget: 'textarea', supportsExpressions: true },
    { field: 'markContacted', label: 'Marcar como contactado ahora', widget: 'switch' },
  ],
  inputs: [{ id: 'main', label: 'Entrada' }],
  outputs: [{ id: 'main', label: 'Salida' }],
  outputVariables: [
    { path: 'output.contact.id', description: 'Id del contacto' },
    { path: 'output.contact.status', description: 'Estado del contacto' },
  ],
  exportable: true,
  async execute({ config, services }) {
    if (!services.contacts) {
      throw new NodeExecutionError('CONTACTS_SERVICE_UNAVAILABLE', 'El nodo de contactos solo se ejecuta en el worker/runtime.');
    }
    if (!config.phone && !config.email) {
      throw new NodeExecutionError('CONTACT_NO_IDENTITY', 'Definí teléfono o email para identificar el contacto.');
    }
    const tags = config.tags
      ? config.tags.split(',').map((t) => t.trim()).filter(Boolean)
      : undefined;
    const contact = await services.contacts.upsert({
      phone: config.phone || undefined,
      email: config.email || undefined,
      name: config.name || undefined,
      status: config.status || undefined,
      tags,
      notes: config.notes || undefined,
      markContacted: config.markContacted || undefined,
    });
    return { output: { contact } };
  },
});
