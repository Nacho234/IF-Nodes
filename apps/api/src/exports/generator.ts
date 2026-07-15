import { credentialType, type WorkflowGraph } from '@ifnodes/shared';

/** Credencial referida por el flujo, con sus datos ya descifrados (para mapear a env). */
export interface ResolvedCredential {
  id: string;
  slug: string;
  data: Record<string, string>;
}

export interface CredentialManifestEntry {
  slug: string;
  fields: Record<string, { env?: string; value?: string }>;
}
export type CredentialManifest = Record<string, CredentialManifestEntry>;

export interface ExportPlan {
  slug: string;
  manifest: {
    project: string;
    runtimeVersion: string;
    workflowVersion: string;
    entrypoints: string[];
    requiredEnvironmentVariables: string[];
    healthEndpoint: string;
  };
  credentialManifest: CredentialManifest;
  /** Env vars requeridas con una descripción para el .env.example */
  envVars: { name: string; hint: string }[];
  usedNodeTypes: string[];
}

const RUNTIME_VERSION = '1.0.0';

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'bot'
  );
}

function envName(slug: string, field: string, taken: Set<string>): string {
  // camelCase → SNAKE_CASE (apiKey → API_KEY, phoneNumberId → PHONE_NUMBER_ID)
  const snake = field.replace(/([a-z0-9])([A-Z])/g, '$1_$2');
  const base = `${slug}_${snake}`.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  let name = base;
  let i = 2;
  while (taken.has(name)) name = `${base}_${i++}`;
  taken.add(name);
  return name;
}

/** Recolecta referencias {{environment.X}} en cualquier string del grafo. */
function scanEnvironmentRefs(graph: WorkflowGraph): string[] {
  const found = new Set<string>();
  const re = /\{\{\s*environment\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;
  const json = JSON.stringify(graph);
  for (const match of json.matchAll(re)) found.add(match[1] as string);
  return [...found];
}

/**
 * Construye el plan de exportación: manifest, mapa de credenciales (env, sin
 * secretos) y variables de entorno requeridas. `resolved` trae las credenciales
 * referidas por el grafo ya descifradas.
 */
export function buildExportPlan(
  projectName: string,
  workflowNumber: number,
  graph: WorkflowGraph,
  resolved: ResolvedCredential[],
): ExportPlan {
  const taken = new Set<string>();
  const credentialManifest: CredentialManifest = {};
  const envVars: { name: string; hint: string }[] = [];
  const resolvedById = new Map(resolved.map((c) => [c.id, c]));

  // Solo credenciales realmente referidas por el grafo
  const referenced = new Set<string>();
  for (const node of graph.nodes) {
    const credId = node.config['credentialId'];
    if (typeof credId === 'string' && credId) referenced.add(credId);
  }

  for (const credId of referenced) {
    const cred = resolvedById.get(credId);
    if (!cred) continue;
    const type = credentialType(cred.slug);
    const fields: CredentialManifestEntry['fields'] = {};
    for (const fieldDef of type?.fields ?? []) {
      const value = cred.data[fieldDef.key] ?? '';
      if (fieldDef.secret) {
        const name = envName(cred.slug, fieldDef.key, taken);
        fields[fieldDef.key] = { env: name };
        envVars.push({ name, hint: `${type?.name ?? cred.slug} · ${fieldDef.label}` });
      } else {
        fields[fieldDef.key] = { value };
      }
    }
    credentialManifest[credId] = { slug: cred.slug, fields };
  }

  // Variables {{environment.X}}
  for (const ref of scanEnvironmentRefs(graph)) {
    if (!taken.has(ref)) {
      taken.add(ref);
      envVars.push({ name: ref, hint: 'Variable de entorno del flujo' });
    }
  }

  // WhatsApp: token de verificación del webhook
  const hasWhatsApp = graph.nodes.some((n) => !n.disabled && n.type === 'trigger.whatsapp-message');
  const entrypoints: string[] = [];
  if (hasWhatsApp) {
    entrypoints.push('whatsapp-webhook');
    if (!taken.has('WHATSAPP_VERIFY_TOKEN')) {
      taken.add('WHATSAPP_VERIFY_TOKEN');
      envVars.push({ name: 'WHATSAPP_VERIFY_TOKEN', hint: 'Token de verificación del webhook de WhatsApp' });
    }
  }
  if (graph.nodes.some((n) => !n.disabled && n.type === 'trigger.webhook')) entrypoints.push('webhook');
  if (entrypoints.length === 0) entrypoints.push('manual');

  const usedNodeTypes = [...new Set(graph.nodes.filter((n) => !n.disabled).map((n) => n.type))];

  return {
    slug: slugify(projectName),
    manifest: {
      project: projectName,
      runtimeVersion: RUNTIME_VERSION,
      workflowVersion: String(workflowNumber),
      entrypoints,
      requiredEnvironmentVariables: envVars.map((v) => v.name),
      healthEndpoint: '/health',
    },
    credentialManifest,
    envVars,
    usedNodeTypes,
  };
}

/* ── Archivos de texto del proyecto exportado ───────────────── */

export function packageJson(plan: ExportPlan): string {
  return JSON.stringify(
    {
      name: plan.slug,
      version: '1.0.0',
      private: true,
      description: `Runtime de "${plan.manifest.project}" generado por IF Nodes`,
      main: 'dist/main.js',
      scripts: { start: 'node dist/main.js' },
      engines: { node: '>=20' },
    },
    null,
    2,
  );
}

export function dockerfile(): string {
  return `# Runtime de IF Nodes — imagen slim, autocontenida
FROM node:20-slim
WORKDIR /app

# El runtime está pre-empaquetado (dist/main.js), sin dependencias que instalar
COPY dist ./dist
COPY workflow ./workflow
COPY package.json ./

ENV NODE_ENV=production
# Railway inyecta PORT; fallback 3000
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \\
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]
`;
}

export function railwayJson(): string {
  return JSON.stringify(
    {
      $schema: 'https://railway.app/railway.schema.json',
      build: { builder: 'DOCKERFILE', dockerfilePath: 'Dockerfile' },
      deploy: {
        healthcheckPath: '/health/ready',
        healthcheckTimeout: 30,
        restartPolicyType: 'ON_FAILURE',
        restartPolicyMaxRetries: 3,
      },
    },
    null,
    2,
  );
}

export function envExample(plan: ExportPlan): string {
  const lines = [
    '# Variables de entorno del runtime — completar con valores reales.',
    '# Generado por IF Nodes. NUNCA commitear el .env con valores.',
    '',
    '# Puerto (Railway lo inyecta automáticamente)',
    '# PORT=3000',
    '',
    '# Política del nodo HTTP: block-private (default) o allowlist',
    '# HTTP_NODE_POLICY=block-private',
    '# HTTP_NODE_ALLOWED_HOSTS=',
    '',
    '# ── Persistencia (opcional) ──',
    '# Sin DATABASE_URL: memoria y contactos viven en el proceso (se pierden al reiniciar).',
    '# Con una URL de Postgres/Supabase: memoria y contactos PERSISTEN (producción).',
    '# El runtime crea sus tablas (ifn_*) solo al arrancar.',
    '# DATABASE_URL=postgresql://user:pass@host:5432/dbname',
    '#',
    '# Supabase: usá la conexión DIRECTA (Database → Connection string → URI, puerto 5432),',
    '# NO el pooler de transacciones (6543). El SSL se activa solo para hosts remotos;',
    '# forzalo con RUNTIME_DB_SSL=true|false si hace falta.',
    '# RUNTIME_DB_SSL=true',
    '',
  ];
  if (plan.envVars.length > 0) {
    lines.push('# ── Requeridas por este flujo ──');
    for (const v of plan.envVars) lines.push(`${v.name}=          # ${v.hint}`);
  } else {
    lines.push('# Este flujo no requiere variables de entorno adicionales.');
  }
  return lines.join('\n') + '\n';
}

export function gitignore(): string {
  return [
    'node_modules/',
    '.env',
    '.env.*',
    '*.log',
    '.DS_Store',
    '# Datos personales de los contactos: no versionar.',
    'workflow/contacts.json',
    '',
  ].join('\n');
}

export function readme(plan: ExportPlan, flows?: { name: string; slug: string }[]): string {
  const envList =
    plan.envVars.length > 0
      ? plan.envVars.map((v) => `- \`${v.name}\` — ${v.hint}`).join('\n')
      : '_Ninguna._';
  const entry =
    plan.manifest.entrypoints.includes('whatsapp-webhook')
      ? 'POST `/webhooks/whatsapp` (y verificación GET con `WHATSAPP_VERIFY_TOKEN`)'
      : plan.manifest.entrypoints.includes('webhook')
        ? 'POST `/webhooks/<lo-que-sea>` con el cuerpo JSON'
        : 'POST `/run` con el cuerpo JSON como entrada del disparador';
  const isProject = Boolean(flows && flows.length > 0);
  const source = isProject ? 'workflow/flows.json (todos los flujos del proyecto)' : 'workflow/workflow.json';
  const flowsSection = isProject
    ? `
## Flujos incluidos

${flows!.map((f) => `- **${f.name}** (\`${f.slug}\`)`).join('\n')}

El runtime **orquesta el proyecto completo**: rutea la entrada al flujo inbound, expone
las campañas por contacto y corre los flujos programados por cron.
`
    : '';
  const campaignSlug = flows?.[0]?.slug;
  return `# ${plan.manifest.project}

Runtime independiente generado por **IF Nodes**.
Interpreta \`${source}\` con un motor genérico. No incluye el editor ni datos internos.
${flowsSection}
## Requisitos

- Node.js 20+ (o Docker)

## Variables de entorno

${envList}

Copiá \`.env.example\` a \`.env\` y completá los valores. Definí \`DATABASE_URL\` (Postgres/Supabase)
para que la memoria de conversación y los contactos **persistan** en tu propia base.

## Correr localmente

\`\`\`bash
cp .env.example .env      # completar valores
node dist/main.js         # el runtime ya está empaquetado, sin npm install
\`\`\`

El servicio escucha en \`process.env.PORT\` (o 3000).

## Endpoints

- \`GET /health\`, \`GET /health/live\`, \`GET /health/ready\`
- \`GET /flows\` — lista los flujos y sus disparadores
- Entrada del bot: ${entry}
- \`POST /run\` — ejecuta el flujo inbound (o \`?flow=<slug>\` para uno específico)
- \`POST /campaigns/run\` — lanza una campaña por contacto (fan-out)

Ejemplo — mensaje entrante:

\`\`\`bash
curl -X POST http://localhost:3000/run -H 'content-type: application/json' \\
  -d '{"text":"hola"}'
\`\`\`

Ejemplo — lanzar una campaña (filtra contactos por estado/tag; \`dryRun\` solo cuenta):

\`\`\`bash
curl -X POST http://localhost:3000/campaigns/run -H 'content-type: application/json' \\
  -d '{${campaignSlug ? `"flow":"${campaignSlug}",` : ''}"status":"new","hasPhone":true,"staggerMs":1000,"dryRun":true}'
\`\`\`

Los flujos con disparador **Programado (cron)** se ejecutan solos según su cadencia
(no requieren llamada externa; el scheduler va incluido en el runtime).

## Docker

\`\`\`bash
docker build -t ${plan.slug} .
docker run -p 3000:3000 --env-file .env ${plan.slug}
\`\`\`

## Desplegar en Railway

1. Subí este proyecto a un repositorio Git.
2. En Railway: New Project → Deploy from GitHub → elegí el repo.
3. Cargá las variables de entorno de arriba.
4. Railway detecta el \`Dockerfile\` y \`railway.json\` (healthcheck en \`/health/ready\`).

## GitHub

\`\`\`bash
git init
git add .
git commit -m "Initial bot deployment"
git remote add origin REPOSITORY_URL
git push -u origin main
\`\`\`
`;
}
