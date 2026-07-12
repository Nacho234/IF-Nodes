'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

export function DeleteProjectButton({ projectId, projectName }: { projectId: string; projectName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="danger-ghost" size="sm" onClick={() => setOpen(true)}>
        <Trash2 /> Eliminar
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Eliminar proyecto"
        description={
          <>
            Vas a eliminar <strong>{projectName}</strong> con todos sus flujos, ejecuciones, casos de prueba y
            versiones. Esta acción no se puede deshacer.
          </>
        }
        onConfirm={async () => {
          await api.delete(`/projects/${projectId}`);
          router.push('/projects');
          router.refresh();
        }}
      />
    </>
  );
}
