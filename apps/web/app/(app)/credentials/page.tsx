import { PlannedSection } from '@/components/shell/planned-section';

export default function CredentialsPage() {
  return (
    <PlannedSection
      title="Credenciales"
      phase="Fase 7"
      description="Gestor interno de credenciales cifradas por proyecto y entorno."
      bullets={[
        'WhatsApp Cloud, OpenAI, Anthropic, Gemini, SMTP, PostgreSQL…',
        'Cifrado AES-256-GCM; el secreto nunca vuelve al frontend',
        'Prueba de conexión, rotación y duplicado entre entornos',
      ]}
    />
  );
}
