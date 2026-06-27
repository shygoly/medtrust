// MedTrust 前端类型定义

export interface User {
  id: number;
  email: string;
  name?: string;
  avatar?: string;
}

export interface Tenant {
  id: number;
  name: string;
  type: 'provider' | 'consumer' | 'admin' | 'tech';
  status: 'pending' | 'active' | 'suspended' | 'rejected';
  description?: string;
  contactEmail: string;
  contactName?: string;
  contactPhone?: string;
  createdAt: string;
}

/**
 * @deprecated Replaced by DataProduct in the federated catalog model.
 * @see apps/web/src/types/catalog.types.ts (when created)
 */
export interface DataAsset {
  id: number;
  tenantId: number;
  name: string;
  description?: string;
  type: 'emr' | 'imaging' | 'lab' | 'prescription' | 'followup' | 'genomic';
  status: 'draft' | 'reviewing' | 'published' | 'offline';
  recordCount?: number;
  patientCount?: number;
  pricePerQuery?: number;
  pricePerCompute?: number;
  /** @deprecated Use updatedAt from DataProduct */
  createdAt: string;
}

/**
 * @deprecated Replaced by DigitalContract in the federated model.
 * @see apps/api/src/digital-contract/
 */
export interface AccessRequest {
  id: number;
  requesterTenantId: number;
  providerTenantId: number;
  assetId: number;
  purpose: string;
  expectedDuration?: number;
  expectedCost?: number;
  status: 'pending' | 'approved' | 'rejected' | 'completed';
  approvedBy?: number;
  approvedAt?: string;
  rejectionReason?: string;
  createdAt: string;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface RegisterData {
  email: string;
  password: string;
  name?: string;
}

export interface AuthResponse {
  user: User;
  access_token: string;
}

export interface ComputeTask {
  id: string;
  name: string;
  description?: string;
  method: 'fl' | 'mpc' | 'tee' | 'sandbox';
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  tenantId: number;
  requestId?: string;
  algorithmParams?: any;
  dataAssets?: any;
  resultSummary?: any;
  errorMessage?: string;
  progress?: number;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface AuditLog {
  id: number;
  action: string;
  resource: string;
  resourceId?: number;
  userId: number;
  tenantId: number;
  details?: any;
  ipAddress?: string;
  occurredAt: string;
}

// Re-export compute task types
export * from './compute-task.types';
export * from './flower.types';
export * from './task-status.types';
export * from './task-result.types';
