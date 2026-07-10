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
import { api } from '@/lib/api';
import { useBuilderStore } from './store';
import { FlowNode } from './flow-node';
import { NodePalette, DND_MIME } from './palette';
import { ConfigPanel } from './config-panel';
import { BuilderToolbar } from './toolbar';
import type { NodeTypeInfo, SaveDraftResponse, WorkflowDetail } from '@/lib/types';

const AUTOSAVE_DELAY_MS = 1200;
const nodeTypes = { ifn: FlowNode };

function BuilderInner({ workflow, catalog }: { workflow: WorkflowDetail; catalog: NodeTypeInfo[] }) {
  const store = useBuilderStore();
  const { screenToFlowPosition } = useReactFlow();
  const [validating, setValidating] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  const saveNow = useCallback(async () => {
    const state = useBuilderStore.getState();
    if (state.saveState === 'saving') return;
    state.setSaveState('saving');
    try {
      const response = await api.put<SaveDraftResponse>(`/workflows/${workflow.id}/draft`, {
        graph: state.toGraph(),
      });
      useBuilderStore.getState().setIssues(response.structureIssues, response.configIssues);
      useBuilderStore.getState().markSaved(response.savedAt);
    } catch {
      useBuilderStore.getState().setSaveState('error');
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

  // Cmd/Ctrl+S: guardar ya
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void saveNow();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [saveNow]);

  const validate = useCallback(async () => {
    setValidating(true);
    try {
      await saveNow();
      const result = await api.get<{ structureIssues: SaveDraftResponse['structureIssues']; configIssues: SaveDraftResponse['configIssues'] }>(
        `/workflows/${workflow.id}/validate`,
      );
      useBuilderStore.getState().setIssues(result.structureIssues, result.configIssues);
    } finally {
      setValidating(false);
    }
  }, [saveNow, workflow.id]);

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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <BuilderToolbar workflow={workflow} onValidate={() => void validate()} onSaveNow={() => void saveNow()} validating={validating} />
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

          {store.nodes.length === 0 && store.saveState !== 'loading' ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <p className="max-w-xs rounded-lg border border-dashed border-border-strong bg-surface/80 px-6 py-4 text-center text-[13px] text-muted-foreground backdrop-blur-sm">
                Arrastrá un nodo desde la biblioteca (o doble clic) para empezar. Todo flujo necesita un
                disparador como <strong>Inicio manual</strong>.
              </p>
            </div>
          ) : null}
        </div>
        <ConfigPanel />
      </div>
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
