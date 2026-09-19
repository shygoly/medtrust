-- compliance-pre-review-gate 线上注册表同步的回滚（task 3.2）
-- 撤销 2026-09-19-compliance-pre-review-sync.sql：删除新增对象、还原 medium 保障级、移除 analysisTypes（保留 impl）。
-- 执行：docker exec -i medtrust-db psql -U medtrust_api -d medtrust_api -v ON_ERROR_STOP=1 < 本文件
BEGIN;
DELETE FROM l2_security_capability WHERE key = 'federated';
DELETE FROM l6_protocol WHERE key = 'federated-local-compute';
DELETE FROM l2_block_rule WHERE key = 'block-security-below-required';
UPDATE l2_risk_policy SET "requiredSecurityCapabilityKey" = 'enhanced' WHERE key = 'risk-medium';
UPDATE l3_model SET metadata = (metadata::jsonb - 'analysisTypes')::text
  WHERE key IN ('disproportionality-prr-ror','mantel-haenszel-or','logistic-regression','cox-ph','kaplan-meier-estimator');
UPDATE l4_algorithm SET metadata = (metadata::jsonb - 'analysisTypes')::text WHERE key = 'federated-learning';
COMMIT;
