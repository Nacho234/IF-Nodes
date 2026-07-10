import { PlannedSection } from '@/components/shell/planned-section';

export default function SettingsPage() {
  return (
    <PlannedSection
      title="Configuración"
      phase="Fase 10"
      description="Preferencias del equipo y administración de usuarios."
      bullets={[
        'Gestión de usuarios autorizados y roles (hoy: AUTHORIZED_EMAILS en .env)',
        'Límites del motor (pasos máximos, timeouts)',
        'Auditoría consultable desde la UI',
      ]}
    />
  );
}
