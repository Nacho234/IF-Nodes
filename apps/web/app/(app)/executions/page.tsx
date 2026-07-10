import { PlannedSection } from '@/components/shell/planned-section';

export default function ExecutionsPage() {
  return (
    <PlannedSection
      title="Ejecuciones"
      phase="Fases 3–4"
      description="Historial global de ejecuciones con debugging por nodo."
      bullets={[
        'Tabla global: proyecto, flujo, versión, trigger, estado, duración',
        'Detalle con camino recorrido, entrada/salida y logs por nodo',
        'Reintentos, ejecución desde un nodo y eventos en tiempo real',
      ]}
    />
  );
}
