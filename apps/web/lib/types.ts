import type {
  ClientStatus,
  Permission,
  ProjectStatus,
  ProjectType,
  UserRole,
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
