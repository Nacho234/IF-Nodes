/**
 * Agrupa los mensajes que llegan seguidos del mismo contacto.
 *
 * La gente no escribe un párrafo: escribe "hola!", después "queria consultar",
 * después "por las categorias". Son tres webhooks en dos segundos. Sin esto pasan
 * dos cosas malas: el bot contesta tres veces a una sola idea, y las tres
 * ejecuciones corren en paralelo cargando el mismo historial (ninguna ve a las
 * otras), así que las respuestas se pisan y se contradicen.
 *
 * Acá se espera una ventana corta desde el ÚLTIMO mensaje, se juntan todos en uno
 * y se ejecuta el flujo una sola vez. Además serializa por contacto: mientras corre
 * una ejecución, lo que llegue se acumula para la siguiente.
 */

type Run<T> = (message: T) => Promise<void>;
type Merge<T> = (messages: T[]) => T;
type Log = (level: 'info' | 'warn' | 'error', message: string, extra?: Record<string, unknown>) => void;

interface Pendiente<T> {
  mensajes: T[];
  timer: NodeJS.Timeout;
}

export class InboundBatcher<T> {
  private pendientes = new Map<string, Pendiente<T>>();
  /** Contactos con una ejecución en curso: lo que llegue espera a que termine. */
  private corriendo = new Set<string>();

  constructor(
    private readonly windowMs: number,
    private readonly merge: Merge<T>,
    private readonly run: Run<T>,
    private readonly log: Log = () => {},
  ) {}

  /** ¿Está desactivado? (ventana 0 = procesar cada mensaje al toque) */
  get disabled(): boolean {
    return this.windowMs <= 0;
  }

  push(key: string, message: T): void {
    if (this.disabled) {
      void this.ejecutar(key, [message]);
      return;
    }
    const actual = this.pendientes.get(key);
    if (actual) clearTimeout(actual.timer); // cada mensaje nuevo reinicia la espera

    const mensajes = actual ? [...actual.mensajes, message] : [message];
    const timer = setTimeout(() => void this.vaciar(key), this.windowMs);
    timer.unref?.();
    this.pendientes.set(key, { mensajes, timer });
  }

  private async vaciar(key: string): Promise<void> {
    const pendiente = this.pendientes.get(key);
    if (!pendiente) return;

    // Si ya hay una ejecución para este contacto, esperar: reprogramar la vuelta.
    if (this.corriendo.has(key)) {
      const timer = setTimeout(() => void this.vaciar(key), this.windowMs);
      timer.unref?.();
      this.pendientes.set(key, { ...pendiente, timer });
      return;
    }

    this.pendientes.delete(key);
    await this.ejecutar(key, pendiente.mensajes);
  }

  private async ejecutar(key: string, mensajes: T[]): Promise<void> {
    this.corriendo.add(key);
    try {
      if (mensajes.length > 1) this.log('info', 'Mensajes seguidos agrupados en uno', { contacto: key, cantidad: mensajes.length });
      await this.run(this.merge(mensajes));
    } catch (error) {
      this.log('error', 'Falló la ejecución del lote', {
        contacto: key,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.corriendo.delete(key);
      // Si llegó algo mientras corría, se procesa ya.
      if (this.pendientes.has(key)) void this.vaciar(key);
    }
  }

  /** Para los tests y el apagado ordenado: procesa todo lo pendiente ya. */
  async flushAll(): Promise<void> {
    for (const [key, p] of [...this.pendientes]) {
      clearTimeout(p.timer);
      this.pendientes.delete(key);
      await this.ejecutar(key, p.mensajes);
    }
  }
}

/** Ventana de agrupado. 0 la desactiva. */
export function debounceMsFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.INBOUND_DEBOUNCE_MS;
  if (raw === undefined) return 6000; // ~6s: alcanza para un "hola" + el mensaje real
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 60_000) : 6000;
}
