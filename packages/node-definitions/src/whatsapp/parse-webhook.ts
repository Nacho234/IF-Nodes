import type { WhatsAppIncomingMessage } from '../nodes/trigger/whatsapp-trigger';

/**
 * Parsea el payload del webhook de WhatsApp Cloud (Meta) al formato interno.
 * Estructura Meta: entry[].changes[].value.{contacts[], messages[]}.
 * Pura y testeable; la usa el runtime exportado para cada mensaje entrante.
 */
export function parseWhatsAppWebhook(payload: unknown): WhatsAppIncomingMessage[] {
  const result: WhatsAppIncomingMessage[] = [];
  if (!payload || typeof payload !== 'object') return result;

  const entries = (payload as { entry?: unknown[] }).entry;
  if (!Array.isArray(entries)) return result;

  for (const entry of entries) {
    const changes = (entry as { changes?: unknown[] }).changes;
    if (!Array.isArray(changes)) continue;

    for (const change of changes) {
      const value = (change as { value?: unknown }).value;
      if (!value || typeof value !== 'object') continue;

      const contacts = (value as { contacts?: unknown[] }).contacts ?? [];
      const nameByWaId = new Map<string, string>();
      if (Array.isArray(contacts)) {
        for (const contact of contacts) {
          const waId = (contact as { wa_id?: string }).wa_id;
          const name = (contact as { profile?: { name?: string } }).profile?.name;
          if (waId && name) nameByWaId.set(waId, name);
        }
      }

      const messages = (value as { messages?: unknown[] }).messages;
      if (!Array.isArray(messages)) continue;

      for (const message of messages) {
        const from = (message as { from?: string }).from;
        if (!from) continue;
        const type = (message as { type?: string }).type ?? 'text';

        let text = '';
        let messageType: WhatsAppIncomingMessage['messageType'] = 'text';
        if (type === 'text') {
          text = (message as { text?: { body?: string } }).text?.body ?? '';
        } else if (type === 'button') {
          text = (message as { button?: { text?: string } }).button?.text ?? '';
          messageType = 'button';
        } else if (type === 'interactive') {
          const interactive = (message as { interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } } })
            .interactive;
          text = interactive?.button_reply?.title ?? interactive?.list_reply?.title ?? '';
          messageType = 'button';
        } else if (type === 'image' || type === 'audio' || type === 'location') {
          messageType = type;
          text = (message as { caption?: string }).caption ?? '';
        }

        result.push({
          text,
          phone: from,
          name: nameByWaId.get(from) ?? from,
          messageType,
          channel: 'whatsapp',
          receivedAt: new Date().toISOString(),
        });
      }
    }
  }
  return result;
}
