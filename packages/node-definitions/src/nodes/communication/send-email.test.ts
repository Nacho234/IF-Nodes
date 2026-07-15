import { describe, expect, it } from 'vitest';
import { sendEmailNode } from './send-email';
import { nodeRegistry } from '../../registry';
import {
  NodeExecutionError,
  type EmailSendInput,
  type NodeExecutionContext,
  type NodeLogger,
  type NodeServices,
} from '../../contract';

const silentLogger: NodeLogger = { debug() {}, info() {}, warn() {}, error() {} };

function ctx<C>(config: C, services: NodeServices): NodeExecutionContext<C, unknown> {
  return { config, input: {}, nodeId: 'n', executionId: 'e', logger: silentLogger, signal: new AbortController().signal, services };
}

const baseConfig = { credentialId: 'c1', to: 'x@y.com', subject: 'Hola', body: 'Cuerpo', html: false, from: '' };

describe('nodo Enviar email', () => {
  it('está registrado', () => {
    expect(nodeRegistry.all().map((d) => d.type)).toContain('communication.send-email');
  });

  it('llama al servicio de email con los datos y devuelve el resultado', async () => {
    const sent: EmailSendInput[] = [];
    const services: NodeServices = {
      email: {
        async send(input) {
          sent.push(input);
          return { to: input.to, subject: input.subject, sent: true, simulated: false, messageId: 'm1' };
        },
      },
    };
    const result = await sendEmailNode.execute(ctx(baseConfig, services));
    expect(sent[0]!.to).toBe('x@y.com');
    expect(sent[0]!.text).toBe('Cuerpo');
    expect((result as { output: { messageId: string } }).output.messageId).toBe('m1');
  });

  it('manda el cuerpo como html cuando html=true', async () => {
    let received: EmailSendInput | undefined;
    const services: NodeServices = {
      email: {
        async send(input) {
          received = input;
          return { to: input.to, subject: input.subject, sent: true, simulated: false };
        },
      },
    };
    await sendEmailNode.execute(ctx({ ...baseConfig, html: true, body: '<b>hola</b>' }, services));
    expect(received!.html).toBe('<b>hola</b>');
    expect(received!.text).toBe('');
  });

  it('sin servicio de email lanza error claro', async () => {
    await expect(sendEmailNode.execute(ctx(baseConfig, {}))).rejects.toBeInstanceOf(NodeExecutionError);
  });
});
