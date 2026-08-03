'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, Globe, PlusCircle } from 'lucide-react';
import { ApiCard } from './ApiCard';
import type { ExternalApi } from './external-api-types';

interface Props {
  apis: ExternalApi[];
  isLoading: boolean;
  testingId: string | null;
  onAddApi: () => void;
  onToggle: (api: ExternalApi) => void;
  onEdit: (api: ExternalApi) => void;
  onDelete: (api: ExternalApi) => void;
  onTest: (api: ExternalApi) => void;
}

export function ApiConnectionsTab({ apis, isLoading, testingId, onAddApi, onToggle, onEdit, onDelete, onTest }: Props) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (apis.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Globe className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold mb-1">No APIs configured</h3>
          <p className="text-sm text-muted-foreground mb-4">Add your first external API to start sending or receiving data.</p>
          <Button onClick={onAddApi}><PlusCircle className="mr-2 h-4 w-4" />Add API</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4">
      {apis.map(api => (
        <ApiCard key={api.id} api={api} testingId={testingId} onToggle={onToggle} onEdit={onEdit} onDelete={onDelete} onTest={onTest} />
      ))}
    </div>
  );
}
