# IF Nodes — Motor de ejecución (especificación)

> Estado: **especificación**. El motor se implementa en Fase 3 en `packages/workflow-core`. Este documento es el contrato que esa implementación debe cumplir; se actualiza junto con el código.

## Modelo del flujo

Un flujo es un **grafo dirigido** serializado según `workflowGraphSchema` (`packages/shared/src/workflow-graph.ts`):

```jsonc
{
  "nodes": [
    {
      "id": "node_a1",
      "type": "trigger.manual",     // clave en el registro de nodos
      "nodeVersion": 1,              // versión de la definición usada
      "name": "Inicio manual",       // renombrable por el usuario
      "position": { "x": 0, "y": 0 },
      "config": { },                 // validado por el configSchema del nodo
      "disabled": false,
      "notes": ""
    }
  ],
  "edges": [
    { "id": "e1", "source": "node_a1", "sourcePort": "main", "target": "node_b2", "targetPort": "main" }
  ],
  "stickyNotes": [],
  "groups": []
}
```

- `nodeVersion` permite compatibilidad hacia atrás: el registro conserva versiones anteriores de un tipo de nodo mientras existan flujos que las usen.
- El grafo **nunca contiene secretos**: los nodos referencian credenciales por id y variables por `{{environment.X}}`.

## Responsabilidades del motor

1. **Validar** antes de ejecutar: exactamente un trigger alcanzable como raíz, aristas apuntando a nodos/puertos existentes, sin ciclos (salvo construcciones explícitas futuras tipo loop controlado), nodos desconectados = warning en editor / error al publicar.
2. **Resolver el orden**: recorrido desde el trigger siguiendo aristas; las ramas (`condition`, `switch`) activan solo el puerto de salida elegido; los nodos con `disabled: true` se saltean propagando la entrada.
3. **Contexto** serializable y predecible (sin funciones ni objetos vivos):

```typescript
interface WorkflowExecutionContext {
  executionId: string;
  projectId: string;
  workflowId: string;
  versionId: string;
  trigger: Record<string, unknown>;
  variables: Record<string, unknown>;
  nodeOutputs: Record<string, unknown>; // por id de nodo
  environment: Record<string, unknown>; // variables del entorno activo (secretos ya resueltos, nunca persistidos en steps)
  startedAt: string; // ISO
}
```

4. **Resolver expresiones** `{{ ... }}` con `expression-engine` (sin `eval`) sobre el contexto, antes de pasar la config al nodo.
5. **Persistir por paso** (vía callbacks inyectados, el motor no conoce Prisma): entrada, salida, duración, logs, error estructurado, intentos. Con redacción de secretos previa.
6. **Errores**: cada nodo declara estrategia (`stop` | `continue` | `retry` | `errorOutput` | `fallbackValue`) con reintentos, intervalo, backoff exponencial y timeout propios. El error siempre se materializa como:

```typescript
interface WorkflowError {
  code: string;          // p.ej. NODE_TIMEOUT, CONFIG_INVALID, HTTP_4XX
  message: string;       // sin secretos
  nodeId?: string;
  retryable: boolean;
  details?: Record<string, unknown>;
  stack?: string;        // solo visible para el equipo, nunca en exports
}
```

7. **Límites duros** (protección contra flujos desbocados): máximo de pasos por ejecución, duración máxima total, reintentos máximos. Configurables por env, con defaults seguros.
8. **Esperas** (`logic.wait`): el motor emite un estado `Waiting` con timestamp de reanudación; el scheduler (BullMQ delayed job en el builder / timer en el runtime) reanuda desde el nodo siguiente con el contexto persistido. Nunca `sleep` bloqueante.
9. **Cancelación**: señal cooperativa chequeada entre pasos y pasada a los executors vía `AbortSignal`.
10. **Ejecución parcial** (debugging): ejecutar un solo nodo o desde un nodo, sembrando `nodeOutputs` con datos de una ejecución previa o simulados.
11. **Eventos en tiempo real**: `execution.started`, `node.started`, `node.succeeded`, `node.failed`, `node.skipped`, `execution.finished` — emitidos por callback; el builder los transporta por Redis→SSE, el runtime los loguea.

## Estados

Ejecución: `QUEUED → RUNNING → (WAITING ⇄ RUNNING) → SUCCEEDED | FAILED | CANCELLED | TIMED_OUT`

Paso: `PENDING → RUNNING → SUCCEEDED | FAILED | SKIPPED | WAITING | CANCELLED`

## Dónde corre

- **Builder**: siempre en `apps/worker` vía BullMQ. La API solo valida, crea `Execution(QUEUED)` y encola. Nunca dentro del request HTTP.
- **Runtime exportado**: el mismo `workflow-core` embebido, invocado por los endpoints del runtime (webhooks/cron), con persistencia opcional según configuración de exportación.

## Testing del motor (Fase 3, Vitest)

Flujo lineal · condición true/false · switch · error con cada estrategia · reintento con backoff · timeout · espera y reanudación · cancelación · ciclo inválido rechazado · nodo desconectado · resolución de variables · contexto inmutable entre pasos · límite de pasos alcanzado.
