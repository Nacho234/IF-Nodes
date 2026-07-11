'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { ASSERTION_KINDS, ASSERTION_KIND_LABELS } from '@ifnodes/shared';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { CodeTextarea, Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { TestCaseRow } from '@/lib/types';

interface AssertionDraft {
  id: string;
  kind: string;
  path: string;
  expected: string;
  nodeId: string;
}

const NEEDS_PATH = new Set(['equals', 'contains', 'exists', 'notExists', 'type', 'greaterThan', 'lessThan']);
const NEEDS_EXPECTED = new Set(['equals', 'contains', 'type', 'greaterThan', 'lessThan', 'finalStatus']);
const NEEDS_NODE = new Set(['nodeVisited', 'nodeNotVisited']);

function newAssertion(): AssertionDraft {
  return {
    id: Math.random().toString(36).slice(2, 10),
    kind: 'contains',
    path: 'output.message',
    expected: '',
    nodeId: '',
  };
}

/**
 * Alta/edición de un caso de prueba. `prefill` permite crear un caso desde
 * el constructor con la entrada de la última ejecución.
 */
export function TestCaseDialog({
  open,
  onOpenChange,
  projectId,
  workflowId,
  testCase,
  prefillInput,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  workflowId: string;
  testCase?: TestCaseRow;
  prefillInput?: Record<string, unknown>;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [inputJson, setInputJson] = useState('{}');
  const [assertions, setAssertions] = useState<AssertionDraft[]>([]);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setServerError(null);
    if (testCase) {
      setName(testCase.name);
      setDescription(testCase.description ?? '');
      setInputJson(JSON.stringify(testCase.input, null, 2));
      setAssertions(testCase.assertions.length > 0 ? testCase.assertions : [newAssertion()]);
    } else {
      setName('');
      setDescription('');
      setInputJson(JSON.stringify(prefillInput ?? { text: 'Hola, quiero un turno' }, null, 2));
      setAssertions([
        { ...newAssertion(), kind: 'finalStatus', path: '', expected: 'SUCCEEDED' },
        newAssertion(),
      ]);
    }
  }, [open, testCase, prefillInput]);

  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        workflowId,
        name,
        description,
        inputJson,
        assertions: assertions.filter((a) => NEEDS_NODE.has(a.kind) ? a.nodeId : a.kind === 'finalStatus' ? a.expected : a.path),
      };
      return testCase
        ? api.patch<TestCaseRow>(`/test-cases/${testCase.id}`, payload)
        : api.post<TestCaseRow>(`/projects/${projectId}/test-cases`, payload);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['test-cases', projectId] });
      onOpenChange(false);
    },
    onError: (error) => {
      setServerError(
        error instanceof ApiError
          ? `${error.message}${error.issues ? ': ' + error.issues.map((i) => i.message).join(' · ') : ''}`
          : 'No se pudo guardar el caso.',
      );
    },
  });

  const updateAssertion = (id: string, patch: Partial<AssertionDraft>) => {
    setAssertions((current) => current.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={testCase ? 'Editar caso de prueba' : 'Nuevo caso de prueba'}
        description="El caso ejecuta el flujo con esta entrada y verifica las assertions contra el resultado."
        className="max-w-2xl"
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
          className="space-y-4"
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="tc-name">
                Nombre <span className="text-danger">*</span>
              </Label>
              <Input
                id="tc-name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Cliente solicita turno"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tc-desc">Descripción</Label>
              <Input id="tc-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tc-input">Entrada del disparador (JSON)</Label>
            <CodeTextarea id="tc-input" value={inputJson} onChange={(e) => setInputJson(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label>Resultado esperado (assertions)</Label>
            {assertions.map((a) => (
              <div key={a.id} className="flex items-start gap-1.5">
                <Select value={a.kind} onValueChange={(kind) => updateAssertion(a.id, { kind })}>
                  <SelectTrigger className="h-7.5 w-40 shrink-0 text-xs" aria-label="Tipo de assertion">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ASSERTION_KINDS.map((kind) => (
                      <SelectItem key={kind} value={kind}>
                        {ASSERTION_KIND_LABELS[kind]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {NEEDS_PATH.has(a.kind) ? (
                  <Input
                    value={a.path}
                    onChange={(e) => updateAssertion(a.id, { path: e.target.value })}
                    placeholder="output.message"
                    aria-label="Path"
                    className="h-7.5 flex-1 font-mono text-xs"
                  />
                ) : null}
                {NEEDS_NODE.has(a.kind) ? (
                  <Input
                    value={a.nodeId}
                    onChange={(e) => updateAssertion(a.id, { nodeId: e.target.value })}
                    placeholder="id del nodo (p.ej. node_resp_turno)"
                    aria-label="Id del nodo"
                    className="h-7.5 flex-1 font-mono text-xs"
                  />
                ) : null}
                {NEEDS_EXPECTED.has(a.kind) ? (
                  <Input
                    value={a.expected}
                    onChange={(e) => updateAssertion(a.id, { expected: e.target.value })}
                    placeholder={a.kind === 'finalStatus' ? 'SUCCEEDED' : a.kind === 'type' ? 'string' : 'valor esperado'}
                    aria-label="Valor esperado"
                    className="h-7.5 flex-1 text-xs"
                  />
                ) : null}

                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Quitar assertion"
                  onClick={() => setAssertions((current) => current.filter((x) => x.id !== a.id))}
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
            <Button variant="ghost" size="sm" onClick={() => setAssertions((c) => [...c, newAssertion()])}>
              <Plus /> Agregar assertion
            </Button>
            <p className="text-[11px] text-faint-foreground">
              Paths disponibles: <code className="font-mono">output.*</code> (salida final),{' '}
              <code className="font-mono">nodes.&lt;id&gt;.output.*</code>,{' '}
              <code className="font-mono">variables.*</code>, <code className="font-mono">trigger.*</code>.
            </p>
          </div>

          {serverError ? (
            <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-xs text-danger">
              {serverError}
            </p>
          ) : null}

          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" loading={mutation.isPending}>
              {testCase ? 'Guardar cambios' : 'Crear caso'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
