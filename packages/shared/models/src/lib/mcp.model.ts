import type { McpServerConfig } from './config.model.js';

export type McpAuthType = 'none' | 'bearer' | 'oauth';

export interface McpOAuthStored {
  authorizationUrl?: string;
  tokenUrl?: string;
  clientId?: string;
  clientSecret?: string;
  scopes?: string;
  redirectUri?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string;
}

export interface McpOAuthInfo {
  authorizationUrl?: string;
  tokenUrl?: string;
  clientId?: string;
  hasClientSecret: boolean;
  scopes?: string;
  hasAccessToken: boolean;
  expiresAt?: string;
}

export interface McpServer {
  id: string;
  name: string;
  config: McpServerConfig;
  authType: McpAuthType;
  oauth: McpOAuthInfo;
  createdAt: string;
  updatedAt: string;
}

export interface CreateMcpServerInput {
  name: string;
  config: McpServerConfig;
  authType?: McpAuthType;
  oauth?: McpOAuthStored;
}

export interface UpdateMcpServerInput {
  name?: string;
  config?: McpServerConfig;
  authType?: McpAuthType;
  oauth?: McpOAuthStored | null;
}
