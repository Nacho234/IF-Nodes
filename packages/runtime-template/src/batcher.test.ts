import { describe, expect, it } from 'vitest';
import { InboundBatcher, debounceMsFromEnv } from './batcher';

type Msg = { text: string };
const merge = (ms: Msg[]) => ({ text: ms.map((m) => m.text).join('\n') });
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('InboundBatcher', () => {
  it('junta los mensajes seguidos en UNA sola ejecución', async () => {
    const corridas: Msg[] = [];
    const b = new InboundBatcher<Msg>(40, merge, async (m) => { corridas.push(m); });
    b.push('549111', { text: 'hola!' });
    b.push('549111', { text: 'queria consultar' });
    b.push('549111', { text: 'por las categorias' });
    await esperar(120);
    expect(corridas).toHaveLength(1); // una respuesta, no tres
    expect(corridas[0]!.text).toBe('hola!\nqueria consultar\npor las categorias');
  });

  it('cada mensaje nuevo reinicia la espera', async () => {
    const corridas: Msg[] = [];
    const b = new InboundBatcher<Msg>(60, merge, async (m) => { corridas.push(m); });
    b.push('a', { text: '1' });
    await esperar(30);
    b.push('a', { text: '2' }); // llega antes de que venza: reinicia la ventana
    expect(corridas).toHaveLength(0);
    await esperar(120);
    expect(corridas).toHaveLength(1);
    expect(corridas[0]!.text).toBe('1\n2');
  });

  it('contactos distintos no se mezclan', async () => {
    const corridas: Msg[] = [];
    const b = new InboundBatcher<Msg>(30, merge, async (m) => { corridas.push(m); });
    b.push('ana', { text: 'hola' });
    b.push('juan', { text: 'buenas' });
    await esperar(100);
    expect(corridas.map((c) => c.text).sort()).toEqual(['buenas', 'hola']);
  });

  it('serializa: lo que llega mientras corre espera y no se pierde', async () => {
    const orden: string[] = [];
    const b = new InboundBatcher<Msg>(20, merge, async (m) => {
      orden.push('inicio:' + m.text);
      await esperar(80); // ejecución lenta
      orden.push('fin:' + m.text);
    });
    b.push('ana', { text: 'primero' });
    await esperar(45); // ya arrancó la primera
    b.push('ana', { text: 'segundo' }); // llega en el medio
    await esperar(300);
    // La segunda no puede empezar antes de que termine la primera: si no,
    // ambas cargarían el mismo historial y las respuestas se pisarían.
    expect(orden).toEqual(['inicio:primero', 'fin:primero', 'inicio:segundo', 'fin:segundo']);
  });

  it('un error en una ejecución no traba al contacto', async () => {
    const corridas: string[] = [];
    const b = new InboundBatcher<Msg>(20, merge, async (m) => {
      corridas.push(m.text);
      if (m.text === 'malo') throw new Error('explotó');
    });
    b.push('ana', { text: 'malo' });
    await esperar(80);
    b.push('ana', { text: 'bueno' });
    await esperar(80);
    expect(corridas).toEqual(['malo', 'bueno']); // el segundo igual corre
  });

  it('con ventana 0 procesa al toque, sin agrupar', async () => {
    const corridas: Msg[] = [];
    const b = new InboundBatcher<Msg>(0, merge, async (m) => { corridas.push(m); });
    expect(b.disabled).toBe(true);
    b.push('ana', { text: 'uno' });
    b.push('ana', { text: 'dos' });
    await esperar(40);
    expect(corridas).toHaveLength(2);
  });
});

describe('debounceMsFromEnv', () => {
  it('6s por defecto', () => expect(debounceMsFromEnv({})).toBe(6000));
  it('se puede apagar con 0', () => expect(debounceMsFromEnv({ INBOUND_DEBOUNCE_MS: '0' })).toBe(0));
  it('se puede configurar, con techo de 60s', () => {
    expect(debounceMsFromEnv({ INBOUND_DEBOUNCE_MS: '3000' })).toBe(3000);
    expect(debounceMsFromEnv({ INBOUND_DEBOUNCE_MS: '999999' })).toBe(60_000);
  });
  it('un valor basura cae al default', () => expect(debounceMsFromEnv({ INBOUND_DEBOUNCE_MS: 'x' })).toBe(6000));
});
