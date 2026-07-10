import { PlannedSection } from '@/components/shell/planned-section';

export default function IntegrationsPage() {
  return (
    <PlannedSection
      title="Integraciones"
      phase="Fase 7"
      description="Proveedores disponibles para usar desde los nodos."
      bullets={[
        'HTTP Request con protección SSRF',
        'IA multi-proveedor (OpenAI, Anthropic, Gemini, compatibles)',
        'WhatsApp Cloud API detrás de una interfaz de proveedor',
        'SMTP para envío de correos',
      ]}
    />
  );
}
