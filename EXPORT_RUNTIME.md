# IF Nodes — Exportación y runtime de producción (especificación)

> Estado: **especificación** (se implementa en Fase 9 sobre `packages/runtime-template`). Contrato de diseño; se actualiza junto al código.

## Principio

No se genera código distinto por bot. Se exporta un **runtime genérico** que interpreta `workflow/workflow.json` con el mismo `workflow-core` y las mismas definiciones de nodos que usa el builder. Lo que se probó en el simulador es lo que corre en producción.

## Estructura del proyecto exportado

```text
<slug-proyecto>/
├── src/
│   ├── main.ts            # arranque: carga workflow, valida, levanta HTTP
│   ├── runtime/           # bootstrap del motor + scheduler de esperas
│   ├── nodes/             # SOLO las definiciones usadas por el flujo
│   ├── integrations/      # SOLO los providers usados (whatsapp, smtp, ai…)
│   ├── webhooks/          # rutas de entrada
│   ├── health/            # /health, /health/live, /health/ready
│   └── config/            # lectura y validación de env (Zod)
├── workflow/
│   ├── manifest.json
│   ├── workflow.json      # grafo de la versión estable elegida, sin secretos
│   └── subflows/
├── Dockerfile             # multi-stage, imagen final slim
├── railway.json           # healthcheck + start command
├── package.json           # SOLO dependencias necesarias
├── tsconfig.json
├── .env.example           # todas las variables requeridas, sin valores reales
├── README.md              # despliegue: local, Docker, Railway, GitHub
└── .gitignore
```

### `manifest.json`

```json
{
  "project": "Dermafisherton WhatsApp Bot",
  "runtimeVersion": "1.0.0",
  "workflowVersion": "8",
  "entrypoints": ["whatsapp-webhook"],
  "requiredEnvironmentVariables": ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_VERIFY_TOKEN"],
  "requiredServices": [],
  "healthEndpoint": "/health"
}
```

`requiredEnvironmentVariables` se deriva automáticamente de los `{{environment.X}}` referenciados por el grafo + los requisitos de las integraciones incluidas. El runtime valida al arrancar que todas existan y **falla rápido** con mensaje claro si falta alguna.

## Endpoints del runtime

```text
GET  /health          → estado general + versión del workflow
GET  /health/live     → liveness
GET  /health/ready    → readiness (workflow cargado y válido; DB si aplica)
POST /webhooks/:webhookId
GET  /webhooks/whatsapp   → verificación (hub.challenge)
POST /webhooks/whatsapp   → eventos entrantes (firma validada, dedupe por message id)
```

Escucha en `process.env.PORT` (Railway) con fallback 3000.

## Reglas del exportador

1. Parte de una **versión estable** elegida (snapshot inmutable), nunca del borrador.
2. Incluye solo nodos/integraciones/dependencias que el grafo usa (tree-shaking por manifest de dependencias declarado en cada `NodeDefinition`).
3. `workflow.json` no contiene secretos ni datos del equipo (casos de prueba, notas internas, ejecuciones). Un chequeo automático de exportación lo verifica (búsqueda de patrones de secretos + validación de schema).
4. Nodos no exportables (`exportable: false`, p.ej. de simulación) bloquean la exportación con error claro que apunta al nodo.
5. Nombres de archivo sanitizados (slug seguro del nombre del proyecto).
6. Persistencia opcional: `none` (default) | `postgres` | `supabase` | `external-api`. Prisma solo se incluye si se eligió una opción con DB.
7. Reproducible: exportar dos veces la misma versión produce el mismo resultado (salvo timestamps del README).

## Formatos de exportación (MVP Fase 9)

1. **ZIP descargable** desde la UI.
2. **Carpeta local** (`output/` configurable) para trabajar con Claude Code directamente.
3. **Instrucciones Git** en el README generado (`git init … git push`).
4. **Railway**: Dockerfile multi-stage + `railway.json` con healthcheck. El deploy inicial es manual; queda preparada la interfaz para automatizar después:

```typescript
interface DeploymentProvider {
  validateConfig(): Promise<ValidationResult>;
  deploy(input: DeploymentInput): Promise<DeploymentResult>;
  getStatus(deploymentId: string): Promise<DeploymentStatus>;
  getLogs(deploymentId: string): Promise<DeploymentLog[]>;
}
```

No acoplado a Railway: `RailwayProvider` será la primera implementación.

## Lo que el runtime NO incluye

Constructor visual, dashboard, editor, gestión de clientes, casos de prueba, credenciales de desarrollo, dependencias del builder (Next, React, Nest, Prisma si no hay DB), datos de prueba.
