import type { NodeDefinition } from './contract';
import { manualTriggerNode } from './nodes/trigger/manual-trigger';
import { webhookTriggerNode } from './nodes/trigger/webhook-trigger';
import { whatsappTriggerNode } from './nodes/trigger/whatsapp-trigger';
import { conditionNode } from './nodes/logic/condition';
import { switchNode } from './nodes/logic/switch';
import { setVariableNode } from './nodes/logic/set-variable';
import { transformNode } from './nodes/data/transform';
import { respondNode } from './nodes/communication/respond';
import { httpRequestNode } from './nodes/integrations/http-request';
import { aiGenerateNode } from './nodes/ai/generate';
import { aiClassifyNode } from './nodes/ai/classify';
import { whatsappSendTextNode } from './nodes/whatsapp/send-text';

/**
 * Registro central de nodos. Agregar un nodo nuevo = crear su archivo
 * en src/nodes/<categoria>/ y sumarlo a esta lista (ver NODE_DEVELOPMENT.md).
 * Ante un cambio incompatible se registra la versión nueva SIN quitar la vieja.
 */
// Los genéricos concretos de cada nodo se borran al registrarlos: el
// registro trabaja con la forma común NodeDefinition<unknown, unknown, unknown>.
const definitions = [
  manualTriggerNode,
  webhookTriggerNode,
  whatsappTriggerNode,
  conditionNode,
  switchNode,
  setVariableNode,
  transformNode,
  aiClassifyNode,
  aiGenerateNode,
  httpRequestNode,
  whatsappSendTextNode,
  respondNode,
] as unknown as NodeDefinition[];

const byTypeAndVersion = new Map<string, NodeDefinition>();
for (const def of definitions) {
  const key = `${def.type}@${def.version}`;
  if (byTypeAndVersion.has(key)) {
    throw new Error(`Definición de nodo duplicada: ${key}`);
  }
  byTypeAndVersion.set(key, def);
}

export const nodeRegistry = {
  /** Todas las definiciones en su versión más reciente */
  all(): NodeDefinition[] {
    const latest = new Map<string, NodeDefinition>();
    for (const def of byTypeAndVersion.values()) {
      const current = latest.get(def.type);
      if (!current || def.version > current.version) latest.set(def.type, def);
    }
    return [...latest.values()];
  },

  /** Definición exacta; sin versión devuelve la más reciente */
  get(type: string, version?: number): NodeDefinition | undefined {
    if (version !== undefined) return byTypeAndVersion.get(`${type}@${version}`);
    return this.all().find((d) => d.type === type);
  },

  /** Un disparador es todo nodo sin puertos de entrada (puede vivir en otra categoría, p.ej. whatsapp). */
  isTrigger(type: string): boolean {
    const definition = this.get(type);
    if (!definition) return false;
    return definition.category === 'trigger' || definition.inputs.length === 0;
  },
};
