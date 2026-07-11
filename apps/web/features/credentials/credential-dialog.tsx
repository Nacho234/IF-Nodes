'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ENVIRONMENT_KINDS } from '@ifnodes/shared';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { CredentialTypeDef, CredentialView } from '@/lib/types';

export function CredentialDialog({
  open,
  onOpenChange,
  credential,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  credential?: CredentialView;
}) {
  const queryClient = useQueryClient();
  const [slug, setSlug] = useState('anthropic');
  const [name, setName] = useState('');
  const [environment, setEnvironment] = useState('DEVELOPMENT');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);

  const types = useQuery({
    queryKey: ['credential-types'],
    queryFn: () => api.get<CredentialTypeDef[]>('/credentials/types'),
    enabled: open,
    staleTime: Infinity,
  });

  const selectedType = useMemo(
    () => types.data?.find((t) => t.slug === slug),
    [types.data, slug],
  );

  useEffect(() => {
    if (!open) return;
    setServerError(null);
    if (credential) {
      setSlug(credential.integrationSlug);
      setName(credential.name);
      setEnvironment(credential.environment);
      setFields({ ...credential.publicFields }); // secretos vacíos: se recompletan al rotar
    } else {
      setName('');
      setEnvironment('DEVELOPMENT');
      setFields({});
    }
  }, [open, credential]);

  const mutation = useMutation({
    mutationFn: () => {
      if (credential) {
        // Edición: solo nombre y (si se completaron secretos) rotación de datos
        const hasNewData = selectedType?.fields.some((f) => f.secret && fields[f.key]);
        return api.patch<CredentialView>(`/credentials/${credential.id}`, {
          name,
          ...(hasNewData ? { data: fields } : {}),
        });
      }
      return api.post<CredentialView>('/credentials', {
        name,
        integrationSlug: slug,
        environment,
        data: fields,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['credentials'] });
      onOpenChange(false);
    },
    onError: (error) => {
      setServerError(
        error instanceof ApiError
          ? `${error.message}${error.issues ? ': ' + error.issues.map((i) => i.message).join(' · ') : ''}`
          : 'No se pudo guardar la credencial.',
      );
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={credential ? 'Editar credencial' : 'Nueva credencial'}
        description="Los secretos se cifran (AES-256-GCM) al guardar y no vuelven a mostrarse."
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
          className="space-y-4"
        >
          {!credential ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="cred-type">Tipo</Label>
                <Select value={slug} onValueChange={setSlug}>
                  <SelectTrigger id="cred-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(types.data ?? []).map((type) => (
                      <SelectItem key={type.slug} value={type.slug}>
                        {type.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cred-env">Entorno</Label>
                <Select value={environment} onValueChange={setEnvironment}>
                  <SelectTrigger id="cred-env">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ENVIRONMENT_KINDS.map((kind) => (
                      <SelectItem key={kind} value={kind}>
                        {kind}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="cred-name">
              Nombre <span className="text-danger">*</span>
            </Label>
            <Input
              id="cred-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="OpenAI principal"
            />
          </div>

          {selectedType?.fields.map((field) => (
            <div key={field.key} className="space-y-1.5">
              <Label htmlFor={`cred-${field.key}`}>
                {field.label}
                {field.secret ? <span className="ml-1.5 text-[10px] text-faint-foreground">(cifrado)</span> : null}
              </Label>
              <Input
                id={`cred-${field.key}`}
                type={field.secret ? 'password' : 'text'}
                value={fields[field.key] ?? ''}
                placeholder={
                  field.secret && credential ? 'Dejar vacío para no cambiar' : field.placeholder
                }
                onChange={(e) => setFields((current) => ({ ...current, [field.key]: e.target.value }))}
              />
            </div>
          ))}

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
              {credential ? 'Guardar' : 'Crear credencial'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
