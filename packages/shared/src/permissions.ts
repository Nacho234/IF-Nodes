/**
 * Roles globales del equipo y matriz de permisos.
 * La autorización SIEMPRE se valida en backend (guards de NestJS);
 * la UI solo usa esto para ocultar acciones no disponibles.
 */
export const USER_ROLES = ['OWNER', 'DEVELOPER', 'TESTER', 'VIEWER'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const PERMISSIONS = [
  'clients.read',
  'clients.write',
  'projects.read',
  'projects.write',
  'workflows.read',
  'workflows.write',
  'executions.read',
  'executions.run',
  'testcases.read',
  'testcases.write',
  'credentials.read',
  'credentials.write',
  'versions.read',
  'versions.write',
  'exports.read',
  'exports.create',
  'users.manage',
  'audit.read',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL: readonly Permission[] = PERMISSIONS;

const READ_ONLY: readonly Permission[] = [
  'clients.read',
  'projects.read',
  'workflows.read',
  'executions.read',
  'testcases.read',
  'versions.read',
  'exports.read',
];

const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  OWNER: ALL,
  DEVELOPER: [
    ...READ_ONLY,
    'clients.write',
    'projects.write',
    'workflows.write',
    'executions.run',
    'testcases.write',
    'credentials.read',
    'credentials.write',
    'versions.write',
    'exports.create',
  ],
  TESTER: [...READ_ONLY, 'executions.run', 'testcases.write'],
  VIEWER: READ_ONLY,
};

export function roleHasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function permissionsForRole(role: UserRole): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}
