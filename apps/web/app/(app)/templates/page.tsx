import { PlannedSection } from '@/components/shell/planned-section';

export default function TemplatesPage() {
  return (
    <PlannedSection
      title="Plantillas"
      description="Proyectos y flujos reutilizables como punto de partida."
      bullets={[
        'Guardar un proyecto o flujo como plantilla interna',
        'Bot básico de WhatsApp, turnos, FAQ, leads, derivación humana',
        'Uso de plantilla con variables y credenciales requeridas',
      ]}
    />
  );
}
