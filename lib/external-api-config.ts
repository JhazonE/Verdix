/**
 * External API Configuration
 * Settings for integrating with external accounting server
 */

export type ExternalApiConfig = {
  enabled: boolean;
  apiEndpoint: string;
  authType: 'api_key' | 'bearer_token' | 'oauth' | 'none';
  apiKey?: string;
  bearerToken?: string;
  timeout: number; // milliseconds
  retryAttempts: number;
  retryDelay: number; // milliseconds
  syncMode: 'realtime' | 'batch';
  onErrorAction: 'retry' | 'queue' | 'log_only';
};

export const DEFAULT_EXTERNAL_API_CONFIG: ExternalApiConfig = {
  enabled: false,
  apiEndpoint: '',
  authType: 'api_key',
  timeout: 30000, // 30 seconds
  retryAttempts: 3,
  retryDelay: 2000, // 2 seconds
  syncMode: 'realtime',
  onErrorAction: 'log_only',
};

// Multi-API types
export type AllowedMethods = 'send_only' | 'receive_only' | 'full_access';
export type ApiRole = 'general' | 'cloud_sync';
export type ApiProvider = 'generic' | 'sta_lucia';

export type ExternalApi = {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  apiEndpoint: string;
  authType: 'api_key' | 'bearer_token' | 'none';
  apiKey?: string;
  bearerToken?: string;
  allowedMethods: AllowedMethods;
  timeout: number;
  retryAttempts: number;
  retryDelay: number;
  syncMode: 'realtime' | 'batch';
  onErrorAction: 'retry' | 'queue' | 'log_only';
  role: ApiRole;
  provider: ApiProvider;
  /** Sta. Lucia tenant-account email. Not a Verdix login. */
  loginEmail?: string;
  loginPassword?: string;
  createdAt?: string;
  updatedAt?: string;
};

export const DEFAULT_EXTERNAL_API: Omit<ExternalApi, 'id' | 'name'> = {
  enabled: false,
  apiEndpoint: '',
  authType: 'none',
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

/**
 * Get external API configuration from environment or database
 */
export async function getExternalApiConfig(): Promise<ExternalApiConfig> {
  // If running on the server, query the database directly for better efficiency and to avoid relative URL issues
  if (typeof window === 'undefined') {
    try {
      const { query } = await import('./mysql');
      const settings = await query('SELECT setting_key, setting_value FROM external_api_settings', []);
      
      if (!settings || settings.length === 0) {
        return DEFAULT_EXTERNAL_API_CONFIG;
      }

      // Convert array of settings to object
      const config: any = { ...DEFAULT_EXTERNAL_API_CONFIG };
      settings.forEach((setting: any) => {
        let value = setting.setting_value;
        
        // Match key format from DB (snake_case) to config object (camelCase)
        const keyMap: Record<string, string> = {
          'enabled': 'enabled',
          'api_endpoint': 'apiEndpoint',
          'auth_type': 'authType',
          'api_key': 'apiKey',
          'bearer_token': 'bearerToken',
          'timeout': 'timeout',
          'retry_attempts': 'retryAttempts',
          'retry_delay': 'retryDelay',
          'sync_mode': 'syncMode',
          'on_error_action': 'onErrorAction'
        };

        const configKey = keyMap[setting.setting_key];
        if (configKey) {
          // Parse boolean and numeric values
          if (value === 'true') value = true;
          else if (value === 'false') value = false;
          else if (!isNaN(value) && value !== '' && (configKey === 'timeout' || configKey === 'retryAttempts' || configKey === 'retryDelay')) {
            value = Number(value);
          }
          config[configKey] = value;
        }
      });

      return config;
    } catch (error) {
      console.error('Failed to query external API config from database:', error);
      return DEFAULT_EXTERNAL_API_CONFIG;
    }
  }

  // Client-side fallback: Try to fetch from API settings endpoint using absolute URL if possible
  try {
    const { getApiUrl } = await import('./api-config');
    const response = await fetch(getApiUrl('/settings/external-api'));
    if (response.ok) {
      const data = await response.json();
      return data.config || DEFAULT_EXTERNAL_API_CONFIG;
    }
  } catch (error) {
    console.error('Failed to fetch external API config via API:', error);
  }
  
  // Fallback to default config
  return DEFAULT_EXTERNAL_API_CONFIG;
}

/**
 * Validate external API configuration
 */
export function validateExternalApiConfig(config: Partial<ExternalApiConfig>): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (config.enabled) {
    if (!config.apiEndpoint || config.apiEndpoint.trim() === '') {
      errors.push('API endpoint is required when integration is enabled');
    }

    if (config.apiEndpoint && !isValidUrl(config.apiEndpoint)) {
      errors.push('API endpoint must be a valid URL');
    }

    if (config.authType === 'api_key' && !config.apiKey) {
      errors.push('API key is required for API key authentication');
    }

    if (config.authType === 'bearer_token' && !config.bearerToken) {
      errors.push('Bearer token is required for bearer token authentication');
    }

    if (config.timeout && config.timeout < 1000) {
      errors.push('Timeout must be at least 1000ms');
    }

    if (config.retryAttempts && config.retryAttempts < 0) {
      errors.push('Retry attempts cannot be negative');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}
