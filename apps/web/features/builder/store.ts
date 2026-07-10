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
import type { GraphIssueDto, NodeConfigIssueDto, NodeTypeInfo } from '@/lib/types';

/** Datos que viajan dentro de cada nodo de React Flow */
export interface FlowNodeData extends Record<string, unknown> {
  nodeType: string;
  nodeVersion: number;
  name: string;
  config: Record<string, unknown>;
  disabled: boolean;
  notes: string;
}

export type BuilderNode = Node<FlowNodeData, 'ifn'>;
export type SaveState = 'loading' | 'saved' | 'dirty' | 'saving' | 'error';

function generateId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

interface BuilderState {
  nodes: BuilderNode[];
  edges: Edge[];
  nodeTypes: Map<string, NodeTypeInfo>;
  selectedNodeId: string | null;
  saveState: SaveState;
  /** Contador de mutaciones: dispara el autosave con debounce */
  revision: number;
  structureIssues: GraphIssueDto[];
  configIssues: NodeConfigIssueDto[];
  lastSavedAt: string | null;

  initialize(graph: WorkflowGraph, nodeTypes: NodeTypeInfo[]): void;
  onNodesChange(changes: NodeChange<BuilderNode>[]): void;
  onEdgesChange(changes: EdgeChange[]): void;
  onConnect(connection: Connection): void;
  addNode(type: string, position: { x: number; y: number }): void;
  updateNodeData(nodeId: string, patch: Partial<FlowNodeData>): void;
  duplicateNode(nodeId: string): void;
  removeNode(nodeId: string): void;
  setSelected(nodeId: string | null): void;
  setSaveState(state: SaveState): void;
  setIssues(structure: GraphIssueDto[], config: NodeConfigIssueDto[]): void;
  markSaved(savedAt: string): void;
  toGraph(): WorkflowGraph;
}

export const useBuilderStore = create<BuilderState>((set, get) => ({
  nodes: [],
  edges: [],
  nodeTypes: new Map(),
  selectedNodeId: null,
  saveState: 'loading',
  revision: 0,
  structureIssues: [],
  configIssues: [],
  lastSavedAt: null,

  initialize(graph, nodeTypes) {
    set({
      nodes: graph.nodes.map((node) => ({
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
      })),
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
    });
  },

  onNodesChange(changes) {
    const structural = changes.some((change) => change.type === 'remove' || change.type === 'position');
    set((state) => ({
      nodes: applyNodeChanges(changes, state.nodes),
      ...(structural ? { revision: state.revision + 1, saveState: 'dirty' as const } : {}),
    }));
    // Si se eliminó el nodo seleccionado, limpiar selección
    const removed = changes.filter((change) => change.type === 'remove').map((change) => change.id);
    if (removed.length > 0 && removed.includes(get().selectedNodeId ?? '')) {
      set({ selectedNodeId: null });
    }
  },

  onEdgesChange(changes) {
    const structural = changes.some((change) => change.type === 'remove');
    set((state) => ({
      edges: applyEdgeChanges(changes, state.edges),
      ...(structural ? { revision: state.revision + 1, saveState: 'dirty' as const } : {}),
    }));
  },

  onConnect(connection) {
    if (!connection.source || !connection.target) return;
    if (connection.source === connection.target) return;
    set((state) => {
      const exists = state.edges.some(
        (edge) =>
          edge.source === connection.source &&
          edge.target === connection.target &&
          (edge.sourceHandle ?? 'main') === (connection.sourceHandle ?? 'main') &&
          (edge.targetHandle ?? 'main') === (connection.targetHandle ?? 'main'),
      );
      if (exists) return state;
      return {
        edges: [
          ...state.edges,
          {
            id: generateId('edge'),
            source: connection.source,
            sourceHandle: connection.sourceHandle ?? 'main',
            target: connection.target,
            targetHandle: connection.targetHandle ?? 'main',
          },
        ],
        revision: state.revision + 1,
        saveState: 'dirty' as const,
      };
    });
  },

  addNode(type, position) {
    const info = get().nodeTypes.get(type);
    if (!info) return;
    const id = generateId('node');
    set((state) => ({
      nodes: [
        ...state.nodes,
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
      revision: state.revision + 1,
      saveState: 'dirty' as const,
    }));
  },

  updateNodeData(nodeId, patch) {
    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.id === nodeId ? { ...node, data: { ...node.data, ...patch } } : node,
      ),
      revision: state.revision + 1,
      saveState: 'dirty' as const,
    }));
  },

  duplicateNode(nodeId) {
    const original = get().nodes.find((node) => node.id === nodeId);
    if (!original) return;
    const id = generateId('node');
    set((state) => ({
      nodes: [
        ...state.nodes,
        {
          ...original,
          id,
          position: { x: original.position.x + 48, y: original.position.y + 48 },
          selected: false,
          data: { ...original.data, config: structuredClone(original.data.config), name: `${original.data.name} (copia)` },
        },
      ],
      selectedNodeId: id,
      revision: state.revision + 1,
      saveState: 'dirty' as const,
    }));
  },

  removeNode(nodeId) {
    set((state) => ({
      nodes: state.nodes.filter((node) => node.id !== nodeId),
      edges: state.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
      selectedNodeId: state.selectedNodeId === nodeId ? null : state.selectedNodeId,
      revision: state.revision + 1,
      saveState: 'dirty' as const,
    }));
  },

  setSelected(nodeId) {
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

  toGraph() {
    const { nodes, edges } = get();
    return {
      nodes: nodes.map((node) => ({
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
      stickyNotes: [],
      groups: [],
    };
  },
}));
