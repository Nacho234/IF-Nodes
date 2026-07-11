import type {
  ClientStatus,
  ExecutionStatus,
  Permission,
  ProjectStatus,
  ProjectType,
  StepStatus,
  UserRole,
  WorkflowError,
} from '@ifnodes/shared';

/** Formas de respuesta de la API consumidas por la web. */

export interface Me {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  role: UserRole;
  permissions: Permission[];
}

export interface AuthMethods {
  google: boolean;
  devLogin: boolean;
}

export interface ClientRow {
  id: string;
  name: string;
  legalName: string | null;
  industry: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  status: ClientStatus;
  internalNotes: string | null;
  createdAt: string;
  updatedAt: string;
  _count: { projects: number };
}

export interface ProjectRow {
  id: string;
  clientId: string;
  name: string;
  description: string | null;
  type: ProjectType;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
  client: { id: string; name: string };
  owner: { id: string; name: string } | null;
  workflows: { id: string; name: string }[];
  _count: { workflows: number; executions: number };
}

export interface ProjectDetail {
  id: string;
  clientId: string;
  name: string;
  description: string | null;
  type: ProjectType;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
  client: { id: string; name: string; status: ClientStatus };
  owner: { id: string; name: string; email: string } | null;
  workflows: { id: string; name: string; isMain: boolean; updatedAt: string }[];
  environments: { id: string; kind: string }[];
  _count: { executions: number; testCases: number; exports: number };
}

export interface WorkflowDetail {
  id: string;
  projectId: string;
  name: string;
  isMain: boolean;
  webhookToken: string;
  draftGraph: unknown;
  updatedAt: string;
  project: { id: string; name: string; clientId: string; client: { name: string } };
  versions: { id: string; number: number; isStable: boolean; createdAt: string }[];
}

export interface NodeTypeInfo {
  type: string;
  version: number;
  category: string;
  displayName: string;
  description: string;
  icon: string;
  inputs: { id: string; label: string }[];
  outputs: { id: string; label: string }[];
  defaultConfig: Record<string, unknown>;
  uiHints: {
    field: string;
    label: string;
    helpText?: string;
    widget: 'text' | 'textarea' | 'code' | 'select' | 'switch' | 'number' | 'keyvalue';
    options?: { value: string; label: string }[];
    placeholder?: string;
    supportsExpressions?: boolean;
  }[];
  outputVariables: { path: string; description: string }[];
  documentation: string;
  exportable: boolean;
}

export interface GraphIssueDto {
  level: 'error' | 'warning';
  code: string;
  message: string;
  nodeId?: string;
}

export interface NodeConfigIssueDto {
  nodeId: string;
  nodeName: string;
  field: string;
  message: string;
}

export interface SaveDraftResponse {
  id: string;
  savedAt: string;
  structureIssues: GraphIssueDto[];
  configIssues: NodeConfigIssueDto[];
}

/* ── Ejecuciones ───────────────────────────────────────────── */

export interface ExecutionRow {
  id: string;
  projectId: string;
  workflowId: string;
  status: ExecutionStatus;
  source: string;
  environment: string;
  triggerType: string;
  failedNodeId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  createdAt: string;
  project: { id: string; name: string; client: { name: string } };
  workflow: { id: string; name: string };
  version: { number: number } | null;
  _count: { steps: number };
}

export interface ExecutionStepRow {
  id: string;
  nodeId: string;
  nodeType: string;
  nodeVersion: number;
  nodeName: string;
  status: StepStatus;
  input: unknown;
  output: unknown;
  error: WorkflowError | null;
  attempt: number;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  order: number;
}

export interface ExecutionLogRow {
  id: string;
  nodeId: string | null;
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  message: string;
  data: unknown;
  createdAt: string;
}

export interface ExecutionDetail {
  id: string;
  projectId: string;
  workflowId: string;
  versionId: string | null;
  status: ExecutionStatus;
  source: string;
  environment: string;
  triggerType: string;
  triggerData: unknown;
  context: { nodeOutputs?: Record<string, unknown>; finalOutput?: unknown } | null;
  error: WorkflowError | null;
  failedNodeId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  createdAt: string;
  project: { id: string; name: string };
  workflow: { id: string; name: string };
  version: { number: number } | null;
  steps: ExecutionStepRow[];
  logs: ExecutionLogRow[];
}
