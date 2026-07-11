'use client';

import { create } from 'zustand';
import {
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from '@xyflow/react';
import type { WorkflowGraph } from '@ifnodes/shared';
import type { ExecutionDetail, GraphIssueDto, NodeConfigIssueDto, NodeTypeInfo } from '@/lib/types';

/** Datos de un nodo de flujo */
export interface FlowNodeData extends Record<string, unknown> {
  nodeType: string;
  nodeVersion: number;
  name: string;
  config: Record<string, unknown>;
  disabled: boolean;
  notes: string;
}

/** Datos de una nota adhesiva del lienzo */
export interface NoteNodeData extends Record<string, unknown> {
  text: string;
}

export type BuilderNode = Node<FlowNodeData, 'ifn'>;
export type NoteNode = Node<NoteNodeData, 'note'>;
export type CanvasNode = BuilderNode | NoteNode;
export type SaveState = 'loading' | 'saved' | 'dirty' | 'saving' | 'error';

export function isFlowNode(node: CanvasNode): node is BuilderNode {
  return node.type === 'ifn';
}

function generateId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

interface HistoryEntry {
  nodes: CanvasNode[];
  edges: Edge[];
}

interface Clipboard {
  nodes: CanvasNode[];
  edges: Edge[];
}

const HISTORY_LIMIT = 50;

interface BuilderState {
  nodes: CanvasNode[];
  edges: Edge[];
  nodeTypes: Map<string, NodeTypeInfo>;
  selectedNodeId: string | null;
  saveState: SaveState;
  /** Contador de mutaciones: dispara el autosave con debounce */
  revision: number;
  structureIssues: GraphIssueDto[];
  configIssues: NodeConfigIssueDto[];
  lastSavedAt: string | null;
  /** Última ejecución de prueba (para iluminar nodos e inspeccionar pasos) */
  activeExecution: ExecutionDetail | null;
  past: HistoryEntry[];
  future: HistoryEntry[];
  clipboard: Clipboard | null;
  dragSnapshotTaken: boolean;

  initialize(graph: WorkflowGraph, nodeTypes: NodeTypeInfo[]): void;
  onNodesChange(changes: NodeChange<CanvasNode>[]): void;
  onEdgesChange(changes: EdgeChange[]): void;
  onConnect(connection: Connection): void;
  addNode(type: string, position: { x: number; y: number }): void;
  addNote(position: { x: number; y: number }): void;
  updateNodeData(nodeId: string, patch: Partial<FlowNodeData>): void;
  updateNoteText(nodeId: string, text: string): void;
  duplicateNode(nodeId: string): void;
  removeNode(nodeId: string): void;
  copySelection(): void;
  paste(): void;
  undo(): void;
  redo(): void;
  setSelected(nodeId: string | null): void;
  setSaveState(state: SaveState): void;
  setIssues(structure: GraphIssueDto[], config: NodeConfigIssueDto[]): void;
  markSaved(savedAt: string): void;
  setActiveExecution(execution: ExecutionDetail | null): void;
  toGraph(): WorkflowGraph;
}

export const useBuilderStore = create<BuilderState>((set, get) => {
  /** Snapshot para undo; limpiar el futuro (nueva línea de tiempo) */
  const snapshot = () => {
    const { nodes, edges, past } = get();
    const entry: HistoryEntry = {
      nodes: nodes.map((node) => ({ ...node, data: structuredClone(node.data) }) as CanvasNode),
      edges: edges.map((edge) => ({ ...edge })),
    };
    set({ past: [...past.slice(-(HISTORY_LIMIT - 1)), entry], future: [] });
  };

  const mutate = (partial: Partial<BuilderState>) =>
    set((state) => ({ ...partial, revision: state.revision + 1, saveState: 'dirty' as const }));

  return {
    nodes: [],
    edges: [],
    nodeTypes: new Map(),
    selectedNodeId: null,
    saveState: 'loading',
    revision: 0,
    structureIssues: [],
    configIssues: [],
    lastSavedAt: null,
    activeExecution: null,
    past: [],
    future: [],
    clipboard: null,
    dragSnapshotTaken: false,

    initialize(graph, nodeTypes) {
      const flowNodes: CanvasNode[] = graph.nodes.map((node) => ({
        id: node.id,
        type: 'ifn' as const,
        position: node.position,
        data: {
          nodeType: node.type,
          nodeVersion: node.nodeVersion,
          name: node.name,
          config: node.config,
          disabled: node.disabled,
          notes: node.notes,
        },
      }));
      const noteNodes: CanvasNode[] = graph.stickyNotes.map((note) => ({
        id: note.id,
        type: 'note' as const,
        position: note.position,
        data: { text: note.text },
      }));
      set({
        nodes: [...flowNodes, ...noteNodes],
        edges: graph.edges.map((edge) => ({
          id: edge.id,
          source: edge.source,
          sourceHandle: edge.sourcePort,
          target: edge.target,
          targetHandle: edge.targetPort,
        })),
        nodeTypes: new Map(nodeTypes.map((info) => [info.type, info])),
        saveState: 'saved',
        revision: 0,
        selectedNodeId: null,
        activeExecution: null,
        past: [],
        future: [],
      });
    },

    onNodesChange(changes) {
      // Snapshot al empezar un arrastre (una sola vez por gesto)
      const dragStart = changes.some(
        (change) => change.type === 'position' && change.dragging === true,
      );
      const dragEnd = changes.some(
        (change) => change.type === 'position' && change.dragging === false,
      );
      if (dragStart && !get().dragSnapshotTaken) {
        snapshot();
        set({ dragSnapshotTaken: true });
      }
      if (dragEnd) set({ dragSnapshotTaken: false });

      const removals = changes.filter((change) => change.type === 'remove');
      if (removals.length > 0 && !get().dragSnapshotTaken) snapshot();

      const structural = changes.some((change) => change.type === 'remove' || change.type === 'position');
      set((state) => ({
        nodes: applyNodeChanges(changes, state.nodes),
        ...(structural ? { revision: state.revision + 1, saveState: 'dirty' as const } : {}),
      }));
      const removedIds = removals.map((change) => change.id);
      if (removedIds.includes(get().selectedNodeId ?? '')) set({ selectedNodeId: null });
      if (removedIds.length > 0) {
        set((state) => ({
          edges: state.edges.filter(
            (edge) => !removedIds.includes(edge.source) && !removedIds.includes(edge.target),
          ),
        }));
      }
    },

    onEdgesChange(changes) {
      const structural = changes.some((change) => change.type === 'remove');
      if (structural) snapshot();
      set((state) => ({
        edges: applyEdgeChanges(changes, state.edges),
        ...(structural ? { revision: state.revision + 1, saveState: 'dirty' as const } : {}),
      }));
    },

    onConnect(connection) {
      if (!connection.source || !connection.target) return;
      if (connection.source === connection.target) return;
      const exists = get().edges.some(
        (edge) =>
          edge.source === connection.source &&
          edge.target === connection.target &&
          (edge.sourceHandle ?? 'main') === (connection.sourceHandle ?? 'main') &&
          (edge.targetHandle ?? 'main') === (connection.targetHandle ?? 'main'),
      );
      if (exists) return;
      snapshot();
      mutate({
        edges: [
          ...get().edges,
          {
            id: generateId('edge'),
            source: connection.source,
            sourceHandle: connection.sourceHandle ?? 'main',
            target: connection.target,
            targetHandle: connection.targetHandle ?? 'main',
          },
        ],
      });
    },

    addNode(type, position) {
      const info = get().nodeTypes.get(type);
      if (!info) return;
      snapshot();
      const id = generateId('node');
      mutate({
        nodes: [
          ...get().nodes,
          {
            id,
            type: 'ifn' as const,
            position,
            data: {
              nodeType: info.type,
              nodeVersion: info.version,
              name: info.displayName,
              config: structuredClone(info.defaultConfig),
              disabled: false,
              notes: '',
            },
          },
        ],
        selectedNodeId: id,
      });
    },

    addNote(position) {
      snapshot();
      const id = generateId('note');
      mutate({
        nodes: [...get().nodes, { id, type: 'note' as const, position, data: { text: '' } }],
      });
    },

    updateNodeData(nodeId, patch) {
      mutate({
        nodes: get().nodes.map((node) =>
          node.id === nodeId && isFlowNode(node) ? { ...node, data: { ...node.data, ...patch } } : node,
        ),
      });
    },

    updateNoteText(nodeId, text) {
      mutate({
        nodes: get().nodes.map((node) =>
          node.id === nodeId && node.type === 'note' ? { ...node, data: { text } } : node,
        ),
      });
    },

    duplicateNode(nodeId) {
      const original = get().nodes.find((node) => node.id === nodeId);
      if (!original || !isFlowNode(original)) return;
      snapshot();
      const id = generateId('node');
      mutate({
        nodes: [
          ...get().nodes,
          {
            ...original,
            id,
            position: { x: original.position.x + 48, y: original.position.y + 48 },
            selected: false,
            data: {
              ...original.data,
              config: structuredClone(original.data.config),
              name: `${original.data.name} (copia)`,
            },
          },
        ],
        selectedNodeId: id,
      });
    },

    removeNode(nodeId) {
      snapshot();
      mutate({
        nodes: get().nodes.filter((node) => node.id !== nodeId),
        edges: get().edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
        selectedNodeId: get().selectedNodeId === nodeId ? null : get().selectedNodeId,
      });
    },

    copySelection() {
      const selected = get().nodes.filter((node) => node.selected);
      if (selected.length === 0) return;
      const ids = new Set(selected.map((node) => node.id));
      set({
        clipboard: {
          nodes: selected.map((node) => ({ ...node, data: structuredClone(node.data) }) as CanvasNode),
          edges: get().edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)),
        },
      });
    },

    paste() {
      const { clipboard } = get();
      if (!clipboard || clipboard.nodes.length === 0) return;
      snapshot();
      const idMap = new Map<string, string>();
      const pastedNodes = clipboard.nodes.map((node) => {
        const id = generateId(node.type === 'note' ? 'note' : 'node');
        idMap.set(node.id, id);
        return {
          ...node,
          id,
          position: { x: node.position.x + 60, y: node.position.y + 60 },
          selected: true,
          data: structuredClone(node.data),
        } as CanvasNode;
      });
      const pastedEdges = clipboard.edges.map((edge) => ({
        ...edge,
        id: generateId('edge'),
        source: idMap.get(edge.source) as string,
        target: idMap.get(edge.target) as string,
      }));
      mutate({
        nodes: [
          ...get().nodes.map((node) => ({ ...node, selected: false }) as CanvasNode),
          ...pastedNodes,
        ],
        edges: [...get().edges, ...pastedEdges],
      });
    },

    undo() {
      const { past, nodes, edges, future } = get();
      const previous = past[past.length - 1];
      if (!previous) return;
      mutate({
        past: past.slice(0, -1),
        future: [...future, { nodes, edges }].slice(-HISTORY_LIMIT),
        nodes: previous.nodes,
        edges: previous.edges,
        selectedNodeId: null,
      });
    },

    redo() {
      const { future, nodes, edges, past } = get();
      const next = future[future.length - 1];
      if (!next) return;
      mutate({
        future: future.slice(0, -1),
        past: [...past, { nodes, edges }].slice(-HISTORY_LIMIT),
        nodes: next.nodes,
        edges: next.edges,
        selectedNodeId: null,
      });
    },

    setSelected(nodeId) {
      // Guardar contra re-setear el mismo valor: React Flow dispara
      // onSelectionChange en cada medición de nodos y un set idéntico
      // igual notifica a los suscriptores → bucle de renders.
      if (get().selectedNodeId === nodeId) return;
      set({ selectedNodeId: nodeId });
    },

    setSaveState(saveState) {
      set({ saveState });
    },

    setIssues(structureIssues, configIssues) {
      set({ structureIssues, configIssues });
    },

    markSaved(savedAt) {
      set({ saveState: 'saved', lastSavedAt: savedAt });
    },

    setActiveExecution(activeExecution) {
      set({ activeExecution });
    },

    toGraph() {
      const { nodes, edges } = get();
      return {
        nodes: nodes.filter(isFlowNode).map((node) => ({
          id: node.id,
          type: node.data.nodeType,
          nodeVersion: node.data.nodeVersion,
          name: node.data.name || node.data.nodeType,
          position: { x: Math.round(node.position.x), y: Math.round(node.position.y) },
          config: node.data.config,
          disabled: node.data.disabled,
          notes: node.data.notes,
        })),
        edges: edges.map((edge) => ({
          id: edge.id,
          source: edge.source,
          sourcePort: edge.sourceHandle ?? 'main',
          target: edge.target,
          targetPort: edge.targetHandle ?? 'main',
        })),
        stickyNotes: nodes
          .filter((node): node is NoteNode => node.type === 'note')
          .map((note) => ({
            id: note.id,
            position: { x: Math.round(note.position.x), y: Math.round(note.position.y) },
            width: 240,
            height: 120,
            text: note.data.text,
          })),
        groups: [],
      };
    },
  };
});
