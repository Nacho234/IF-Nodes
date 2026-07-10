import base from '../../eslint.config.base.mjs';

export default [
  ...base,
  {
    rules: {
      // NestJS resuelve la inyección de dependencias con emitDecoratorMetadata:
      // convertir imports de servicios a `import type` los borra en runtime y
      // rompe la DI. Se desactiva la regla en la API a propósito.
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
];
