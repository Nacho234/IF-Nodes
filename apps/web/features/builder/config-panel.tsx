'use client';

import { Copy, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CodeTextarea, Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/misc';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { isFlowNode, useBuilderStore } from './store';
import { categoryColor, nodeIcon } from './node-visuals';
import { api } from '@/lib/api';
import type { CredentialView, NodeTypeInfo } from '@/lib/types';

/** Selector de credencial para el widget 'credential'; filtra por tipo aceptado. */
function CredentialSelect({
  value,
  credentialTypes,
  onChange,
  fieldId,
}: {
  value: string;
  credentialTypes: string[];
  onChange: (value: string) => void;
  fieldId: string;
}) {
  const credentials = useQuery({
    queryKey: ['credentials'],
    queryFn: () => api.get<CredentialView[]>('/credentials'),
    staleTime: 30_000,
  });
  const options = (credentials.data ?? []).filter(
    (cred) => credentialTypes.length === 0 || credentialTypes.includes(cred.integrationSlug),
  );
  const NONE = '__none__';
  return (
    <div className="space-y-1">
      <Select value={value || NONE} onValueChange={(v) => onChange(v === NONE ? '' : v)}>
        <SelectTrigger id={fieldId}>
          <SelectValue placeholder="Sin credencial (modo desarrollo)" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>Sin credencial (modo desarrollo)</SelectItem>
          {options.map((cred) => (
            <SelectItem key={cred.id} value={cred.id}>
              {cred.name} · {cred.integrationName}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {!credentials.isLoading && options.length === 0 ? (
        <p className="text-[11px] text-faint-foreground">
          No hay credenciales de este tipo.{' '}
          <Link href="/credentials" className="text-accent hover:underline">
            Crear una
          </Link>
        </p>
      ) : null}
    </div>
  );
}

function JsonPreview({ value }: { value: unknown }) {
  return (
    <pre className="max-h-40 overflow-auto rounded-md border border-border bg-surface-sunken p-2 font-mono text-[10.5px] leading-4 whitespace-pre-wrap">
      {value === undefined ? '—' : JSON.stringify(value, null, 2)}
    </pre>
  );
}

/**
 * Panel derecho: configuración del nodo seleccionado.
 * El formulario se genera desde los uiHints de la definición del nodo,
 * de modo que agregar un nodo nuevo no requiere tocar este componente.
 */
export function ConfigPanel({ webhookToken }: { webhookToken?: string }) {
  const selectedNodeId = useBuilderStore((state) => state.selectedNodeId);
  const node = useBuilderStore((state) => {
    const found = state.nodes.find((n) => n.id === state.selectedNodeId);
    return found && isFlowNode(found) ? found : undefined;
  });
  const info = useBuilderStore((state) => (node ? state.nodeTypes.get(node.data.nodeType) : undefined));
  const lastStep = useBuilderStore((state) => {
    const steps = state.activeExecution?.steps;
    if (!steps || !state.selectedNodeId) return undefined;
    for (let i = steps.length - 1; i >= 0; i--) {
      if (steps[i]?.nodeId === state.selectedNodeId) return steps[i];
    }
    return undefined;
  });
  const configIssues = useBuilderStore((state) =>
    state.configIssues.filter((issue) => issue.nodeId === selectedNodeId),
  );
  const updateNodeData = useBuilderStore((state) => state.updateNodeData);
  const duplicateNode = useBuilderStore((state) => state.duplicateNode);
  const removeNode = useBuilderStore((state) => state.removeNode);

  if (!node || !info) {
    return (
      <aside className="w-80 shrink-0 border-l border-border bg-surface p-4" aria-label="Configuración del nodo">
        <p className="mt-8 text-center text-[13px] text-faint-foreground">
          Seleccioná un nodo para ver su configuración.
        </p>
      </aside>
    );
  }

  const Icon = nodeIcon(info.icon);
  const color = categoryColor(info.category);
  const setConfigValue = (field: string, value: unknown) => {
    updateNodeData(node.id, { config: { ...node.data.config, [field]: value } });
  };

  return (
    <aside
      className="flex w-80 shrink-0 flex-col overflow-y-auto border-l border-border bg-surface"
      aria-label="Configuración del nodo"
    >
      {/* Encabezado del nodo */}
      <div className="border-b border-border p-4">
        <div className="flex items-start gap-2.5">
          <span
            className="flex size-8 shrink-0 items-center justify-center rounded-md"
            style={{ background: `color-mix(in srgb, ${color} 15%, transparent)`, color }}
          >
            <Icon className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <Input
              value={node.data.name}
              onChange={(event) => updateNodeData(node.id, { name: event.target.value })}
              aria-label="Nombre del nodo"
              className="h-8 font-medium"
            />
            <p className="mt-1 text-[11px] text-faint-foreground">
              {info.displayName} · <span className="font-mono">{info.type}@v{info.version}</span>
            </p>
          </div>
        </div>
        {info.documentation ? (
          <p className="mt-3 text-[11.5px] leading-4.5 text-muted-foreground">{info.documentation}</p>
        ) : null}
      </div>

      {/* Problemas de configuración detectados por el backend */}
      {configIssues.length > 0 ? (
        <div className="border-b border-border bg-warning-soft/60 px-4 py-3">
          <p className="text-[11px] font-semibold text-warning uppercase">Configuración incompleta</p>
          <ul className="mt-1 space-y-0.5 text-[12px] text-warning">
            {configIssues.map((issue, index) => (
              <li key={index}>
                {issue.field ? <code className="font-mono">{issue.field}</code> : null} {issue.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Configuración generada desde uiHints */}
      <div className="flex-1 space-y-4 p-4">
        {/* URL pública del webhook (solo para el trigger de webhook) */}
        {node.data.nodeType === 'trigger.webhook' && webhookToken ? (
          <div className="space-y-1.5">
            <Label>URL del webhook</Label>
            <div className="flex items-center gap-1.5">
              <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-surface-sunken px-2 py-1.5 font-mono text-[10.5px]">
                POST /api/hooks/{webhookToken}
              </code>
              <Button
                variant="secondary"
                size="icon-sm"
                aria-label="Copiar URL del webhook"
                title="Copiar URL completa"
                onClick={() =>
                  void navigator.clipboard.writeText(`${window.location.origin}/api/hooks/${webhookToken}`)
                }
              >
                <Copy />
              </Button>
            </div>
            <p className="text-[11px] leading-4 text-faint-foreground">
              Responde 202 con el id de ejecución. El cuerpo JSON queda disponible como{' '}
              <code className="font-mono">{'{{trigger.*}}'}</code>.
            </p>
          </div>
        ) : null}
        {info.uiHints.map((hint) => {
          const raw = node.data.config[hint.field];
          const fieldId = `cfg-${node.id}-${hint.field}`;
          return (
            <div key={hint.field} className="space-y-1.5">
              <Label htmlFor={fieldId}>
                {hint.label}
                {hint.supportsExpressions ? (
                  <span className="ml-1.5 rounded bg-accent-soft px-1 py-px font-mono text-[9px] text-accent">
                    {'{{ }}'}
                  </span>
                ) : null}
              </Label>

              {hint.widget === 'text' ? (
                <Input
                  id={fieldId}
                  value={String(raw ?? '')}
                  placeholder={hint.placeholder}
                  onChange={(event) => setConfigValue(hint.field, event.target.value)}
                />
              ) : hint.widget === 'textarea' ? (
                <Textarea
                  id={fieldId}
                  value={String(raw ?? '')}
                  placeholder={hint.placeholder}
                  rows={3}
                  onChange={(event) => setConfigValue(hint.field, event.target.value)}
                />
              ) : hint.widget === 'code' ? (
                <CodeTextarea
                  id={fieldId}
                  value={String(raw ?? '')}
                  placeholder={hint.placeholder}
                  onChange={(event) => setConfigValue(hint.field, event.target.value)}
                />
              ) : hint.widget === 'credential' ? (
                <CredentialSelect
                  fieldId={fieldId}
                  value={String(raw ?? '')}
                  credentialTypes={hint.credentialTypes ?? []}
                  onChange={(value) => setConfigValue(hint.field, value)}
                />
              ) : hint.widget === 'select' ? (
                <Select
                  value={String(raw ?? '')}
                  onValueChange={(value) => setConfigValue(hint.field, value)}
                >
                  <SelectTrigger id={fieldId}>
                    <SelectValue placeholder="Seleccionar…" />
                  </SelectTrigger>
                  <SelectContent>
                    {(hint.options ?? []).map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : hint.widget === 'number' ? (
                <Input
                  id={fieldId}
                  type="number"
                  value={raw === undefined || raw === null ? '' : String(raw)}
                  onChange={(event) => setConfigValue(hint.field, event.target.valueAsNumber)}
                />
              ) : hint.widget === 'switch' ? (
                <div className="flex items-center gap-2 pt-0.5">
                  <Switch
                    id={fieldId}
                    checked={Boolean(raw)}
                    onCheckedChange={(checked) => setConfigValue(hint.field, checked)}
                  />
                  <span className="text-xs text-muted-foreground">{Boolean(raw) ? 'Sí' : 'No'}</span>
                </div>
              ) : hint.widget === 'keyvalue' ? (
                <KeyValueEditor
                  value={Array.isArray(raw) ? (raw as { key: string; value: string }[]) : []}
                  onChange={(rows) => setConfigValue(hint.field, rows)}
                />
              ) : null}

              {hint.helpText ? <p className="text-[11px] leading-4 text-faint-foreground">{hint.helpText}</p> : null}
            </div>
          );
        })}

        {/* Puertos */}
        <div className="grid grid-cols-2 gap-3 border-t border-border pt-4">
          <PortList title="Entradas" ports={info.inputs} />
          <PortList title="Salidas" ports={info.outputs} />
        </div>

        {/* Variables que aporta */}
        {info.outputVariables.length > 0 ? (
          <div className="border-t border-border pt-4">
            <p className="mb-1.5 text-[10px] font-semibold tracking-widest text-faint-foreground uppercase">
              Variables disponibles después de este nodo
            </p>
            <ul className="space-y-1">
              {info.outputVariables.map((variable) => (
                <li key={variable.path} className="text-[11.5px]">
                  <code className="rounded bg-surface-sunken px-1 py-px font-mono text-[10.5px] text-accent">
                    {variable.path}
                  </code>
                  <span className="ml-1.5 text-muted-foreground">{variable.description}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* Última ejecución de este nodo */}
        {lastStep ? (
          <div className="space-y-2 border-t border-border pt-4">
            <p className="text-[10px] font-semibold tracking-widest text-faint-foreground uppercase">
              Última ejecución · {lastStep.status}
              {typeof lastStep.durationMs === 'number' ? ` · ${lastStep.durationMs} ms` : ''}
              {lastStep.attempt > 1 ? ` · intento ${lastStep.attempt}` : ''}
            </p>
            <div className="space-y-1.5">
              <Label>Entrada recibida</Label>
              <JsonPreview value={lastStep.input} />
            </div>
            <div className="space-y-1.5">
              <Label>Salida generada</Label>
              <JsonPreview value={lastStep.output} />
            </div>
            {lastStep.error ? (
              <div className="space-y-1.5">
                <Label className="text-danger">Error</Label>
                <p className="rounded-md bg-danger-soft px-2.5 py-1.5 text-[11.5px] text-danger">
                  <code className="font-mono text-[10.5px]">{lastStep.error.code}</code> — {lastStep.error.message}
                </p>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Notas */}
        <div className="space-y-1.5 border-t border-border pt-4">
          <Label htmlFor={`notes-${node.id}`}>Notas internas</Label>
          <Textarea
            id={`notes-${node.id}`}
            rows={2}
            value={node.data.notes}
            onChange={(event) => updateNodeData(node.id, { notes: event.target.value })}
            placeholder="Contexto para el equipo…"
          />
        </div>

        {/* Estado */}
        <div className="flex items-center justify-between border-t border-border pt-4">
          <Label htmlFor={`disabled-${node.id}`}>Nodo activo</Label>
          <Switch
            id={`disabled-${node.id}`}
            checked={!node.data.disabled}
            onCheckedChange={(checked) => updateNodeData(node.id, { disabled: !checked })}
          />
        </div>
      </div>

      {/* Acciones */}
      <div className="flex gap-2 border-t border-border p-3">
        <Button variant="secondary" size="sm" className="flex-1" onClick={() => duplicateNode(node.id)}>
          <Copy /> Duplicar
        </Button>
        <Button variant="danger-ghost" size="sm" className="flex-1" onClick={() => removeNode(node.id)}>
          <Trash2 /> Eliminar
        </Button>
      </div>
    </aside>
  );
}

function PortList({ title, ports }: { title: string; ports: NodeTypeInfo['inputs'] }) {
  return (
    <div>
      <p className="mb-1 text-[10px] font-semibold tracking-widest text-faint-foreground uppercase">{title}</p>
      {ports.length === 0 ? (
        <p className="text-[11px] text-faint-foreground">—</p>
      ) : (
        <ul className="space-y-0.5">
          {ports.map((port) => (
            <li key={port.id} className="font-mono text-[11px] text-muted-foreground">
              {port.id}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function KeyValueEditor({
  value,
  onChange,
}: {
  value: { key: string; value: string }[];
  onChange: (rows: { key: string; value: string }[]) => void;
}) {
  const rows = value.length > 0 ? value : [{ key: '', value: '' }];
  const update = (index: number, patch: Partial<{ key: string; value: string }>) => {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };
  return (
    <div className="space-y-1.5">
      {rows.map((row, index) => (
        <div key={index} className="flex gap-1.5">
          <Input
            value={row.key}
            onChange={(event) => update(index, { key: event.target.value })}
            placeholder="clave"
            aria-label={`Clave ${index + 1}`}
            className="h-7.5 flex-[2] font-mono text-xs"
          />
          <Input
            value={row.value}
            onChange={(event) => update(index, { value: event.target.value })}
            placeholder="valor o {{expresión}}"
            aria-label={`Valor ${index + 1}`}
            className="h-7.5 flex-[3] font-mono text-xs"
          />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Quitar fila ${index + 1}`}
            onClick={() => onChange(rows.filter((_, i) => i !== index))}
          >
            <Trash2 />
          </Button>
        </div>
      ))}
      <Button variant="ghost" size="sm" onClick={() => onChange([...rows, { key: '', value: '' }])}>
        + Agregar fila
      </Button>
    </div>
  );
}
