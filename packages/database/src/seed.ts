/**
 * Seed de desarrollo. Ejecutar con la DB levantada:
 *   npm run db:seed
 * Crea: usuario owner, cliente demo, proyecto demo con flujo principal
 * (Inicio manual → Transformar datos → Respuesta) y entornos.
 * Idempotente: se puede correr varias veces.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DEMO_GRAPH = {
  nodes: [
    {
      id: 'node_trigger',
      type: 'trigger.manual',
      nodeVersion: 1,
      name: 'Inicio manual',
      position: { x: 0, y: 120 },
      config: { samplePayloadJson: '{\n  "text": "Hola, quiero un turno"\n}' },
      disabled: false,
      notes: '',
    },
    {
      id: 'node_transform',
      type: 'data.transform',
      nodeVersion: 1,
      name: 'Normalizar mensaje',
      position: { x: 320, y: 120 },
      config: {
        assignments: [{ key: 'greeting', value: 'Hola {{trigger.text}}' }],
        keepInput: true,
      },
      disabled: false,
      notes: '',
    },
    {
      id: 'node_respond',
      type: 'communication.respond',
      nodeVersion: 1,
      name: 'Respuesta',
      position: { x: 640, y: 120 },
      config: { message: '{{nodes.node_transform.output.greeting}}' },
      disabled: false,
      notes: '',
    },
  ],
  edges: [
    { id: 'edge_1', source: 'node_trigger', sourcePort: 'main', target: 'node_transform', targetPort: 'main' },
    { id: 'edge_2', source: 'node_transform', sourcePort: 'main', target: 'node_respond', targetPort: 'main' },
  ],
  stickyNotes: [],
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

  const existingWorkflow = await prisma.workflow.findFirst({
    where: { projectId: project.id, isMain: true },
  });
  if (!existingWorkflow) {
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
