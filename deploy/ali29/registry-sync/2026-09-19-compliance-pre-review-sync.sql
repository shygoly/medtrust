-- compliance-pre-review-gate 线上能力注册表同步（task 3.2，D-CMP-1 / D-CMP-2）
-- 目标库：Postgres medtrust_api（ali29 主库；控制面 cp_* 在独立的 medtrust_controlplane 库）。
-- 做法与 2026-09-18 landing-sync 一致：单事务 + ON CONFLICT DO NOTHING + 合并 metadata 不丢 impl。
-- 执行：docker exec -i medtrust-db psql -U medtrust_api -d medtrust_api -v ON_ERROR_STOP=1 < 本文件
-- 回滚：见同目录 -rollback.sql
BEGIN;

-- D-CMP-1：新增 L2 保障级 federated（数据不出域 + 输出闸门 + 全程审计，介于 basic 与 enhanced）
INSERT INTO l2_security_capability (key, name, "requiredProtocolKeys", description)
VALUES ('federated', 'Security Capability: Federated', '["federated-local-compute"]',
        '数据不出域 + 输出闸门(行级拦截+小格抑制) + 全程审计存证(D-CMP-1，介于 basic 与 enhanced)')
ON CONFLICT (key) DO NOTHING;

-- D-CMP-1：代表「联邦就地计算 + 输出闸门」的已落地 L6 对象（federated 保障级）
INSERT INTO l6_protocol (key, name, family, "securityAssumption", "securityCapabilityLevel", "handlerKey", status, metadata)
VALUES ('federated-local-compute', '联邦就地计算 + 输出闸门', 'Federated',
        '原始数据不出域 + 院内就地计算(连接器 rws-executor)+ 输出闸门(行级拦截 + 小格抑制 k≥5)+ 全程审计存证',
        'federated', 'connector/output-gate', 'active',
        '{"impl":"数据不出域守卫 + rws-executor 院内计算 + output-gate 小格抑制(k≥5) + 全程存证锚定,代表 federated 保障级"}')
ON CONFLICT (key) DO NOTHING;

-- D-CMP-1：medium 风险要求 federated（原 enhanced）
UPDATE l2_risk_policy SET "requiredSecurityCapabilityKey" = 'federated' WHERE key = 'risk-medium';

-- D-CMP-1：各风险等级强制所需保障级的阻断规则
INSERT INTO l2_block_rule (key, condition, block, reason)
VALUES ('block-security-below-required',
        'chosen_security_capability < required_security_capability', true,
        '所选协议推出的保障级低于该风险等级要求(D-CMP-1，basic<federated<enhanced)')
ON CONFLICT (key) DO NOTHING;

-- D-CMP-2：L3/L4 metadata.analysisTypes（合并进现有 metadata，保留 impl；供任务准入范围检查）
UPDATE l3_model SET metadata = (COALESCE(metadata,'{}')::jsonb || '{"analysisTypes":["disproportionality","adverse-event-signal","cohort-count","condition-prevalence"]}'::jsonb)::text WHERE key = 'disproportionality-prr-ror';
UPDATE l3_model SET metadata = (COALESCE(metadata,'{}')::jsonb || '{"analysisTypes":["comparative-effect"]}'::jsonb)::text WHERE key = 'mantel-haenszel-or';
UPDATE l3_model SET metadata = (COALESCE(metadata,'{}')::jsonb || '{"analysisTypes":["comparative-effect","causal-psm","algorithm-validation"]}'::jsonb)::text WHERE key = 'logistic-regression';
UPDATE l3_model SET metadata = (COALESCE(metadata,'{}')::jsonb || '{"analysisTypes":["causal-survival","causal-psm"]}'::jsonb)::text WHERE key = 'cox-ph';
UPDATE l3_model SET metadata = (COALESCE(metadata,'{}')::jsonb || '{"analysisTypes":["causal-survival"]}'::jsonb)::text WHERE key = 'kaplan-meier-estimator';
UPDATE l4_algorithm SET metadata = (COALESCE(metadata,'{}')::jsonb || '{"analysisTypes":["fl-prediction","secretflow-training"]}'::jsonb)::text WHERE key = 'federated-learning';

COMMIT;
