import { Injectable, NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import type { User } from '@ifnodes/database';
import { EMPTY_GRAPH, workflowGraphSchema, type WorkflowGraph } from '@ifnodes/shared';
import { analyzeReadiness, nodeRegistry } from '@ifnodes/node-definitions';
import {
  applyChangeSet,
  buildCopilotContext,
  COPILOT_SYSTEM_PROMPT,
  createCopilotProvider,
  estimateCopilotCost,
  parseChangeSet,
  parseProjectPlan,
  type CopilotChatMessage,
  type CopilotExecutionInput,
  type CopilotProvider,
  type CopilotReadinessItem,
} from '@ifnodes/copilot';
import { PrismaService } from '../common/prisma.service';
import { loadEnv } from '../config/env';

/** Cuántos turnos de historial se le mandan al modelo (para acotar tokens). */
const HISTORY_LIMIT = 20;

interface ChatParams {
  sessionId: string;
  content: string;
  selectedNodeId?: string | null;
}

@Injectable()
export class CopilotService {
  private readonly provider: CopilotProvider;
  private readonly maxTokens: number;

  constructor(private readonly prisma: PrismaService) {
    const { copilot } = loadEnv();
    this.provider = createCopilotProvider({
      provider: copilot.provider,
      apiKey: copilot.apiKey,
      model: copilot.model,
      thinking: copilot.thinking,
    });
    this.maxTokens = copilot.maxTokens;
  }

  /** Estado del proveedor para que la UI avise si hay IA real o modo dev. */
  config() {
    return { provider: this.provider.id, model: this.provider.model, isReal: this.provider.isReal };
  }

  /**
   * Fase 3: arma un PROYECTO entero de un pedido de alto nivel — varios flujos
   * + conocimiento sembrado. Valida todos los flujos antes de crear nada (todo
   * o nada). No toca secretos: las credenciales las carga el usuario después
   * (guiado por "Puesta en marcha").
   */
  async buildProject(projectId: string, description: string, _user: User) {
    const project = await this.prisma.client.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true, type: true },
    });
    if (!project) throw new NotFoundException('Proyecto no encontrado.');

    if (!this.provider.isReal) {
      return { ok: false as const, message: 'El armado automático necesita Claude real (configurá ANTHROPIC_API_KEY).' };
    }

    const context = buildCopilotContext({ project: { name: project.name, type: project.type }, graph: EMPTY_GRAPH });
    const system =
      `${COPILOT_SYSTEM_PROMPT}\n\n# CONTEXTO DEL PROYECTO\n${context.text}\n\n` +
      'Armá el proyecto completo con la herramienta build_project: un flujo por cada punto de entrada ' +
      '(cada flujo con UN solo disparador). Sembrá conocimiento si el usuario da material (tono, FAQ).';

    const result = await this.provider.chat({
      system,
      messages: [{ role: 'user', content: description }],
      maxTokens: Math.max(this.maxTokens, 8000),
      enableProjectBuild: true,
      forceTool: 'build_project',
    });

    if (!result.toolCall || result.toolCall.name !== 'build_project') {
      return { ok: false as const, message: 'El copilot no devolvió un plan de proyecto. Probá reformulando el pedido.' };
    }
    const parsed = parseProjectPlan(result.toolCall.input);
    if (!parsed.ok) return { ok: false as const, message: `Plan inválido: ${parsed.error}` };

    const resolve = (type: string) => {
      const def = nodeRegistry.get(type);
      return def ? { version: def.version, defaultConfig: def.defaultConfig } : undefined;
    };

    // 1) Validar TODOS los flujos antes de crear nada (todo o nada)
    const built: { name: string; description: string; graph: object }[] = [];
    for (const flow of parsed.plan.flows) {
      const applied = applyChangeSet(EMPTY_GRAPH, { summary: flow.name, changes: flow.changes }, resolve);
      if (!applied.ok || !applied.graph) {
        return { ok: false as const, message: `El flujo "${flow.name}" no se pudo armar: ${applied.errors.join('; ')}` };
      }
      built.push({ name: flow.name, description: flow.description, graph: applied.graph });
    }

    // 2) Crear los flujos (reusar el main vacío para el primero) + conocimiento
    const mainWf = await this.prisma.client.workflow.findFirst({ where: { projectId, isMain: true } });
    const createdFlows: { id: string; name: string }[] = [];
    for (const [index, flow] of built.entries()) {
      const mainIsEmpty =
        index === 0 &&
        mainWf &&
        Array.isArray((mainWf.draftGraph as { nodes?: unknown[] } | null)?.nodes) &&
        ((mainWf.draftGraph as { nodes: unknown[] }).nodes.length === 0);
      if (mainIsEmpty && mainWf) {
        const updated = await this.prisma.client.workflow.update({
          where: { id: mainWf.id },
          data: { name: flow.name, draftGraph: flow.graph },
        });
        createdFlows.push({ id: updated.id, name: updated.name });
      } else {
        const wf = await this.prisma.client.workflow.create({
          data: { projectId, name: flow.name, draftGraph: flow.graph },
        });
        createdFlows.push({ id: wf.id, name: wf.name });
      }
    }

    let knowledgeAdded = 0;
    if (parsed.plan.knowledge.length > 0) {
      await this.prisma.client.knowledgeChunk.createMany({
        data: parsed.plan.knowledge.map((k) => ({ projectId, title: k.title ?? null, content: k.content, tags: k.tags })),
      });
      knowledgeAdded = parsed.plan.knowledge.length;
    }

    return { ok: true as const, summary: parsed.plan.summary, flows: createdFlows, knowledgeAdded };
  }

  /** Una sesión (la más reciente) por flujo; la crea si no existe. */
  async getOrCreateSession(workflowId: string, user: User) {
    const workflow = await this.prisma.client.workflow.findUnique({
      where: { id: workflowId },
      select: { id: true, projectId: true },
    });
    if (!workflow) throw new NotFoundException('Flujo no encontrado.');

    let session = await this.prisma.client.copilotSession.findFirst({
      where: { workflowId },
      orderBy: { updatedAt: 'desc' },
    });
    if (!session) {
      session = await this.prisma.client.copilotSession.create({
        data: { workflowId, projectId: workflow.projectId, userId: user.id },
      });
    }
    const messages = await this.prisma.client.copilotMessage.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: 'asc' },
    });
    return { session, messages };
  }

  /** Reemplaza el historial: borra los mensajes de la sesión (nuevo chat). */
  async resetSession(sessionId: string) {
    await this.ensureSession(sessionId);
    await this.prisma.client.copilotMessage.deleteMany({ where: { sessionId } });
    return { ok: true };
  }

  /**
   * Turno de chat con streaming SSE. Construye el contexto redactado, persiste
   * el mensaje del usuario, llama al proveedor en streaming (escribiendo a res)
   * y guarda la respuesta del asistente con uso y propuesta (mostrada, no aplicada).
   */
  async chatStream(params: ChatParams, user: User, res: Response): Promise<void> {
    const session = await this.ensureSession(params.sessionId);
    const workflow = await this.prisma.client.workflow.findUnique({
      where: { id: session.workflowId },
      include: { project: { select: { name: true, type: true } } },
    });
    if (!workflow) throw new NotFoundException('Flujo no encontrado.');

    const graph = this.parseGraph(workflow.draftGraph);
    const lastExecution = await this.loadLastExecution(session.workflowId);
    const readiness = await this.computeReadiness(workflow.projectId, graph);

    const context = buildCopilotContext({
      project: { name: workflow.project.name, type: workflow.project.type },
      graph,
      lastExecution,
      selectedNodeId: params.selectedNodeId ?? null,
      readiness,
    });

    // Historial ANTES de guardar el nuevo turno
    const history = await this.prisma.client.copilotMessage.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: 'desc' },
      take: HISTORY_LIMIT,
    });
    const priorMessages: CopilotChatMessage[] = history
      .reverse()
      .map((m) => ({ role: m.role === 'USER' ? 'user' : 'assistant', content: m.content }));

    await this.prisma.client.copilotMessage.create({
      data: {
        sessionId: session.id,
        role: 'USER',
        content: params.content,
        contextSent: context.redacted as object,
      },
    });

    const messages: CopilotChatMessage[] = [...priorMessages, { role: 'user', content: params.content }];
    const system = `${COPILOT_SYSTEM_PROMPT}\n\n# CONTEXTO DEL FLUJO\n${context.text}`;

    // ── SSE ──
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const send = (payload: unknown) => res.write(`data: ${JSON.stringify(payload)}\n\n`);
    send({ type: 'meta', ...this.config() });

    // Cancelación si el cliente cierra la conexión
    const abort = new AbortController();
    res.on('close', () => abort.abort());

    try {
      const result = await this.provider.chat(
        { system, messages, maxTokens: this.maxTokens, enableProposals: true, signal: abort.signal },
        {
          onText: (delta) => send({ type: 'text', delta }),
          onThinking: (delta) => send({ type: 'thinking', delta }),
        },
      );

      let proposal: object | null = null;
      if (result.proposalRaw !== undefined) {
        const parsed = parseChangeSet(result.proposalRaw);
        if (parsed.ok) proposal = parsed.changeSet;
      }
      const estimatedCost = estimateCopilotCost(
        result.model,
        result.usage.inputTokens,
        result.usage.outputTokens,
      );

      const assistant = await this.prisma.client.copilotMessage.create({
        data: {
          sessionId: session.id,
          role: 'ASSISTANT',
          content: result.text,
          proposal: proposal ?? undefined,
          provider: result.provider,
          model: result.model,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          estimatedCost,
          stopReason: result.stopReason,
        },
      });
      await this.prisma.client.copilotSession.update({
        where: { id: session.id },
        data: { updatedAt: new Date() },
      });

      send({
        type: 'done',
        messageId: assistant.id,
        usage: result.usage,
        estimatedCost,
        stopReason: result.stopReason,
        proposal,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error desconocido del copilot.';
      await this.prisma.client.copilotMessage
        .create({
          data: {
            sessionId: session.id,
            role: 'ASSISTANT',
            content: '',
            provider: this.provider.id,
            model: this.provider.model,
            error: message,
          },
        })
        .catch(() => undefined);
      if (!res.writableEnded) send({ type: 'error', message });
    } finally {
      if (!res.writableEnded) res.end();
    }
  }

  /* ── Auxiliares ────────────────────────────────────────────── */

  private async ensureSession(sessionId: string) {
    const session = await this.prisma.client.copilotSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Sesión de copilot no encontrada.');
    return session;
  }

  private parseGraph(raw: unknown): WorkflowGraph {
    const result = workflowGraphSchema.safeParse(raw);
    return result.success ? result.data : EMPTY_GRAPH;
  }

  /** Checklist determinístico de qué falta conectar/cargar (para guiar al usuario). */
  private async computeReadiness(projectId: string, graph: WorkflowGraph): Promise<CopilotReadinessItem[]> {
    const [credentials, knowledgeCount, environments] = await Promise.all([
      this.prisma.client.credential.findMany({
        where: { active: true, OR: [{ projectId }, { projectId: null }] },
        select: { integration: { select: { slug: true } } },
      }),
      this.prisma.client.knowledgeChunk.count({ where: { projectId } }),
      this.prisma.client.environment.findMany({
        where: { projectId },
        select: { variables: { select: { key: true } } },
      }),
    ]);
    const environmentKeys = Array.from(new Set(environments.flatMap((env) => env.variables.map((v) => v.key))));
    return analyzeReadiness(graph, {
      availableCredentialTypes: credentials.map((c) => c.integration.slug),
      knowledgeCount,
      environmentKeys,
    });
  }

  private async loadLastExecution(workflowId: string): Promise<CopilotExecutionInput | null> {
    const execution = await this.prisma.client.execution.findFirst({
      where: { workflowId },
      orderBy: { createdAt: 'desc' },
      include: { steps: { orderBy: { order: 'asc' } } },
    });
    if (!execution) return null;
    return {
      id: execution.id,
      status: execution.status,
      error: execution.error ? JSON.stringify(execution.error).slice(0, 500) : null,
      trigger: execution.triggerData,
      finalOutput: execution.context,
      steps: execution.steps.map((step) => ({
        nodeId: step.nodeId,
        nodeName: step.nodeName,
        status: step.status,
        error: step.error ? JSON.stringify(step.error).slice(0, 500) : null,
        durationMs: step.durationMs,
        input: step.input,
        output: step.output,
      })),
    };
  }
}
