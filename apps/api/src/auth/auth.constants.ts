/** Legacy compute/privacy modules scope rows by tenant; federated users bind via participantId. */
export const DEFAULT_TENANT_ID = 1;

export function resolveTenantId(payload: { tenantId?: number | null }): number {
  return payload.tenantId ?? DEFAULT_TENANT_ID;
}
