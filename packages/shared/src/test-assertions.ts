import { z } from 'zod';

/**
 * Assertions de casos de prueba. Se evalúan sobre el resultado de una
 * ejecución (estado, salida final, salidas por nodo, nodos visitados).
 * El evaluador es puro: lo usan la API (persistir resultado) y la UI.
 */

export const ASSERTION_KINDS = [
  'equals',
  'contains',
  'exists',
  'notExists',
  'type',
  'greaterThan',
  'lessThan',
  'nodeVisited',
  'nodeNotVisited',
  'finalStatus',
] as const;
export type AssertionKind = (typeof ASSERTION_KINDS)[number];

export const ASSERTION_KIND_LABELS: Record<AssertionKind, string> = {
  equals: 'Igual a',
  contains: 'Contiene',
  exists: 'Existe',
  notExists: 'No existe',
  type: 'Es de tipo',
  greaterThan: 'Mayor que',
  lessThan: 'Menor que',
  nodeVisited: 'Nodo visitado',
  nodeNotVisited: 'Nodo NO visitado',
  finalStatus: 'Estado final',
};

export const testAssertionSchema = z.object({
  id: z.string().min(1).max(64),
  kind: z.enum(ASSERTION_KINDS),
  /**
   * Path sobre el resultado, p.ej. "output.message" o "nodes.node_intent.output".
   * Raíces disponibles: output (salida final), nodes.<id>.output, variables, trigger.
   */
  path: z.string().max(500).optional().default(''),
  /** Valor esperado (comparaciones) o tipo/estado esperado según kind */
  expected: z.string().max(2000).optional().default(''),
  /** Id de nodo para nodeVisited / nodeNotVisited */
  nodeId: z.string().max(64).optional().default(''),
});
export type TestAssertion = z.infer<typeof testAssertionSchema>;

export const testAssertionsSchema = z.array(testAssertionSchema).max(50);

export const createTestCaseSchema = z.object({
  workflowId: z.string().min(1, 'Falta el flujo'),
  name: z.string().trim().min(1, 'El nombre es obligatorio').max(120),
  description: z.string().max(2000).optional().or(z.literal('')),
  /** JSON del input del disparador */
  inputJson: z
    .string()
    .max(20_000)
    .refine(
      (value) => {
        try {
          const parsed = JSON.parse(value);
          return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
        } catch {
          return false;
        }
      },
      { message: 'Debe ser un objeto JSON válido' },
    ),
  assertions: testAssertionsSchema.default([]),
});
export const updateTestCaseSchema = createTestCaseSchema.partial().extend({
  workflowId: z.string().min(1).optional(),
});
export type CreateTestCaseInput = z.infer<typeof createTestCaseSchema>;
export type UpdateTestCaseInput = z.infer<typeof updateTestCaseSchema>;

/* ── Evaluación ─────────────────────────────────────────────── */

export interface ExecutionSummaryForAssertions {
  status: string;
  finalOutput: unknown;
  nodeOutputs: Record<string, unknown>;
  visitedNodeIds: string[];
  variables?: Record<string, unknown>;
  trigger?: unknown;
}

export interface AssertionResult {
  assertion: TestAssertion;
  passed: boolean;
  /** Valor real encontrado (para mostrar en el diff), ya serializable */
  actual: unknown;
  message: string;
}

function getByPath(root: Record<string, unknown>, path: string): unknown {
  if (!path) return undefined;
  let current: unknown = root;
  for (const rawSegment of path.split('.')) {
    const segment = rawSegment.trim();
    if (segment === '' || segment === '__proto__' || segment === 'constructor' || segment === 'prototype') {
      return undefined;
    }
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function describe(value: unknown): string {
  if (value === undefined) return 'undefined';
  const json = JSON.stringify(value);
  return json.length > 120 ? `${json.slice(0, 120)}…` : json;
}

function typeOf(value: unknown): string {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}

function asComparable(value: string): string | number {
  const n = Number(value);
  return value.trim() !== '' && !Number.isNaN(n) ? n : value;
}

export function evaluateAssertions(
  assertions: TestAssertion[],
  execution: ExecutionSummaryForAssertions,
): AssertionResult[] {
  const root: Record<string, unknown> = {
    output: execution.finalOutput,
    nodes: Object.fromEntries(
      Object.entries(execution.nodeOutputs).map(([id, output]) => [id, { output }]),
    ),
    variables: execution.variables ?? {},
    trigger: execution.trigger,
  };

  return assertions.map((assertion) => {
    const value = getByPath(root, assertion.path);
    const valueText =
      value === null || value === undefined
        ? ''
        : typeof value === 'object'
          ? JSON.stringify(value)
          : String(value);

    switch (assertion.kind) {
      case 'finalStatus': {
        const passed = execution.status === assertion.expected;
        return {
          assertion,
          passed,
          actual: execution.status,
          message: passed
            ? `Estado final ${execution.status}`
            : `Se esperaba estado ${assertion.expected} y fue ${execution.status}`,
        };
      }
      case 'nodeVisited': {
        const passed = execution.visitedNodeIds.includes(assertion.nodeId);
        return {
          assertion,
          passed,
          actual: execution.visitedNodeIds,
          message: passed
            ? `El nodo ${assertion.nodeId} se ejecutó`
            : `El nodo ${assertion.nodeId} no se ejecutó (recorrido: ${execution.visitedNodeIds.join(' → ') || 'vacío'})`,
        };
      }
      case 'nodeNotVisited': {
        const passed = !execution.visitedNodeIds.includes(assertion.nodeId);
        return {
          assertion,
          passed,
          actual: execution.visitedNodeIds,
          message: passed
            ? `El nodo ${assertion.nodeId} no se ejecutó (correcto)`
            : `El nodo ${assertion.nodeId} se ejecutó y no debía`,
        };
      }
      case 'exists': {
        const passed = value !== undefined && value !== null && valueText !== '';
        return {
          assertion,
          passed,
          actual: value,
          message: passed ? `${assertion.path} existe` : `${assertion.path} no existe o está vacío`,
        };
      }
      case 'notExists': {
        const passed = value === undefined || value === null || valueText === '';
        return {
          assertion,
          passed,
          actual: value,
          message: passed
            ? `${assertion.path} no existe (correcto)`
            : `${assertion.path} existe con valor ${describe(value)}`,
        };
      }
      case 'type': {
        const passed = typeOf(value) === assertion.expected;
        return {
          assertion,
          passed,
          actual: typeOf(value),
          message: passed
            ? `${assertion.path} es ${assertion.expected}`
            : `${assertion.path} es ${typeOf(value)}, se esperaba ${assertion.expected}`,
        };
      }
      case 'equals': {
        const passed = String(asComparable(valueText)) === String(asComparable(assertion.expected));
        return {
          assertion,
          passed,
          actual: value,
          message: passed
            ? `${assertion.path} = ${describe(value)}`
            : `${assertion.path} es ${describe(value)}, se esperaba ${assertion.expected}`,
        };
      }
      case 'contains': {
        const passed = valueText.toLowerCase().includes(assertion.expected.toLowerCase());
        return {
          assertion,
          passed,
          actual: value,
          message: passed
            ? `${assertion.path} contiene «${assertion.expected}»`
            : `${assertion.path} (${describe(value)}) no contiene «${assertion.expected}»`,
        };
      }
      case 'greaterThan':
      case 'lessThan': {
        const actualNumber = Number(valueText);
        const expectedNumber = Number(assertion.expected);
        const comparable = !Number.isNaN(actualNumber) && !Number.isNaN(expectedNumber);
        const passed =
          comparable &&
          (assertion.kind === 'greaterThan' ? actualNumber > expectedNumber : actualNumber < expectedNumber);
        return {
          assertion,
          passed,
          actual: value,
          message: !comparable
            ? `${assertion.path} (${describe(value)}) no es numérico`
            : passed
              ? `${assertion.path} (${actualNumber}) ${assertion.kind === 'greaterThan' ? '>' : '<'} ${expectedNumber}`
              : `${assertion.path} es ${actualNumber}, no es ${assertion.kind === 'greaterThan' ? 'mayor' : 'menor'} que ${expectedNumber}`,
        };
      }
    }
  });
}
