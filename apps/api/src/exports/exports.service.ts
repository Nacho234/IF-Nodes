import { createWriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { build } from 'esbuild';
import type { Archiver } from 'archiver';
// El default de archiver es una función factory que sus @types no tipan como
// invocable; require tipado explícito resuelve el interop sin castear a any.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const createArchiver = require('archiver') as (
  format: string,
  options?: { zlib?: { level?: number } },
) => Archiver;
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, type User } from '@ifnodes/database';
import { workflowGraphSchema, type WorkflowGraph } from '@ifnodes/shared';
import { decryptSecret } from '@ifnodes/shared/dist/crypto';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  buildExportPlan,
  dockerfile,
  envExample,
  gitignore,
  packageJson,
  railwayJson,
  readme,
  slugify,
  type ResolvedCredential,
} from './generator';

const MONOREPO_ROOT = resolve(dirname(require.resolve('@ifnodes/runtime-template')), '../../..');
const RUNTIME_ENTRY = require.resolve('@ifnodes/runtime-template');
const OUTPUT_ROOT = process.env.EXPORT_OUTPUT_DIR ?? resolve(MONOREPO_ROOT, 'output');

@Injectable()
export class ExportsService {
  private readonly logger = new Logger(ExportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listByProject(projectId: string) {
    return this.prisma.client.export.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      include: { version: { select: { number: true } } },
    });
  }

  /** Listado global de exportaciones recientes (para la sección Exportaciones). */
  async listRecent(take = 50) {
    return this.prisma.client.export.findMany({
      orderBy: { createdAt: 'desc' },
      take,
      include: {
        version: { select: { number: true } },
        project: { select: { id: true, name: true, client: { select: { name: true } } } },
        createdBy: { select: { name: true } },
      },
    });
  }

  /**
   * Genera el runtime exportable de una versión (estable por defecto).
   * Escribe una carpeta y un ZIP descargable; nunca incluye secretos.
   */
  async generate(workflowId: string, versionId: string | undefined, user: User) {
    const workflow = await this.prisma.client.workflow.findUnique({
      where: { id: workflowId },
      include: { project: { select: { id: true, name: true } } },
    });
    if (!workflow) throw new NotFoundException('Flujo no encontrado.');

    const version = versionId
      ? await this.prisma.client.workflowVersion.findUnique({ where: { id: versionId } })
      : ((await this.prisma.client.workflowVersion.findFirst({
          where: { workflowId, isStable: true },
          orderBy: { number: 'desc' },
        })) ??
        (await this.prisma.client.workflowVersion.findFirst({
          where: { workflowId },
          orderBy: { number: 'desc' },
        })));

    if (!version) {
      throw new BadRequestException('Publicá una versión antes de exportar (idealmente marcada como estable).');
    }

    const graph = workflowGraphSchema.parse(version.graph);
    this.assertExportable(graph);

    const exportRow = await this.prisma.client.export.create({
      data: {
        projectId: workflow.project.id,
        versionId: version.id,
        status: 'GENERATING',
        format: 'zip',
        createdById: user.id,
      },
    });

    try {
      const resolved = await this.resolveReferencedCredentials(graph, workflow.project.id);
      const plan = buildExportPlan(workflow.project.name, version.number, graph, resolved);

      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const projectDir = resolve(OUTPUT_ROOT, `${plan.slug}-v${version.number}-${stamp}`);
      await mkdir(resolve(projectDir, 'workflow'), { recursive: true });
      await mkdir(resolve(projectDir, 'dist'), { recursive: true });

      // 1. Runtime empaquetado (autocontenido, sin dependencias del monorepo)
      await build({
        entryPoints: [RUNTIME_ENTRY],
        outfile: resolve(projectDir, 'dist', 'main.js'),
        bundle: true,
        platform: 'node',
        format: 'cjs',
        target: 'node20',
        minify: true,
        legalComments: 'none',
      });

      // 2. Datos del flujo (sin secretos)
      await writeFile(
        resolve(projectDir, 'workflow', 'workflow.json'),
        JSON.stringify(graph, null, 2),
      );
      await writeFile(
        resolve(projectDir, 'workflow', 'manifest.json'),
        JSON.stringify(plan.manifest, null, 2),
      );
      await writeFile(
        resolve(projectDir, 'workflow', 'credentials.json'),
        JSON.stringify(plan.credentialManifest, null, 2),
      );

      // Base de conocimiento del proyecto (para el nodo Buscar conocimiento)
      const knowledge = await this.prisma.client.knowledgeChunk.findMany({
        where: { projectId: workflow.project.id },
        select: { id: true, title: true, content: true },
      });
      await writeFile(
        resolve(projectDir, 'workflow', 'knowledge.json'),
        JSON.stringify(knowledge, null, 2),
      );

      // 3. Archivos del proyecto
      await writeFile(resolve(projectDir, 'package.json'), packageJson(plan));
      await writeFile(resolve(projectDir, 'Dockerfile'), dockerfile());
      await writeFile(resolve(projectDir, 'railway.json'), railwayJson());
      await writeFile(resolve(projectDir, '.env.example'), envExample(plan));
      await writeFile(resolve(projectDir, '.gitignore'), gitignore());
      await writeFile(resolve(projectDir, 'README.md'), readme(plan));

      // 4. ZIP
      const zipPath = `${projectDir}.zip`;
      const sizeBytes = await this.zipDirectory(projectDir, zipPath, plan.slug);

      const done = await this.prisma.client.export.update({
        where: { id: exportRow.id },
        data: {
          status: 'COMPLETED',
          manifest: plan.manifest as unknown as Prisma.InputJsonValue,
          outputPath: zipPath,
          sizeBytes,
        },
      });

      await this.audit.log({
        userId: user.id,
        action: 'export.created',
        entityType: 'export',
        entityId: exportRow.id,
        detail: { versionNumber: version.number, slug: plan.slug, nodes: plan.usedNodeTypes.length },
      });

      this.logger.log(`Export ${plan.slug} v${version.number} listo (${sizeBytes} bytes)`);
      return {
        id: done.id,
        slug: plan.slug,
        folder: projectDir,
        zipPath,
        sizeBytes,
        manifest: plan.manifest,
        requiredEnvVars: plan.envVars,
      };
    } catch (error) {
      await this.prisma.client.export.update({
        where: { id: exportRow.id },
        data: { status: 'FAILED', error: error instanceof Error ? error.message.slice(0, 500) : 'error' },
      });
      throw error;
    }
  }

  /**
   * Genera el runtime del PROYECTO COMPLETO: bundlea TODOS sus flujos en un solo
   * paquete (flows.json), con un orquestador que rutea entrada/campañas/cron.
   * Para cada flujo usa su versión estable (o la última, o el borrador vivo).
   * Es la Opción B: el bot entero corre en la infra del cliente sin IF Nodes.
   */
  async generateProject(projectId: string, user: User) {
    const project = await this.prisma.client.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true },
    });
    if (!project) throw new NotFoundException('Proyecto no encontrado.');

    const workflows = await this.prisma.client.workflow.findMany({
      where: { projectId },
      include: {
        versions: { orderBy: [{ isStable: 'desc' }, { number: 'desc' }], take: 1 },
      },
      orderBy: { createdAt: 'asc' },
    });
    if (workflows.length === 0) throw new BadRequestException('El proyecto no tiene flujos para exportar.');

    // Para cada flujo: versión estable/última si existe, si no el borrador vivo.
    const flows = workflows.map((wf) => {
      const raw = wf.versions[0]?.graph ?? wf.draftGraph;
      const graph = workflowGraphSchema.parse(raw);
      this.assertExportable(graph);
      return { id: wf.id, name: wf.name, slug: slugify(wf.name) || wf.id, graph, version: wf.versions[0]?.number ?? 0 };
    });

    // Grafo combinado (unión de nodos) para calcular credenciales/env/entrypoints de TODO el proyecto.
    const mergedGraph: WorkflowGraph = {
      nodes: flows.flatMap((f) => f.graph.nodes),
      edges: [],
      stickyNotes: [],
      groups: [],
    };
    const maxVersion = Math.max(1, ...flows.map((f) => f.version));

    const exportRow = await this.prisma.client.export.create({
      data: { projectId, versionId: null, status: 'GENERATING', format: 'zip', createdById: user.id },
    });

    try {
      const resolved = await this.resolveReferencedCredentials(mergedGraph, projectId);
      const plan = buildExportPlan(project.name, maxVersion, mergedGraph, resolved);

      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const projectDir = resolve(OUTPUT_ROOT, `${plan.slug}-proyecto-${stamp}`);
      await mkdir(resolve(projectDir, 'workflow'), { recursive: true });
      await mkdir(resolve(projectDir, 'dist'), { recursive: true });

      // 1. Runtime empaquetado (autocontenido)
      await build({
        entryPoints: [RUNTIME_ENTRY],
        outfile: resolve(projectDir, 'dist', 'main.js'),
        bundle: true,
        platform: 'node',
        format: 'cjs',
        target: 'node20',
        minify: true,
        legalComments: 'none',
      });

      // 2. Todos los flujos del proyecto + manifest + credenciales (sin secretos)
      await writeFile(
        resolve(projectDir, 'workflow', 'flows.json'),
        JSON.stringify(
          flows.map((f) => ({ id: f.id, name: f.name, slug: f.slug, graph: f.graph })),
          null,
          2,
        ),
      );
      await writeFile(resolve(projectDir, 'workflow', 'manifest.json'), JSON.stringify(plan.manifest, null, 2));
      await writeFile(
        resolve(projectDir, 'workflow', 'credentials.json'),
        JSON.stringify(plan.credentialManifest, null, 2),
      );

      const knowledge = await this.prisma.client.knowledgeChunk.findMany({
        where: { projectId },
        select: { id: true, title: true, content: true },
      });
      await writeFile(resolve(projectDir, 'workflow', 'knowledge.json'), JSON.stringify(knowledge, null, 2));

      // Semilla del CRM: el runtime la carga solo si su base está vacía.
      const contacts = await this.prisma.client.contact.findMany({
        where: { projectId },
        select: { name: true, phone: true, email: true, status: true, tags: true, notes: true, data: true },
      });
      await writeFile(resolve(projectDir, 'workflow', 'contacts.json'), JSON.stringify(contacts, null, 2));

      // 3. Archivos del proyecto
      await writeFile(resolve(projectDir, 'package.json'), packageJson(plan));
      await writeFile(resolve(projectDir, 'Dockerfile'), dockerfile());
      await writeFile(resolve(projectDir, 'railway.json'), railwayJson());
      await writeFile(resolve(projectDir, '.env.example'), envExample(plan));
      await writeFile(resolve(projectDir, '.gitignore'), gitignore());
      await writeFile(
        resolve(projectDir, 'README.md'),
        readme(plan, flows.map((f) => ({ name: f.name, slug: f.slug }))),
      );

      // 4. ZIP
      const zipPath = `${projectDir}.zip`;
      const sizeBytes = await this.zipDirectory(projectDir, zipPath, plan.slug);

      const done = await this.prisma.client.export.update({
        where: { id: exportRow.id },
        data: {
          status: 'COMPLETED',
          manifest: plan.manifest as unknown as Prisma.InputJsonValue,
          outputPath: zipPath,
          sizeBytes,
        },
      });

      await this.audit.log({
        userId: user.id,
        action: 'export.project.created',
        entityType: 'export',
        entityId: exportRow.id,
        detail: { projectId, slug: plan.slug, flows: flows.length },
      });

      this.logger.log(`Export de proyecto ${plan.slug} listo: ${flows.length} flujos (${sizeBytes} bytes)`);
      return {
        id: done.id,
        slug: plan.slug,
        folder: projectDir,
        zipPath,
        sizeBytes,
        manifest: plan.manifest,
        flows: flows.map((f) => ({ name: f.name, slug: f.slug })),
        requiredEnvVars: plan.envVars,
      };
    } catch (error) {
      await this.prisma.client.export.update({
        where: { id: exportRow.id },
        data: { status: 'FAILED', error: error instanceof Error ? error.message.slice(0, 500) : 'error' },
      });
      throw error;
    }
  }

  async getDownloadPath(id: string): Promise<{ path: string; slug: string }> {
    const row = await this.prisma.client.export.findUnique({
      where: { id },
      include: { project: { select: { name: true } } },
    });
    if (!row || row.status !== 'COMPLETED' || !row.outputPath) {
      throw new NotFoundException('Export no disponible.');
    }
    return { path: row.outputPath, slug: row.outputPath.split('/').pop() ?? 'export.zip' };
  }

  private assertExportable(graph: WorkflowGraph): void {
    // Un nodo no exportable (p.ej. de simulación) bloquea la exportación.
    // Los nodos actuales son todos exportables; este chequeo protege a futuro.
    const nonExportable = graph.nodes.filter((n) => !n.disabled && n.type.startsWith('sim.'));
    if (nonExportable.length > 0) {
      throw new BadRequestException(
        `El flujo usa nodos no exportables: ${nonExportable.map((n) => n.name).join(', ')}.`,
      );
    }
  }

  private async resolveReferencedCredentials(
    graph: WorkflowGraph,
    projectId: string,
  ): Promise<ResolvedCredential[]> {
    const ids = new Set<string>();
    for (const node of graph.nodes) {
      const credId = node.config['credentialId'];
      if (typeof credId === 'string' && credId) ids.add(credId);
    }
    if (ids.size === 0) return [];
    const rows = await this.prisma.client.credential.findMany({
      where: { id: { in: [...ids] }, OR: [{ projectId }, { projectId: null }] },
      include: { integration: true },
    });
    return rows.map((row) => ({
      id: row.id,
      slug: row.integration.slug,
      data: JSON.parse(decryptSecret(row.encryptedData)) as Record<string, string>,
    }));
  }

  private zipDirectory(sourceDir: string, zipPath: string, rootName: string): Promise<number> {
    return new Promise((resolvePromise, reject) => {
      const output = createWriteStream(zipPath);
      const archive = createArchiver('zip', { zlib: { level: 9 } });
      output.on('close', () => resolvePromise(archive.pointer()));
      archive.on('error', reject);
      archive.pipe(output);
      // Carpeta raíz con el nombre del proyecto dentro del ZIP
      archive.directory(sourceDir, rootName);
      void archive.finalize();
    });
  }
}
