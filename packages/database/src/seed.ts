/**
 * Seed de desarrollo. Ejecutar con la DB levantada:
 *   npm run db:seed
 * Crea: usuario owner, cliente demo, proyecto demo con flujo principal
 * (Inicio manual → Transformar datos → Respuesta) y entornos.
 * Idempotente: se puede correr varias veces.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Flujo demo del brief:
 * Mensaje de WhatsApp → Establecer variable (empresa) → ¿Pide turno?
 *   Sí → Respuesta de turnos · No → Respuesta general
 * Probar con el Simulador: "Hola, quiero un turno" / "¿Cuánto sale?" / "asdfgh"
 */
const DEMO_GRAPH = {
  nodes: [
    {
      id: 'node_wa_in',
      type: 'trigger.whatsapp-message',
      nodeVersion: 1,
      name: 'Mensaje de WhatsApp',
      position: { x: 0, y: 160 },
      config: {
        sampleText: 'Hola, quiero un turno',
        samplePhone: '5493410000000',
        sampleName: 'Cliente de prueba',
      },
      disabled: false,
      notes: '',
    },
    {
      id: 'node_vars',
      type: 'logic.set-variable',
      nodeVersion: 1,
      name: 'Datos del negocio',
      position: { x: 300, y: 160 },
      config: { assignments: [{ key: 'empresa', value: 'Dermafisherton' }] },
      disabled: false,
      notes: '',
    },
    {
      id: 'node_intent',
      type: 'logic.condition',
      nodeVersion: 1,
      name: '¿Pide turno?',
      position: { x: 600, y: 160 },
      config: { left: '{{trigger.text}}', operator: 'contains', right: 'turno' },
      disabled: false,
      notes: '',
    },
    {
      id: 'node_resp_turno',
      type: 'communication.respond',
      nodeVersion: 1,
      name: 'Respuesta turnos',
      position: { x: 920, y: 40 },
      config: {
        message:
          '¡Hola {{trigger.name}}! 😊 Para reservar tu turno en {{variables.empresa}} decime qué día te queda cómodo.',
      },
      disabled: false,
      notes: '',
    },
    {
      id: 'node_resp_general',
      type: 'communication.respond',
      nodeVersion: 1,
      name: 'Respuesta general',
      position: { x: 920, y: 280 },
      config: {
        message:
          'Hola {{trigger.name}}, gracias por escribir a {{variables.empresa}}. Contame en qué te puedo ayudar: turnos, precios u otra consulta.',
      },
      disabled: false,
      notes: '',
    },
  ],
  edges: [
    { id: 'edge_1', source: 'node_wa_in', sourcePort: 'main', target: 'node_vars', targetPort: 'main' },
    { id: 'edge_2', source: 'node_vars', sourcePort: 'main', target: 'node_intent', targetPort: 'main' },
    { id: 'edge_3', source: 'node_intent', sourcePort: 'true', target: 'node_resp_turno', targetPort: 'main' },
    { id: 'edge_4', source: 'node_intent', sourcePort: 'false', target: 'node_resp_general', targetPort: 'main' },
  ],
  stickyNotes: [
    {
      id: 'note_demo',
      position: { x: 300, y: -60 },
      width: 240,
      height: 120,
      text: 'Demo: abrí el Simulador y escribí "quiero un turno" o "cuánto sale" para ver las dos ramas.',
    },
  ],
  groups: [],
};

async function main() {
  const ownerEmail = (process.env.AUTHORIZED_EMAILS ?? 'dev@ifnodes.local')
    .split(',')[0]!
    .trim();

  const owner = await prisma.user.upsert({
    where: { email: ownerEmail },
    update: { role: 'OWNER' },
    create: { email: ownerEmail, name: 'Owner', role: 'OWNER' },
  });
  console.log(`Usuario owner: ${owner.email}`);

  let client = await prisma.client.findFirst({ where: { name: 'Cliente demo' } });
  if (!client) {
    client = await prisma.client.create({
      data: {
        name: 'Cliente demo',
        industry: 'Estética',
        status: 'IN_DEVELOPMENT',
        contactName: 'Contacto demo',
        internalNotes: 'Cliente de ejemplo creado por el seed de desarrollo.',
        createdById: owner.id,
      },
    });
  }

  let project = await prisma.project.findFirst({ where: { clientId: client.id, name: 'Bot demo' } });
  if (!project) {
    project = await prisma.project.create({
      data: {
        clientId: client.id,
        name: 'Bot demo',
        description: 'Proyecto de demostración con el flujo mínimo del MVP.',
        type: 'WHATSAPP_BOT',
        status: 'IN_DEVELOPMENT',
        ownerId: owner.id,
        environments: {
          create: [{ kind: 'DEVELOPMENT' }, { kind: 'TESTING' }, { kind: 'PRODUCTION' }],
        },
      },
    });
  }

  // El flujo demo se crea o ACTUALIZA al grafo de demostración vigente
  // (es un proyecto de ejemplo; los proyectos reales nunca se tocan acá).
  const existingWorkflow = await prisma.workflow.findFirst({
    where: { projectId: project.id, isMain: true },
  });
  if (existingWorkflow) {
    await prisma.workflow.update({
      where: { id: existingWorkflow.id },
      data: { draftGraph: DEMO_GRAPH },
    });
  } else {
    await prisma.workflow.create({
      data: {
        projectId: project.id,
        name: 'Flujo principal',
        isMain: true,
        draftGraph: DEMO_GRAPH,
      },
    });
  }

  console.log(`Cliente: ${client.name} · Proyecto: ${project.name} · Flujo principal listo.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
