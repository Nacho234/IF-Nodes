import type { ProjectType } from './domain';
import type { WorkflowGraph } from './workflow-graph';

export interface StarterTemplate {
  slug: string;
  name: string;
  description: string;
  category: string;
  projectType: ProjectType;
  /** Integraciones que conviene tener (credenciales) para aprovecharla */
  requiredIntegrations: string[];
  graph: WorkflowGraph;
}

const emptyExtras = { stickyNotes: [], groups: [] };

export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    slug: 'whatsapp-turnos',
    name: 'Bot de turnos por WhatsApp',
    description: 'Detecta si el cliente pide un turno y responde según el caso.',
    category: 'Atención',
    projectType: 'WHATSAPP_BOT',
    requiredIntegrations: ['whatsapp-cloud'],
    graph: {
      nodes: [
        {
          id: 'trigger',
          type: 'trigger.whatsapp-message',
          nodeVersion: 1,
          name: 'Mensaje de WhatsApp',
          position: { x: 0, y: 160 },
          config: { sampleText: 'Hola, quiero un turno', samplePhone: '5493410000000', sampleName: 'Cliente' },
          disabled: false,
          notes: '',
        },
        {
          id: 'intent',
          type: 'logic.condition',
          nodeVersion: 1,
          name: '¿Pide turno?',
          position: { x: 320, y: 160 },
          config: { left: '{{trigger.text}}', operator: 'contains', right: 'turno' },
          disabled: false,
          notes: '',
        },
        {
          id: 'turno',
          type: 'communication.respond',
          nodeVersion: 1,
          name: 'Respuesta turnos',
          position: { x: 640, y: 60 },
          config: { message: '¡Hola {{trigger.name}}! Decime qué día te queda cómodo y te reservo el turno.' },
          disabled: false,
          notes: '',
        },
        {
          id: 'general',
          type: 'communication.respond',
          nodeVersion: 1,
          name: 'Respuesta general',
          position: { x: 640, y: 280 },
          config: { message: 'Hola {{trigger.name}}, ¿en qué te puedo ayudar? Turnos, precios u otra consulta.' },
          disabled: false,
          notes: '',
        },
      ],
      edges: [
        { id: 'e1', source: 'trigger', sourcePort: 'main', target: 'intent', targetPort: 'main' },
        { id: 'e2', source: 'intent', sourcePort: 'true', target: 'turno', targetPort: 'main' },
        { id: 'e3', source: 'intent', sourcePort: 'false', target: 'general', targetPort: 'main' },
      ],
      ...emptyExtras,
    },
  },
  {
    slug: 'faq-ia',
    name: 'Bot de preguntas frecuentes con IA',
    description: 'Responde consultas usando un modelo de IA con el contexto del negocio.',
    category: 'Atención',
    projectType: 'WHATSAPP_BOT',
    requiredIntegrations: ['whatsapp-cloud', 'anthropic'],
    graph: {
      nodes: [
        {
          id: 'trigger',
          type: 'trigger.whatsapp-message',
          nodeVersion: 1,
          name: 'Mensaje de WhatsApp',
          position: { x: 0, y: 120 },
          config: { sampleText: '¿Cuánto sale el tratamiento?', samplePhone: '5493410000000', sampleName: 'Cliente' },
          disabled: false,
          notes: '',
        },
        {
          id: 'ai',
          type: 'ai.generate',
          nodeVersion: 1,
          name: 'Generar respuesta',
          position: { x: 320, y: 120 },
          config: {
            credentialId: '',
            model: '',
            system:
              'Sos el asistente de atención del negocio. Respondé claro y breve. Si no sabés algo, ofrecé derivar a una persona.',
            prompt: 'El cliente {{trigger.name}} preguntó: {{trigger.text}}',
            maxTokens: 300,
          },
          disabled: false,
          notes: '',
        },
        {
          id: 'respond',
          type: 'communication.respond',
          nodeVersion: 1,
          name: 'Responder',
          position: { x: 640, y: 120 },
          config: { message: '{{nodes.ai.output.text}}' },
          disabled: false,
          notes: '',
        },
      ],
      edges: [
        { id: 'e1', source: 'trigger', sourcePort: 'main', target: 'ai', targetPort: 'main' },
        { id: 'e2', source: 'ai', sourcePort: 'main', target: 'respond', targetPort: 'main' },
      ],
      ...emptyExtras,
    },
  },
  {
    slug: 'clasificar-derivar',
    name: 'Clasificación y derivación',
    description: 'Clasifica la intención del mensaje y ramifica según la categoría.',
    category: 'Atención',
    projectType: 'WHATSAPP_BOT',
    requiredIntegrations: ['whatsapp-cloud', 'anthropic'],
    graph: {
      nodes: [
        {
          id: 'trigger',
          type: 'trigger.whatsapp-message',
          nodeVersion: 1,
          name: 'Mensaje de WhatsApp',
          position: { x: 0, y: 200 },
          config: { sampleText: 'Quiero hablar con una persona', samplePhone: '5493410000000', sampleName: 'Cliente' },
          disabled: false,
          notes: '',
        },
        {
          id: 'classify',
          type: 'ai.classify',
          nodeVersion: 1,
          name: 'Clasificar intención',
          position: { x: 300, y: 200 },
          config: { credentialId: '', model: '', text: '{{trigger.text}}', categories: 'turno, precio, humano, otro' },
          disabled: false,
          notes: '',
        },
        {
          id: 'route',
          type: 'logic.switch',
          nodeVersion: 1,
          name: 'Según intención',
          position: { x: 600, y: 200 },
          config: { value: '{{nodes.classify.output.category}}', case1: 'turno', case2: 'humano', case3: 'precio' },
          disabled: false,
          notes: '',
        },
        {
          id: 'r_turno',
          type: 'communication.respond',
          nodeVersion: 1,
          name: 'Turno',
          position: { x: 900, y: 40 },
          config: { message: 'Perfecto, ¿qué día querés el turno?' },
          disabled: false,
          notes: '',
        },
        {
          id: 'r_humano',
          type: 'communication.respond',
          nodeVersion: 1,
          name: 'Derivar a humano',
          position: { x: 900, y: 160 },
          config: { message: 'Te derivo con una persona del equipo, aguardá un momento.' },
          disabled: false,
          notes: '',
        },
        {
          id: 'r_precio',
          type: 'communication.respond',
          nodeVersion: 1,
          name: 'Precio',
          position: { x: 900, y: 280 },
          config: { message: 'Te paso la lista de precios enseguida.' },
          disabled: false,
          notes: '',
        },
        {
          id: 'r_otro',
          type: 'communication.respond',
          nodeVersion: 1,
          name: 'Otro',
          position: { x: 900, y: 400 },
          config: { message: '¿Podés contarme un poco más para ayudarte mejor?' },
          disabled: false,
          notes: '',
        },
      ],
      edges: [
        { id: 'e1', source: 'trigger', sourcePort: 'main', target: 'classify', targetPort: 'main' },
        { id: 'e2', source: 'classify', sourcePort: 'main', target: 'route', targetPort: 'main' },
        { id: 'e3', source: 'route', sourcePort: 'case1', target: 'r_turno', targetPort: 'main' },
        { id: 'e4', source: 'route', sourcePort: 'case2', target: 'r_humano', targetPort: 'main' },
        { id: 'e5', source: 'route', sourcePort: 'case3', target: 'r_precio', targetPort: 'main' },
        { id: 'e6', source: 'route', sourcePort: 'default', target: 'r_otro', targetPort: 'main' },
      ],
      ...emptyExtras,
    },
  },
  {
    slug: 'webhook-ia',
    name: 'Webhook con IA',
    description: 'Recibe un webhook, procesa el texto con IA y responde.',
    category: 'Automatización',
    projectType: 'WEBHOOK_AUTOMATION',
    requiredIntegrations: ['anthropic'],
    graph: {
      nodes: [
        {
          id: 'trigger',
          type: 'trigger.webhook',
          nodeVersion: 1,
          name: 'Webhook recibido',
          position: { x: 0, y: 120 },
          config: { description: 'Recibe {{trigger.text}} de un sistema externo' },
          disabled: false,
          notes: '',
        },
        {
          id: 'ai',
          type: 'ai.generate',
          nodeVersion: 1,
          name: 'Procesar con IA',
          position: { x: 320, y: 120 },
          config: {
            credentialId: '',
            model: '',
            system: 'Resumí el texto recibido en una frase.',
            prompt: '{{trigger.text}}',
            maxTokens: 200,
          },
          disabled: false,
          notes: '',
        },
        {
          id: 'respond',
          type: 'communication.respond',
          nodeVersion: 1,
          name: 'Respuesta',
          position: { x: 640, y: 120 },
          config: { message: '{{nodes.ai.output.text}}' },
          disabled: false,
          notes: '',
        },
      ],
      edges: [
        { id: 'e1', source: 'trigger', sourcePort: 'main', target: 'ai', targetPort: 'main' },
        { id: 'e2', source: 'ai', sourcePort: 'main', target: 'respond', targetPort: 'main' },
      ],
      ...emptyExtras,
    },
  },
];

export function starterTemplate(slug: string): StarterTemplate | undefined {
  return STARTER_TEMPLATES.find((t) => t.slug === slug);
}
