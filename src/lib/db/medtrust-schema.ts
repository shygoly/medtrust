import {
  pgTable,
  serial,
  varchar,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  decimal,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ========== Enums ==========
export const tenantTypeEnum = pgEnum('tenant_type', [
  'provider',    // 数据提供方
  'consumer',    // 数据使用方
  'admin',       // 平台运营方
  'tech',        // 技术提供方
]);

export const tenantStatusEnum = pgEnum('tenant_status', [
  'pending',     // 待审核
  'active',      // 已激活
  'suspended',   // 已暂停
  'rejected',    // 已拒绝
]);

export const dataAssetTypeEnum = pgEnum('data_asset_type', [
  'emr',         // 电子病历
  'imaging',     // 影像数据
  'lab',         // 检验数据
  'prescription',// 处方数据
  'followup',    // 随访数据
  'genomic',     // 基因数据
]);

export const dataAssetStatusEnum = pgEnum('data_asset_status', [
  'draft',       // 草稿
  'reviewing',   // 审核中
  'published',   // 已发布
  'offline',     // 已下架
]);

export const computeTaskStatusEnum = pgEnum('compute_task_status', [
  'pending',     // 待执行
  'running',     // 执行中
  'completed',   // 已完成
  'failed',      // 失败
  'cancelled',   // 已取消
]);

export const computeMethodEnum = pgEnum('compute_method', [
  'mpc',         // 多方安全计算
  'fl',          // 联邦学习
  'tee',         // 可信执行环境
  'sandbox',     // 安全沙箱
]);

// ========== Extended Tables ==========

// 扩展 teams 表，添加租户类型
export const tenants = pgTable('tenants', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  type: tenantTypeEnum('type').notNull().default('consumer'),
  status: tenantStatusEnum('status').notNull().default('pending'),
  description: text('description'),
  
  // 资质信息
  businessLicense: text('business_license'),      // 营业执照
  medicalLicense: text('medical_license'),        // 医疗机构许可证
  legalPersonId: text('legal_person_id'),         // 法人身份证
  
  // 联系信息
  contactName: varchar('contact_name', { length: 100 }),
  contactPhone: varchar('contact_phone', { length: 20 }),
  contactEmail: varchar('contact_email', { length: 255 }),
  
  // 配额设置
  computeQuota: integer('compute_quota').default(100),      // 计算配额（小时/月）
  storageQuota: integer('storage_quota').default(1000),     // 存储配额（GB）
  dataRetention: integer('data_retention').default(365),    // 数据保留天数
  
  // 财务信息
  stripeCustomerId: text('stripe_customer_id').unique(),
  stripeSubscriptionId: text('stripe_subscription_id').unique(),
  stripeProductId: text('stripe_product_id'),
  planName: varchar('plan_name', { length: 50 }),
  subscriptionStatus: varchar('subscription_status', { length: 20 }),
  
  // 统计信息
  totalEarnings: decimal('total_earnings', { precision: 15, scale: 2 }).default('0'),
  totalSpending: decimal('total_spending', { precision: 15, scale: 2 }).default('0'),
  
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  verifiedAt: timestamp('verified_at'),                      // 审核通过时间
});

// 数据资产表（数据提供方使用）
export const dataAssets = pgTable('data_assets', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id')
    .notNull()
    .references(() => tenants.id),
  
  name: varchar('name', { length: 200 }).notNull(),
  description: text('description'),
  type: dataAssetTypeEnum('type').notNull(),
  status: dataAssetStatusEnum('status').notNull().default('draft'),
  
  // 数据详情
  recordCount: integer('record_count'),              // 记录数
  patientCount: integer('patient_count'),            // 患者数
  timeRangeStart: timestamp('time_range_start'),     // 时间范围起
  timeRangeEnd: timestamp('time_range_end'),         // 时间范围止
  hospitalLevel: varchar('hospital_level', { length: 20 }), // 医院等级
  region: varchar('region', { length: 100 }),        // 地区
  
  // 数据质量
  completeness: decimal('completeness', { precision: 5, scale: 2 }), // 完整度
  accuracy: decimal('accuracy', { precision: 5, scale: 2 }),         // 准确度
  
  // 定价策略
  pricePerQuery: decimal('price_per_query', { precision: 10, scale: 2 }),      // 每次查询价格
  pricePerCompute: decimal('price_per_compute', { precision: 10, scale: 2 }),  // 每小时计算价格
  
  // 存储信息
  storagePath: text('storage_path'),                 // 存储路径
  storageSize: integer('storage_size'),              // 存储大小（MB）
  encryptionKey: text('encryption_key'),             // 加密密钥
  
  // 使用条款
  usagePolicy: jsonb('usage_policy'),                // 使用策略 JSON
  requiredApprovals: jsonb('required_approvals'),    // 需要的审批
  
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  publishedAt: timestamp('published_at'),            // 发布时间
});

// 数据使用申请（数据使用方使用）
export const dataAccessRequests = pgTable('data_access_requests', {
  id: serial('id').primaryKey(),
  requesterTenantId: integer('requester_tenant_id')
    .notNull()
    .references(() => tenants.id),
  providerTenantId: integer('provider_tenant_id')
    .notNull()
    .references(() => tenants.id),
  assetId: integer('asset_id')
    .notNull()
    .references(() => dataAssets.id),
  
  // 申请信息
  purpose: text('purpose').notNull(),                // 使用目的
  expectedDuration: integer('expected_duration'),    // 预计使用时长（小时）
  expectedCost: decimal('expected_cost', { precision: 15, scale: 2 }),
  
  // 状态
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  approvedBy: integer('approved_by'),                // 审批人
  approvedAt: timestamp('approved_at'),              // 审批时间
  rejectionReason: text('rejection_reason'),         // 拒绝原因
  
  // 实际使用
  actualStartAt: timestamp('actual_start_at'),
  actualEndAt: timestamp('actual_end_at'),
  actualCost: decimal('actual_cost', { precision: 15, scale: 2 }),
  
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// 计算任务表
export const computeTasks = pgTable('compute_tasks', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id')
    .notNull()
    .references(() => tenants.id),
  requestId: integer('request_id')
    .references(() => dataAccessRequests.id),
  
  name: varchar('name', { length: 200 }).notNull(),
  description: text('description'),
  method: computeMethodEnum('method').notNull(),     // 计算方法
  status: computeTaskStatusEnum('status').notNull().default('pending'),
  
  // 计算配置
  algorithmId: varchar('algorithm_id', { length: 100 }),     // 算法ID
  algorithmParams: jsonb('algorithm_params'),                // 算法参数
  dataAssets: jsonb('data_assets'),                          // 使用的数据资产
  
  // 资源使用
  cpuHours: decimal('cpu_hours', { precision: 10, scale: 2 }),
  gpuHours: decimal('gpu_hours', { precision: 10, scale: 2 }),
  memoryGb: integer('memory_gb'),
  
  // 结果
  resultPath: text('result_path'),                   // 结果存储路径
  resultSummary: jsonb('result_summary'),            // 结果摘要
  errorMessage: text('error_message'),               // 错误信息
  
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// 审计日志（扩展）
export const auditLogs = pgTable('audit_logs', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id')
    .notNull()
    .references(() => tenants.id),
  userId: integer('user_id'),                        // 操作用户
  
  action: varchar('action', { length: 50 }).notNull(),
  resourceType: varchar('resource_type', { length: 50 }),    // 资源类型
  resourceId: integer('resource_id'),                        // 资源ID
  
  // 详细记录
  details: jsonb('details'),                         // 操作详情
  ipAddress: varchar('ip_address', { length: 45 }),
  userAgent: text('user_agent'),
  
  // 合规标记
  complianceLevel: varchar('compliance_level', { length: 20 }), // 合规级别
  requiresReview: boolean('requires_review').default(false),    // 需要审核
  reviewedBy: integer('reviewed_by'),                           // 审核人
  reviewedAt: timestamp('reviewed_at'),
  
  timestamp: timestamp('timestamp').notNull().defaultNow(),
});

// ========== Relations ==========

export const tenantsRelations = relations(tenants, ({ many }) => ({
  dataAssets: many(dataAssets),
  accessRequests: many(dataAccessRequests, { relationName: 'requester' }),
  computeTasks: many(computeTasks),
  auditLogs: many(auditLogs),
}));

export const dataAssetsRelations = relations(dataAssets, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [dataAssets.tenantId],
    references: [tenants.id],
  }),
  accessRequests: many(dataAccessRequests),
}));

export const dataAccessRequestsRelations = relations(dataAccessRequests, ({ one }) => ({
  requester: one(tenants, {
    fields: [dataAccessRequests.requesterTenantId],
    references: [tenants.id],
  }),
  provider: one(tenants, {
    fields: [dataAccessRequests.providerTenantId],
    references: [tenants.id],
  }),
  asset: one(dataAssets, {
    fields: [dataAccessRequests.assetId],
    references: [dataAssets.id],
  }),
}));

export const computeTasksRelations = relations(computeTasks, ({ one }) => ({
  tenant: one(tenants, {
    fields: [computeTasks.tenantId],
    references: [tenants.id],
  }),
  request: one(dataAccessRequests, {
    fields: [computeTasks.requestId],
    references: [dataAccessRequests.id],
  }),
}));

// ========== Types ==========

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
export type DataAsset = typeof dataAssets.$inferSelect;
export type NewDataAsset = typeof dataAssets.$inferInsert;
export type DataAccessRequest = typeof dataAccessRequests.$inferSelect;
export type NewDataAccessRequest = typeof dataAccessRequests.$inferInsert;
export type ComputeTask = typeof computeTasks.$inferSelect;
export type NewComputeTask = typeof computeTasks.$inferInsert;
export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;

// ========== Activity Types ==========

export enum MedTrustActivityType {
  // 租户相关
  TENANT_CREATED = 'TENANT_CREATED',
  TENANT_VERIFIED = 'TENANT_VERIFIED',
  TENANT_SUSPENDED = 'TENANT_SUSPENDED',
  
  // 数据资产相关
  DATA_ASSET_UPLOADED = 'DATA_ASSET_UPLOADED',
  DATA_ASSET_PUBLISHED = 'DATA_ASSET_PUBLISHED',
  DATA_ASSET_OFFLINE = 'DATA_ASSET_OFFLINE',
  
  // 数据访问相关
  ACCESS_REQUESTED = 'ACCESS_REQUESTED',
  ACCESS_APPROVED = 'ACCESS_APPROVED',
  ACCESS_REJECTED = 'ACCESS_REJECTED',
  
  // 计算任务相关
  TASK_CREATED = 'TASK_CREATED',
  TASK_STARTED = 'TASK_STARTED',
  TASK_COMPLETED = 'TASK_COMPLETED',
  TASK_FAILED = 'TASK_FAILED',
  
  // 审计相关
  AUDIT_REVIEWED = 'AUDIT_REVIEWED',
  COMPLIANCE_ALERT = 'COMPLIANCE_ALERT',
}
