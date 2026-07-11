import { z } from 'zod';
import { ENVIRONMENT_KINDS } from './domain';

/**
 * Catálogo de tipos de credencial. Define los campos que pide el formulario
 * y cuáles son secretos. El secreto viaja UNA vez al crear/editar; después
 * el frontend solo ve el hint enmascarado.
 */
export interface CredentialFieldDef {
  key: string;
  label: string;
  secret: boolean;
  placeholder?: string;
}

export interface CredentialTypeDef {
  slug: string;
  name: string;
  description: string;
  fields: CredentialFieldDef[];
  /** Si la API sabe probar la conexión de este tipo */
  verifiable: boolean;
}

export const CREDENTIAL_TYPES: CredentialTypeDef[] = [
  {
    slug: 'openai',
    name: 'OpenAI',
    description: 'API key para modelos GPT',
    fields: [{ key: 'apiKey', label: 'API Key', secret: true, placeholder: 'sk-…' }],
    verifiable: true,
  },
  {
    slug: 'anthropic',
    name: 'Anthropic',
    description: 'API key para modelos Claude',
    fields: [{ key: 'apiKey', label: 'API Key', secret: true, placeholder: 'sk-ant-…' }],
    verifiable: true,
  },
  {
    slug: 'gemini',
    name: 'Google Gemini',
    description: 'API key de Google AI Studio',
    fields: [{ key: 'apiKey', label: 'API Key', secret: true }],
    verifiable: false,
  },
  {
    slug: 'whatsapp-cloud',
    name: 'WhatsApp Cloud API',
    description: 'Token y número de la API oficial de Meta',
    fields: [
      { key: 'accessToken', label: 'Access Token', secret: true },
      { key: 'phoneNumberId', label: 'Phone Number ID', secret: false },
      { key: 'verifyToken', label: 'Verify Token (webhook)', secret: true },
    ],
    verifiable: true,
  },
  {
    slug: 'smtp',
    name: 'SMTP',
    description: 'Servidor de correo saliente',
    fields: [
      { key: 'host', label: 'Host', secret: false, placeholder: 'smtp.gmail.com' },
      { key: 'port', label: 'Puerto', secret: false, placeholder: '587' },
      { key: 'user', label: 'Usuario', secret: false },
      { key: 'password', label: 'Contraseña', secret: true },
    ],
    verifiable: false,
  },
  {
    slug: 'http-bearer',
    name: 'HTTP Bearer Token',
    description: 'Token para el header Authorization: Bearer',
    fields: [{ key: 'token', label: 'Token', secret: true }],
    verifiable: false,
  },
  {
    slug: 'api-key',
    name: 'API Key (header)',
    description: 'Clave enviada en un header custom',
    fields: [
      { key: 'headerName', label: 'Nombre del header', secret: false, placeholder: 'x-api-key' },
      { key: 'key', label: 'Valor', secret: true },
    ],
    verifiable: false,
  },
  {
    slug: 'postgres',
    name: 'PostgreSQL',
    description: 'Cadena de conexión a una base externa',
    fields: [
      { key: 'connectionString', label: 'Connection string', secret: true, placeholder: 'postgresql://…' },
    ],
    verifiable: false,
  },
  {
    slug: 'supabase',
    name: 'Supabase',
    description: 'URL del proyecto y service key',
    fields: [
      { key: 'url', label: 'Project URL', secret: false, placeholder: 'https://xyz.supabase.co' },
      { key: 'serviceKey', label: 'Service role key', secret: true },
    ],
    verifiable: false,
  },
];

export function credentialType(slug: string): CredentialTypeDef | undefined {
  return CREDENTIAL_TYPES.find((type) => type.slug === slug);
}

export const createCredentialSchema = z.object({
  name: z.string().trim().min(1, 'El nombre es obligatorio').max(120),
  integrationSlug: z
    .string()
    .refine((slug) => CREDENTIAL_TYPES.some((type) => type.slug === slug), 'Tipo de credencial desconocido'),
  environment: z.enum(ENVIRONMENT_KINDS).default('DEVELOPMENT'),
  projectId: z.string().optional().or(z.literal('')),
  /** Campos del tipo; los secretos se cifran al llegar y no vuelven */
  data: z.record(z.string(), z.string().max(5000)),
});
export type CreateCredentialInput = z.infer<typeof createCredentialSchema>;

export const updateCredentialSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  active: z.boolean().optional(),
  /** Si viene, reemplaza los datos completos (rotación) */
  data: z.record(z.string(), z.string().max(5000)).optional(),
});
export type UpdateCredentialInput = z.infer<typeof updateCredentialSchema>;
