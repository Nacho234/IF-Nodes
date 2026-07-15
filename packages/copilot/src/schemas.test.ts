import { describe, expect, it } from 'vitest';
import { BUILD_PROJECT_TOOL, parseChangeSet, parseProjectPlan, PROPOSE_CHANGES_TOOL } from './schemas';

describe('parseChangeSet', () => {
  it('acepta una propuesta válida de add_node y aplica defaults', () => {
    const result = parseChangeSet({
      summary: 'Agregar una condición',
      changes: [{ op: 'add_node', nodeType: 'logic.condition', name: 'Si es cliente' }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.changeSet.changes[0]!.sourcePort).toBe('main');
      expect(result.changeSet.changes[0]!.config).toEqual({});
    }
  });

  it('rechaza una propuesta sin cambios', () => {
    const result = parseChangeSet({ summary: 'vacío', changes: [] });
    expect(result.ok).toBe(false);
  });

  it('rechaza una operación desconocida', () => {
    const result = parseChangeSet({
      summary: 'x',
      changes: [{ op: 'delete_everything', nodeType: 'x', name: 'x' }],
    });
    expect(result.ok).toBe(false);
  });

  it('la definición de la herramienta es strict-safe en lo esencial', () => {
    expect(PROPOSE_CHANGES_TOOL.name).toBe('propose_changes');
    expect(PROPOSE_CHANGES_TOOL.input_schema.required).toContain('summary');
    expect(PROPOSE_CHANGES_TOOL.input_schema.required).toContain('changes');
  });
});

describe('parseProjectPlan (multi-flujo)', () => {
  it('acepta un plan con varios flujos + conocimiento', () => {
    const result = parseProjectPlan({
      summary: 'Bot de FePI',
      flows: [
        { name: 'Conversación', changes: [{ op: 'add_node', nodeType: 'trigger.whatsapp-message', name: 'Inicio' }] },
        { name: 'Campaña', changes: [{ op: 'add_node', nodeType: 'trigger.campaign-contact', name: 'Campaña' }] },
      ],
      knowledge: [{ title: 'Precios', content: 'La inscripción cuesta 5000.', tags: ['faq'] }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.flows).toHaveLength(2);
      expect(result.plan.knowledge).toHaveLength(1);
    }
  });

  it('rechaza un plan sin flujos', () => {
    expect(parseProjectPlan({ summary: 'x', flows: [] }).ok).toBe(false);
  });

  it('la herramienta build_project pide summary + flows', () => {
    expect(BUILD_PROJECT_TOOL.name).toBe('build_project');
    expect(BUILD_PROJECT_TOOL.input_schema.required).toContain('flows');
  });
});
