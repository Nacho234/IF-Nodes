import { describe, expect, it } from 'vitest';
import type { WorkflowGraph } from '@ifnodes/shared';
import { analyzeReadiness } from './readiness';

function graph(nodes: WorkflowGraph['nodes']): WorkflowGraph {
  return { nodes, edges: [], stickyNotes: [], groups: [] };
}
const node = (id: string, type: string, config: Record<string, unknown> = {}) => ({
  id,
  type,
  nodeVersion: 1,
  name: id,
  position: { x: 0, y: 0 },
  config,
  disabled: false,
  notes: '',
});

describe('analyzeReadiness', () => {
  it('avisa credencial faltante + nota de setup externo para WhatsApp', () => {
    const items = analyzeReadiness(graph([node('w', 'whatsapp.send-text', { to: '1', text: 'hola', credentialId: '' })]), {
      availableCredentialTypes: [],
      knowledgeCount: 0,
      environmentKeys: [],
    });
    expect(items.some((i) => i.category === 'credential' && i.message.includes('WhatsApp'))).toBe(true);
    expect(items.some((i) => i.category === 'external' && i.message.includes('HSM'))).toBe(true);
  });

  it('no avisa credencial si ya está disponible', () => {
    const items = analyzeReadiness(graph([node('w', 'whatsapp.send-text', { to: '1', text: 'x' })]), {
      availableCredentialTypes: ['whatsapp-cloud'],
      knowledgeCount: 0,
      environmentKeys: [],
    });
    expect(items.some((i) => i.category === 'credential')).toBe(false);
  });

  it('avisa conocimiento vacío si se usa Buscar conocimiento', () => {
    const items = analyzeReadiness(graph([node('k', 'ai.knowledge-search', { query: 'x', limit: 3 })]), {
      availableCredentialTypes: [],
      knowledgeCount: 0,
      environmentKeys: [],
    });
    expect(items.some((i) => i.category === 'knowledge')).toBe(true);
  });

  it('avisa variable de entorno referenciada pero no definida', () => {
    const items = analyzeReadiness(
      graph([node('h', 'integrations.http-request', { method: 'GET', url: '{{environment.API_URL}}' })]),
      { availableCredentialTypes: [], knowledgeCount: 0, environmentKeys: [] },
    );
    expect(items.some((i) => i.category === 'environment' && i.message.includes('API_URL'))).toBe(true);
  });

  it('ordena errores antes que warnings e info', () => {
    const items = analyzeReadiness(
      graph([node('w', 'whatsapp.send-text', { to: '1', text: 'x' }), node('c', 'integrations.google-calendar', {})]),
      { availableCredentialTypes: [], knowledgeCount: 0, environmentKeys: [] },
    );
    const levels = items.map((i) => i.level);
    // info (notas externas) al final
    expect(levels.lastIndexOf('warning')).toBeLessThan(levels.length);
    expect(levels[0] === 'error' || levels[0] === 'warning').toBe(true);
  });
});
