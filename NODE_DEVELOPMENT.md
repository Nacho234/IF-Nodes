# IF Nodes — Desarrollo de nodos

Cómo agregar un tipo de nodo nuevo sin tocar el núcleo. Los nodos viven en `packages/node-definitions` y están **desacoplados** del editor visual y del motor: la UI consume metadatos, el motor consume `execute()`.

## El contrato

```typescript
// packages/node-definitions/src/contract.ts
interface NodeDefinition<TConfig = unknown, TInput = unknown, TOutput = unknown> {
  /** Identificador único y estable, con namespace: "trigger.manual", "logic.condition", "ai.generate" */
  type: string;
  /** Se incrementa ante cambios incompatibles de config/comportamiento; las versiones viejas se conservan */
  version: number;
  category: NodeCategory; // 'trigger' | 'logic' | 'data' | 'communication' | 'ai' | 'contacts' | 'whatsapp' | 'integrations'
  displayName: string;
  description: string;
  /** Nombre de icono Lucide (la web lo resuelve a componente; nunca emojis) */
  icon: string;

  configSchema: ZodType<TConfig>;
  /** Valores por defecto al soltar el nodo en el canvas */
  defaultConfig: TConfig;

  inputs: NodePortDefinition[];   // [] para triggers
  outputs: NodePortDefinition[];  // p.ej. condition → [{id:'true'},{id:'false'}]

  /** Tipos de credencial que requiere (Fase 7). El editor exige seleccionar una. */
  credentials?: CredentialRequirement[];
  /** Paths que este nodo aporta al contexto, para el autocompletado de variables */
  outputVariables?: OutputVariableHint[];

  /** Lógica de ejecución. Pura respecto del builder: solo usa el context inyectado. */
  execute(context: NodeExecutionContext<TConfig, TInput>): Promise<NodeExecutionResult<TOutput>>;

  /** Documentación breve mostrada en el panel derecho */
  documentation?: string;
  /** Si el nodo puede incluirse en un runtime exportado (los de simulación no) */
  exportable: boolean;
}
```

`NodeExecutionContext` entrega: `config` (ya validada y con expresiones resueltas), `input`, `logger`, `signal` (AbortSignal), `getCredential(id)` (Fase 7), `services` (inyección de providers: IA, WhatsApp, SMTP — nunca importados directo).

`NodeExecutionResult` es `{ output }` o `{ outputsByPort: Record<string, unknown> }` para nodos con múltiples salidas.

## Pasos para agregar un nodo

1. Crear `src/nodes/<categoria>/<nombre>.ts` exportando un `NodeDefinition` (usar `defineNode()` helper para inferencia de tipos).
2. Registrarlo en `src/registry.ts` (una línea en el array).
3. Listo. Con eso:
   - aparece en la biblioteca del constructor (categoría, buscador),
   - el panel derecho genera el formulario desde `configSchema` + `uiHints`,
   - el motor lo ejecuta,
   - el exportador lo incluye si `exportable: true` y el flujo lo usa.
4. Tests: un archivo `__tests__/<nombre>.test.ts` ejercitando `execute()` con configs válidas e inválidas.

**No hace falta tocar**: el editor, el motor, la API ni el exportador.

## Reglas

- La config debe ser serializable y **jamás** contener secretos (referenciar credenciales/entorno).
- `execute()` no puede acceder a red/DB directamente salvo a través de `context.services` — esto garantiza que el runtime exportado pueda inyectar implementaciones livianas y el simulador implementaciones simuladas.
- Cambio incompatible ⇒ nueva `version`, manteniendo la anterior en el registro (`nodeRegistry.get(type, version)`).
- Errores: lanzar `NodeExecutionError(code, message, { retryable, details })`; el motor lo envuelve en `WorkflowError`.
- Nada de `eval` ni ejecución de código arbitrario del usuario.

## Nodos existentes

| Tipo | Versión | Categoría | Exportable | Nota |
|---|---|---|---|---|
| `trigger.manual` | 1 | trigger | ✅ | payload de ejemplo configurable |
| `trigger.webhook` | 1 | trigger | ✅ | URL pública `POST /hooks/:token` |
| `trigger.whatsapp-message` | 1 | whatsapp | ✅ | alimentado por el Simulador (mismo formato que el proveedor real) |
| `logic.condition` | 1 | logic | ✅ | 8 operadores, salidas `true`/`false` |
| `logic.switch` | 1 | logic | ✅ | 3 casos + `default` |
| `logic.set-variable` | 1 | logic | ✅ | escribe en `{{variables.*}}` vía `result.variables` |
| `data.transform` | 1 | data | ✅ | asignaciones con paths anidados |
| `communication.respond` | 1 | communication | ✅ | respuesta final del flujo |

Nota: un nodo es **disparador** si no tiene puertos de entrada (`inputs: []`), sin importar su categoría visual (p.ej. el trigger de WhatsApp vive en la categoría `whatsapp`).

El resto del set del MVP (esperar, HTTP con SSRF, IA, contactos, envío real de WhatsApp…) se implementa en Fases 4–7 siguiendo este mismo proceso.
