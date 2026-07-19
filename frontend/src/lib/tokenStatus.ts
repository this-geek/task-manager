import type { ApiToken } from './types';

export type TokenStatus = 'active' | 'revoked' | 'expired';

export function tokenStatus(token: ApiToken): TokenStatus {
  if (token.revoked_at) return 'revoked';
  if (token.expires_at && token.expires_at <= new Date().toISOString()) return 'expired';
  return 'active';
}

export const TOKEN_STATUS_LABELS: Record<TokenStatus, string> = {
  active: 'Active',
  revoked: 'Revoked',
  expired: 'Expired',
};
