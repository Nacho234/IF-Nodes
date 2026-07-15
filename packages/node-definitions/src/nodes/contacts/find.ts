import { z } from 'zod';
import { defineNode, NodeExecutionError } from '../../contract';

const configSchema = z.object({
  phone: z.string().max(200).optional().default('{{trigger.phone}}'),
  email: z.string().max(320).optional().default(''),
});

type Config = z.infer<typeof configSchema>;

/**
 * Busca un contacto por teléfono o email. Devuelve `found` (bool) y el contacto
 * si existe; ramificá después con una condición sobre {{nodes.<id>.output.found}}.
 */
export const contactFindNode = defineNode<Config, unknown, unknown>({
  type: 'contacts.find',
  version: 1,
  category: 'contacts',
  displayName: 'Buscar contacto',
  description: 'Busca un contacto por teléfono o email y dice si existe.',
  icon: 'user-search',
  configSchema,
  defaultConfig: { phone: '{{trigger.phone}}', email: '' },
  uiHints: [
    { field: 'phone', label: 'Teléfono', widget: 'text', supportsExpressions: true },
    { field: 'email', label: 'Email', widget: 'text', supportsExpressions: true },
  ],
  inputs: [{ id: 'main', label: 'Entrada' }],
  outputs: [{ id: 'main', label: 'Salida' }],
  outputVariables: [
    { path: 'output.found', description: 'true si el contacto existe' },
    { path: 'output.contact', description: 'El contacto (o null)' },
  ],
  exportable: true,
  async execute({ config, services }) {
    if (!services.contacts) {
      throw new NodeExecutionError('CONTACTS_SERVICE_UNAVAILABLE', 'El nodo de contactos solo se ejecuta en el worker/runtime.');
    }
    if (!config.phone && !config.email) {
      throw new NodeExecutionError('CONTACT_NO_IDENTITY', 'Definí teléfono o email para buscar.');
    }
    const contact = await services.contacts.find({
      phone: config.phone || undefined,
      email: config.email || undefined,
    });
    return { output: { found: Boolean(contact), contact } };
  },
});
