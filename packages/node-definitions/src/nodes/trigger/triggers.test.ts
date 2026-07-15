import { describe, expect, it } from 'vitest';
import { whatsappTriggerNode } from './whatsapp-trigger';
import { emailTriggerNode } from './email-trigger';

const wa = (input: Record<string, unknown>) =>
  whatsappTriggerNode.execute({ config: whatsappTriggerNode.defaultConfig, input } as never);
const mail = (input: Record<string, unknown>) =>
  emailTriggerNode.execute({ config: emailTriggerNode.defaultConfig, input } as never);

describe('trigger.whatsapp-message', () => {
  it('un mensaje de texto pasa tal cual', async () => {
    const r = await wa({ text: 'hola', phone: '5491777', name: 'Agencia' });
    expect(r.output).toMatchObject({ text: 'hola', phone: '5491777', name: 'Agencia' });
  });

  // El bug: se decidía "es real" por el texto, así que un audio (que no trae texto)
  // hacía que se descartara el mensaje ENTERO y el bot le respondiera al teléfono de ejemplo.
  it('una nota de voz NO puede convertir el mensaje en el de ejemplo', async () => {
    const r = await wa({ text: '', phone: '5491777', name: 'Agencia Audio', messageType: 'audio' });
    expect(r.output.phone).toBe('5491777');                    // el real, no samplePhone
    expect(r.output.name).toBe('Agencia Audio');
    expect(r.output.text).not.toBe(whatsappTriggerNode.defaultConfig.sampleText);
    expect(r.output.text).toContain('nota de voz');            // describe qué mandó
  });

  it('una imagen sin epígrafe tampoco', async () => {
    const r = await wa({ text: '', phone: '5491777', messageType: 'image' });
    expect(r.output.phone).toBe('5491777');
    expect(r.output.text).toContain('imagen');
  });

  it('una imagen CON epígrafe usa el epígrafe', async () => {
    const r = await wa({ text: 'mirá esta pieza', phone: '5491777', messageType: 'image' });
    expect(r.output.text).toBe('mirá esta pieza');
  });

  it('sin teléfono (ejecución manual desde el builder) sí usa los ejemplos', async () => {
    const r = await wa({});
    expect(r.output.phone).toBe(whatsappTriggerNode.defaultConfig.samplePhone);
    expect(r.output.text).toBe(whatsappTriggerNode.defaultConfig.sampleText);
  });
});

describe('trigger.email-message', () => {
  it('un mail normal pasa tal cual', async () => {
    const r = await mail({ text: 'consulta', from: 'Ana@Agencia.com', subject: 'Hola' });
    expect(r.output).toMatchObject({ text: 'consulta', from: 'ana@agencia.com', subject: 'Hola' });
  });

  it('un mail solo con adjunto no puede convertirse en el de ejemplo', async () => {
    const r = await mail({ text: '', from: 'ana@agencia.com', subject: 'La pieza' });
    expect(r.output.from).toBe('ana@agencia.com');             // no sampleFrom
    expect(r.output.subject).toBe('La pieza');
    expect(r.output.text).toContain('adjunto');
  });

  it('sin remitente (ejecución manual) sí usa los ejemplos', async () => {
    const r = await mail({});
    expect(r.output.from).toBe(emailTriggerNode.defaultConfig.sampleFrom);
  });
});
