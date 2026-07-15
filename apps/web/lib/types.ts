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
    widget: 'text' | 'textarea' | 'code' | 'select' | 'switch' | 'number' | 'keyvalue' | 'credential';
    options?: { value: string; label: string }[];
    placeholder?: string;
    supportsExpressions?: boolean;
    credentialTypes?: string[];
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

/* ── Plantillas ────────────────────────────────────────────── */

export interface TemplateInfo {
  slug: string;
  name: string;
  description: string;
  category: string;
  projectType: ProjectType;
  requiredIntegrations: string[];
  nodeCount: number;
}

/* ── Usuarios / equipo ─────────────────────────────────────── */

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  active: boolean;
  createdAt: string;
}

/* ── Variables por entorno ─────────────────────────────────── */

export interface EnvVarView {
  id: string;
  key: string;
  secret: boolean;
  value: string;
  masked: boolean;
}

export interface EnvironmentView {
  id: string;
  kind: string;
  variables: EnvVarView[];
}

/* ── Exportaciones ─────────────────────────────────────────── */

export interface ExportResult {
  id: string;
  slug: string;
  folder: string;
  zipPath: string;
  sizeBytes: number;
  manifest: {
    project: string;
    workflowVersion: string;
    entrypoints: string[];
    requiredEnvironmentVariables: string[];
    healthEndpoint: string;
  };
  requiredEnvVars: { name: string; hint: string }[];
  /** Presente en exports de proyecto completo (multi-flow). */
  flows?: { name: string; slug: string }[];
}

export interface ExportRow {
  id: string;
  status: string;
  format: string;
  sizeBytes: number | null;
  createdAt: string;
  version: { number: number } | null;
  project: { id: string; name: string; client: { name: string } };
  createdBy: { name: string } | null;
}

/* ── Versiones ─────────────────────────────────────────────── */

export interface VersionRow {
  id: string;
  number: number;
  description: string | null;
  isStable: boolean;
  createdAt: string;
  createdBy: { name: string } | null;
}

export interface GraphDiffDto {
  nodesAdded: { id: string; name: string; type: string }[];
  nodesRemoved: { id: string; name: string; type: string }[];
  nodesModified: { id: string; name: string; changes: string[] }[];
  edgesAdded: number;
  edgesRemoved: number;
  hasChanges: boolean;
}

export interface CompareResponse {
  from: string;
  to: string;
  diff: GraphDiffDto;
}

/* ── Credenciales ──────────────────────────────────────────── */

export interface CredentialTypeDef {
  slug: string;
  name: string;
  description: string;
  fields: { key: string; label: string; secret: boolean; placeholder?: string }[];
  verifiable: boolean;
}

export interface CredentialView {
  id: string;
  name: string;
  integrationSlug: string;
  integrationName: string;
  environment: string;
  projectId: string | null;
  active: boolean;
  lastVerifiedAt: string | null;
  maskedHint: string | null;
  publicFields: Record<string, string>;
  createdAt: string;
}

/* ── Casos de prueba ───────────────────────────────────────── */

export interface AssertionResultDto {
  assertion: { id: string; kind: string; path: string; expected: string; nodeId: string };
  passed: boolean;
  actual: unknown;
  message: string;
}

export interface TestCaseRow {
  id: string;
  projectId: string;
  workflowId: string | null;
  name: string;
  description: string | null;
  input: Record<string, unknown>;
  assertions: { id: string; kind: string; path: string; expected: string; nodeId: string }[];
  lastRunAt: string | null;
  lastRunStatus: string | null;
  lastRunDetail: {
    executionId?: string;
    executionStatus?: string;
    results?: AssertionResultDto[];
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface EvaluateResponse {
  passed: boolean;
  executionStatus: string;
  results: AssertionResultDto[];
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
