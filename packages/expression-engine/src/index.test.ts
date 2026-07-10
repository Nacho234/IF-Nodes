import { describe, expect, it } from 'vitest';
import { evaluateExpression, ExpressionError, hasExpressions, resolveDeep, resolveTemplate } from './index';

const ctx = {
  trigger: { text: 'Hola, quiero un turno', contact: { phone: '5493410000000' } },
  nodes: {
    findCustomer: { output: { customerId: 42, tags: ['vip', 'nuevo'] } },
  },
  variables: { companyName: 'Dermafisherton' },
  environment: { API_URL: 'https://api.ejemplo.com' },
};

describe('evaluateExpression — paths', () => {
  it('resuelve paths anidados', () => {
    expect(evaluateExpression('trigger.text', ctx)).toBe('Hola, quiero un turno');
    expect(evaluateExpression('nodes.findCustomer.output.customerId', ctx)).toBe(42);
    expect(evaluateExpression('environment.API_URL', ctx)).toBe('https://api.ejemplo.com');
  });

  it('resuelve índices de array', () => {
    expect(evaluateExpression('nodes.findCustomer.output.tags[0]', ctx)).toBe('vip');
  });

  it('devuelve undefined para paths inexistentes (sin explotar)', () => {
    expect(evaluateExpression('trigger.noExiste.tampoco', ctx)).toBeUndefined();
  });

  it('bloquea el acceso a prototipos', () => {
    expect(evaluateExpression('trigger.__proto__', ctx)).toBeUndefined();
    expect(evaluateExpression('constructor', ctx)).toBeUndefined();
    expect(evaluateExpression('trigger.constructor', ctx)).toBeUndefined();
  });

  it('literales', () => {
    expect(evaluateExpression('true', ctx)).toBe(true);
    expect(evaluateExpression('"texto"', ctx)).toBe('texto');
    expect(evaluateExpression('-3.5', ctx)).toBe(-3.5);
    expect(evaluateExpression('null', ctx)).toBeNull();
  });
});

describe('evaluateExpression — funciones', () => {
  it('whitelist básica', () => {
    expect(evaluateExpression('uppercase(variables.companyName)', ctx)).toBe('DERMAFISHERTON');
    expect(evaluateExpression('lowercase("HOLA")', ctx)).toBe('hola');
    expect(evaluateExpression('trim("  x  ")', ctx)).toBe('x');
    expect(evaluateExpression('length(nodes.findCustomer.output.tags)', ctx)).toBe(2);
    expect(evaluateExpression('contains(trigger.text, "turno")', ctx)).toBe(true);
    expect(evaluateExpression('number("42")', ctx)).toBe(42);
    expect(evaluateExpression('string(nodes.findCustomer.output.customerId)', ctx)).toBe('42');
  });

  it('default() con valores vacíos', () => {
    expect(evaluateExpression('default(trigger.nombre, "amigo")', ctx)).toBe('amigo');
    expect(evaluateExpression('default(trigger.text, "amigo")', ctx)).toBe('Hola, quiero un turno');
  });

  it('funciones anidadas', () => {
    expect(evaluateExpression('uppercase(default(trigger.nombre, "amigo"))', ctx)).toBe('AMIGO');
  });

  it('fechas', () => {
    expect(evaluateExpression('formatDate("2026-07-10T12:00:00Z", "DD/MM/YYYY")', ctx)).toMatch(
      /^\d{2}\/\d{2}\/2026$/,
    );
    expect(evaluateExpression('addDays("2026-07-10T00:00:00Z", 2)', ctx)).toContain('2026-07-12');
    expect(evaluateExpression('subtractDays("2026-07-10T00:00:00Z", 10)', ctx)).toContain('2026-06-30');
  });

  it('rechaza funciones fuera de la whitelist', () => {
    expect(() => evaluateExpression('eval("x")', ctx)).toThrow(ExpressionError);
    expect(() => evaluateExpression('require("fs")', ctx)).toThrow(ExpressionError);
  });

  it('errores claros de sintaxis', () => {
    expect(() => evaluateExpression('uppercase(', ctx)).toThrow(ExpressionError);
    expect(() => evaluateExpression('"sin cerrar', ctx)).toThrow(ExpressionError);
    expect(() => evaluateExpression('number("abc")', ctx)).toThrow(ExpressionError);
  });
});

describe('resolveTemplate', () => {
  it('expresión única devuelve el valor crudo (objetos incluidos)', () => {
    expect(resolveTemplate('{{nodes.findCustomer.output}}', ctx)).toEqual({
      customerId: 42,
      tags: ['vip', 'nuevo'],
    });
    expect(resolveTemplate('{{nodes.findCustomer.output.customerId}}', ctx)).toBe(42);
  });

  it('interpola dentro de texto', () => {
    expect(resolveTemplate('Hola {{variables.companyName}}, tel {{trigger.contact.phone}}', ctx)).toBe(
      'Hola Dermafisherton, tel 5493410000000',
    );
  });

  it('texto sin expresiones queda igual', () => {
    expect(resolveTemplate('sin cambios', ctx)).toBe('sin cambios');
    expect(hasExpressions('sin cambios')).toBe(false);
    expect(hasExpressions('con {{x}}')).toBe(true);
  });
});

describe('resolveDeep', () => {
  it('resuelve strings dentro de objetos y arrays', () => {
    const config = {
      message: 'Hola {{variables.companyName}}',
      raw: '{{nodes.findCustomer.output.tags}}',
      nested: [{ value: '{{trigger.contact.phone}}' }],
      untouched: 7,
    };
    expect(resolveDeep(config, ctx)).toEqual({
      message: 'Hola Dermafisherton',
      raw: ['vip', 'nuevo'],
      nested: [{ value: '5493410000000' }],
      untouched: 7,
    });
  });
});
