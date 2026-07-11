import { PlannedSection } from '@/components/shell/planned-section';

export default function ExportsPage() {
  return (
    <PlannedSection
      title="Exportaciones"
      description="Generación del runtime independiente listo para producción."
      bullets={[
        'Runtime genérico + workflow.json + manifest.json',
        'ZIP descargable o carpeta local',
        'Dockerfile, railway.json, .env.example y README de despliegue',
        'Solo nodos e integraciones que el flujo usa',
      ]}
    />
  );
}
