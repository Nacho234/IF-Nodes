import { describe, expect, it } from 'vitest';
import { STARTER_TEMPLATES } from './templates';
import { validateGraphStructure, workflowGraphSchema } from './workflow-graph';

// Disparadores del set real (sin importar node-definitions: por prefijo de tipo)
const TRIGGER_TYPES = new Set(['trigger.manual', 'trigger.webhook', 'trigger.whatsapp-message']);
const isTrigger = (type: string) => TRIGGER_TYPES.has(type);

describe('STARTER_TEMPLATES', () => {
  it('todas tienen slug único', () => {
    const slugs = STARTER_TEMPLATES.map((t) => t.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  for (const template of STARTER_TEMPLATES) {
    describe(template.slug, () => {
      it('el grafo cumple el esquema', () => {
        expect(workflowGraphSchema.safeParse(template.graph).success).toBe(true);
      });

      it('no tiene errores estructurales (trigger, conexiones, sin ciclos)', () => {
        const graph = workflowGraphSchema.parse(template.graph);
        const errors = validateGraphStructure(graph, isTrigger).filter((i) => i.level === 'error');
        expect(errors).toEqual([]);
      });

      it('tiene exactamente un disparador', () => {
        const triggers = template.graph.nodes.filter((n) => isTrigger(n.type));
        expect(triggers).toHaveLength(1);
      });
    });
  }
});
