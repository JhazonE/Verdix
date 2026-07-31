import type { ExternalApi, AllowedMethods, ApiRole, ApiProvider } from '@/lib/external-api-config';

export type { ExternalApi, AllowedMethods, ApiRole, ApiProvider };

export const METHODS_LABEL: Record<AllowedMethods, string> = {
  send_only:    'Send Only (POST)',
  receive_only: 'Receive Only (GET)',
  full_access:  'Full Access (GET + POST + PUT)',
};

export const METHODS_BADGE: Record<AllowedMethods, { label: string; class: string }> = {
  send_only:    { label: 'Send Only',    class: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' },
  receive_only: { label: 'Receive Only', class: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300' },
  full_access:  { label: 'Full Access',  class: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300' },
};

export const EMPTY_FORM: Omit<ExternalApi, 'id' | 'createdAt' | 'updatedAt'> = {
  name: '',
  description: '',
  enabled: false,
  apiEndpoint: '',
  authType: 'none',
  apiKey: '',
  bearerToken: '',
  allowedMethods: 'full_access',
  timeout: 30000,
  retryAttempts: 3,
  retryDelay: 2000,
  syncMode: 'realtime',
  onErrorAction: 'log_only',
  role: 'general',
  provider: 'generic',
  loginEmail: '',
  loginPassword: '',
};
