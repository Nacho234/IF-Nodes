'use client';

import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type OnSelectionChangeParams,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { workflowGraphSchema, type WorkflowGraph } from '@ifnodes/shared';
import { api, ApiError } from '@/lib/api';
import { useBuilderStore } from './store';
import { FlowNode } from './flow-node';
import { NoteNode } from './note-node';
import { NodePalette, DND_MIME } from './palette';
import { ConfigPanel } from './config-panel';
import { SimulatorPanel } from './simulator-panel';
import { CopilotPanel } from './copilot-panel';
import { BuilderToolbar } from './toolbar';
import { TestCaseDialog } from '@/features/tests/test-case-dialog';
import { VersionsDialog } from './versions-dialog';
import { ExportDialog } from './export-dialog';
import { ReadinessDialog } from './readiness-dialog';
import type { ExecutionDetail, NodeTypeInfo, SaveDraftResponse, WorkflowDetail } from '@/lib/types';

const AUTOSAVE_DELAY_MS = 1200;
const RUN_POLL_MS = 700;
const nodeTypes = { ifn: FlowNode, note: NoteNode };

const TERMINAL_STATUSES = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT']);

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
  );
}

function BuilderInner({ workflow, catalog }: { workflow: WorkflowDetail; catalog: NodeTypeInfo[] }) {
  const store = useBuilderStore();
  const { screenToFlowPosition } = useReactFlow();
  const [validating, setValidating] = useState(false);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [simulatorOpen, setSimulatorOpen] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [testCaseDialogOpen, setTestCaseDialogOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [readinessOpen, setReadinessOpen] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initializedFor = useRef<string | null>(null);

  // Cargar el borrador en el store (una sola vez por workflow)
  useEffect(() => {
    if (initializedFor.current === workflow.id) return;
    initializedFor.current = workflow.id;
    const parsed = workflowGraphSchema.safeParse(workflow.draftGraph);
    const graph: WorkflowGraph = parsed.success
      ? parsed.data
      : { nodes: [], edges: [], stickyNotes: [], groups: [] };
    store.initialize(graph, catalog);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflow.id, catalog]);

  useEffect(
    () => () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    },
    [],
  );

  const saveNow = useCallback(async (): Promise<boolean> => {
    const state = useBuilderStore.getState();
    if (state.saveState === 'saving') return false;
    state.setSaveState('saving');
    try {
      const response = await api.put<SaveDraftResponse>(`/workflows/${workflow.id}/draft`, {
        graph: state.toGraph(),
      });
      useBuilderStore.getState().setIssues(response.structureIssues, response.configIssues);
      useBuilderStore.getState().markSaved(response.savedAt);
      return true;
    } catch {
      useBuilderStore.getState().setSaveState('error');
      return false;
    }
  }, [workflow.id]);

  // Autosave con debounce ante cualquier mutación del grafo
  const revision = useBuilderStore((state) => state.revision);
  useEffect(() => {
    if (revision === 0) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void saveNow(), AUTOSAVE_DELAY_MS);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [revision, saveNow]);

  /** Espera (polleando) a que la ejecución termine, actualizando el lienzo en vivo. */
  const awaitExecution = useCallback(async (executionId: string): Promise<ExecutionDetail> => {
    for (;;) {
      const execution = await api.get<ExecutionDetail>(`/executions/${executionId}`);
      useBuilderStore.getState().setActiveExecution(execution);
      if (TERMINAL_STATUSES.has(execution.status)) return execution;
      await new Promise((resolve) => {
        pollTimer.current = setTimeout(resolve, RUN_POLL_MS);
      });
    }
  }, []);

  /** Guarda, ejecuta el flujo con el input dado y devuelve la ejecución terminal. */
  const runWithInput = useCallback(
    async (input: Record<string, unknown>): Promise<ExecutionDetail> => {
      setRunError(null);
      setRunning(true);
      useBuilderStore.getState().setActiveExecution(null);
      try {
        const saved = await saveNow();
        if (!saved) throw new ApiError(0, 'No se pudo guardar antes de ejecutar.');
        const { executionId } = await api.post<{ executionId: string }>(`/workflows/${workflow.id}/run`, {
          input,
        });
        return await awaitExecution(executionId);
      } finally {
        setRunning(false);
      }
    },
    [saveNow, workflow.id, awaitExecution],
  );

  const runFlow = useCallback(async () => {
    try {
      await runWithInput({});
    } catch (error) {
      setRunError(error instanceof ApiError ? error.message : 'No se pudo iniciar la ejecución.');
    }
  }, [runWithInput]);

  const validate = useCallback(async () => {
    setValidating(true);
    try {
      await saveNow();
      const result = await api.get<{
        structureIssues: SaveDraftResponse['structureIssues'];
        configIssues: SaveDraftResponse['configIssues'];
      }>(`/workflows/${workflow.id}/validate`);
      useBuilderStore.getState().setIssues(result.structureIssues, result.configIssues);
    } finally {
      setValidating(false);
    }
  }, [saveNow, workflow.id]);

  // Atajos: guardar, deshacer/rehacer, copiar/pegar
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod) return;
      const key = event.key.toLowerCase();
      if (key === 's') {
        event.preventDefault();
        void saveNow();
        return;
      }
      if (isEditableTarget(event.target)) return;
      const state = useBuilderStore.getState();
      if (key === 'z' && event.shiftKey) {
        event.preventDefault();
        state.redo();
      } else if (key === 'z') {
        event.preventDefault();
        state.undo();
      } else if (key === 'c') {
        state.copySelection();
      } else if (key === 'v') {
        state.paste();
      } else if (key === 'd') {
        if (state.selectedNodeId) {
          event.preventDefault();
          state.duplicateNode(state.selectedNodeId);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [saveNow]);

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      const type = event.dataTransfer.getData(DND_MIME);
      if (!type) return;
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      store.addNode(type, position);
    },
    [screenToFlowPosition, store],
  );

  const onSelectionChange = useCallback(
    ({ nodes }: OnSelectionChangeParams) => {
      store.setSelected(nodes.length === 1 ? (nodes[0]?.id ?? null) : null);
    },
    [store],
  );

  /** Recarga el borrador desde la API (tras restaurar una versión). */
  const reloadDraft = useCallback(async () => {
    const fresh = await api.get<WorkflowDetail>(`/workflows/${workflow.id}`);
    const parsed = workflowGraphSchema.safeParse(fresh.draftGraph);
    if (parsed.success) useBuilderStore.getState().initialize(parsed.data, catalog);
  }, [workflow.id, catalog]);

  const addNoteAtCenter = useCallback(() => {
    const position = screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
    store.addNote(position);
  }, [screenToFlowPosition, store]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <BuilderToolbar
        workflow={workflow}
        onValidate={() => void validate()}
        onSaveNow={() => void saveNow()}
        onRun={() => void runFlow()}
        onAddNote={addNoteAtCenter}
        onAutoLayout={() => useBuilderStore.getState().autoLayout()}
        onToggleSimulator={() => {
          setSimulatorOpen((open) => !open);
          setCopilotOpen(false);
        }}
        onToggleCopilot={() => {
          setCopilotOpen((open) => !open);
          setSimulatorOpen(false);
        }}
        onSaveTestCase={() => setTestCaseDialogOpen(true)}
        onOpenVersions={() => setVersionsOpen(true)}
        onOpenExport={() => setExportOpen(true)}
        onOpenReadiness={() => setReadinessOpen(true)}
        simulatorOpen={simulatorOpen}
        copilotOpen={copilotOpen}
        validating={validating}
        running={running}
      />
      <div className="flex min-h-0 flex-1">
        <NodePalette />
        <div className="relative min-w-0 flex-1" role="application" aria-label="Lienzo del flujo">
          <ReactFlow
            nodes={store.nodes}
            edges={store.edges}
            nodeTypes={nodeTypes}
            onNodesChange={store.onNodesChange}
            onEdgesChange={store.onEdgesChange}
            onConnect={store.onConnect}
            onSelectionChange={onSelectionChange}
            onDrop={onDrop}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
            }}
            deleteKeyCode={['Backspace', 'Delete']}
            fitView
            fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
            proOptions={{ hideAttribution: true }}
            minZoom={0.2}
            maxZoom={2}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1.5} color="var(--canvas-dots)" />
            <Controls position="bottom-left" showInteractive={false} />
            <MiniMap
              position="bottom-right"
              pannable
              zoomable
              nodeColor="var(--edge-stroke)"
              maskColor="color-mix(in srgb, var(--canvas-bg) 70%, transparent)"
            />
          </ReactFlow>

          {runError ? (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 rounded-md border border-danger/40 bg-danger-soft px-4 py-2 text-[12px] text-danger shadow-lg">
              {runError}
            </div>
          ) : null}

          {store.nodes.length === 0 && store.saveState !== 'loading' ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <p className="max-w-xs rounded-lg border border-dashed border-border-strong bg-surface/80 px-6 py-4 text-center text-[13px] text-muted-foreground backdrop-blur-sm">
                Arrastrá un nodo desde la biblioteca (o doble clic) para empezar. Todo flujo necesita un
                disparador como <strong>Inicio manual</strong>.
              </p>
            </div>
          ) : null}
        </div>
        {copilotOpen ? (
          <CopilotPanel workflowId={workflow.id} onClose={() => setCopilotOpen(false)} />
        ) : simulatorOpen ? (
          <SimulatorPanel onSend={runWithInput} onClose={() => setSimulatorOpen(false)} />
        ) : (
          <ConfigPanel webhookToken={workflow.webhookToken} />
        )}
      </div>

      <TestCaseDialog
        open={testCaseDialogOpen}
        onOpenChange={setTestCaseDialogOpen}
        projectId={workflow.projectId}
        workflowId={workflow.id}
        prefillInput={
          (useBuilderStore.getState().activeExecution?.triggerData as Record<string, unknown> | null) ??
          undefined
        }
      />

      <VersionsDialog
        open={versionsOpen}
        onOpenChange={setVersionsOpen}
        workflowId={workflow.id}
        onRestored={() => void reloadDraft()}
      />

      <ExportDialog open={exportOpen} onOpenChange={setExportOpen} workflowId={workflow.id} />

      <ReadinessDialog open={readinessOpen} onOpenChange={setReadinessOpen} workflowId={workflow.id} />
    </div>
  );
}

export function Builder(props: { workflow: WorkflowDetail; catalog: NodeTypeInfo[] }) {
  return (
    <ReactFlowProvider>
      <BuilderInner {...props} />
    </ReactFlowProvider>
  );
}
