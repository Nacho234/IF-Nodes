/**
 * Cliente mínimo de WhatsApp Cloud API (Meta). Puro: recibe las credenciales
 * ya resueltas. El worker las toma de la DB; el runtime, de variables de entorno.
 */
export async function sendWhatsAppText(input: {
  accessToken: string;
  phoneNumberId: string;
  to: string;
  text: string;
}): Promise<{ messageId?: string }> {
  const response = await fetch(`https://graph.facebook.com/v20.0/${input.phoneNumberId}/messages`, {
    method: 'POST',
    headers: { authorization: `Bearer ${input.accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: input.to,
      type: 'text',
      text: { body: input.text },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`WhatsApp Cloud respondió HTTP ${response.status}: ${detail.slice(0, 200)}`);
  }
  const json = (await response.json()) as { messages?: { id?: string }[] };
  return { messageId: json.messages?.[0]?.id };
}
