import type { WorkflowGraph } from '@ifnodes/shared';

/**
 * Chequeo de referencias en expresiones {{...}}: detecta atajos inexistentes
 * (p.ej. {{category}}, {{generate.text}}) y referencias a nodos que no están en
 * el flujo ({{nodes.<id>...}} con id que no existe). Complementa la validación
 * de config. Es la causa más común de flujos que "se ven bien pero no andan".
 */

export interface ExpressionIssue {
  nodeId: string;
  nodeName: string;
  field: string;
  message: string;
}

const VALID_ROOTS = new Set(['trigger', 'nodes', 'variables', 'environment', 'input']);
const FUNCTIONS = new Set([
  'uppercase',
  'lowercase',
  'trim',
  'default',
  'contains',
  'length',
  'number',
  'string',
  'json',
  'formatDate',
  'addDays',
  'subtractDays',
]);

const EXPR = /\{\{\s*([^}]+?)\s*\}\}/g;

/** Primer identificador de la expresión (antes de un ., ( o espacio). */
function leadingToken(expr: string): string {
  const match = expr.match(/^([A-Za-z_][A-Za-z0-9_]*)/);
  return match ? match[1]! : '';
}

/** Si la expresión referencia nodes.<id>, devuelve ese id (o null). */
function referencedNodeId(expr: string): string | null {
  const match = expr.match(/nodes\.([A-Za-z0-9_-]+)/);
  return match ? match[1]! : null;
}

export function findExpressionIssues(graph: WorkflowGraph): ExpressionIssue[] {
  const issues: ExpressionIssue[] = [];
  const nodeIds = new Set(graph.nodes.map((n) => n.id));

  for (const node of graph.nodes) {
    if (node.disabled) continue;
    for (const [field, value] of Object.entries(node.config ?? {})) {
      const text = typeof value === 'string' ? value : JSON.stringify(value);
      if (!text || !text.includes('{{')) continue;

      for (const match of text.matchAll(EXPR)) {
        const inner = (match[1] ?? '').trim();
        const token = leadingToken(inner);
        if (!token) continue;

        // Llamada a función: se permite (los args pueden tener sus propias refs)
        if (FUNCTIONS.has(token)) {
          const refId = referencedNodeId(inner);
          if (refId && !nodeIds.has(refId)) {
            issues.push({
              nodeId: node.id,
              nodeName: node.name,
              field,
              message: `Referencia a un nodo inexistente: {{…nodes.${refId}…}}. Usá el id de un nodo del flujo.`,
            });
          }
          continue;
        }

        if (!VALID_ROOTS.has(token)) {
          issues.push({
            nodeId: node.id,
            nodeName: node.name,
            field,
            message: `Referencia desconocida {{${inner}}}. Usá {{nodes.<id>.output.<campo>}}, {{trigger.x}}, {{variables.x}} o {{environment.X}}.`,
          });
          continue;
        }

        if (token === 'nodes') {
          const refId = referencedNodeId(inner);
          if (refId && !nodeIds.has(refId)) {
            issues.push({
              nodeId: node.id,
              nodeName: node.name,
              field,
              message: `Referencia a un nodo inexistente: {{${inner}}}. Ese id no está en el flujo.`,
            });
          }
        }
      }
    }
  }
  return issues;
}
