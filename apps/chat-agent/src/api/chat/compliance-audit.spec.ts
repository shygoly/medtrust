import type { ToolResult } from '@medtrust/pi-agent';
import { complianceAudit } from './compliance-audit';

const result = (over: Partial<ToolResult>): ToolResult => ({ success: true, ...over });

describe('合规判定的指标 / 审计提取（plan 5.1 / 5.2）', () => {
  it('submit 成功：按 compliance.status 记 ready，并带上 contractId', () => {
    expect(
      complianceAudit(
        'submit_external_control',
        'external-control',
        result({ data: { jobId: 'job-1', compliance: { status: 'ready', contractId: 'ct-1' } } }),
        'session-1',
      ),
    ).toEqual({
      verdict: 'ready',
      action: 'job_submit',
      scenario: 'external-control',
      tool: 'submit_external_control',
      contractId: 'ct-1',
      entry: {
        action: 'COMPUTE',
        resource: 'rws-task',
        details: {
          source: 'ai-chat-agent',
          sessionId: 'session-1',
          scenario: 'external-control',
          jobId: 'job-1',
          contractId: 'ct-1',
          verdict: 'ready',
        },
      },
    });
  });

  it('submit 被闸拦下 → 记"判定"而不是"动作"（资源是 compliance-gate，动作是 READ）', () => {
    const record = complianceAudit(
      'submit_external_control',
      'external-control',
      result({
        success: false,
        error: '没有覆盖 p-sponsor 与 p-hosp-a 的生效合约',
        data: { compliance: { status: 'needs_contract', fix: 'request_contract', contractId: null } },
      }),
      'session-9',
    );

    expect(record?.entry).toEqual({
      action: 'READ',
      resource: 'compliance-gate',
      details: {
        source: 'ai-chat-agent',
        sessionId: 'session-9',
        scenario: 'external-control',
        verdict: 'needs_contract',
        contractId: null,
        fix: 'request_contract',
      },
    });
    // 原因（人话）不进审计 details：审计留标识与判定，解释留在对话里
    expect(JSON.stringify(record?.entry.details)).not.toContain('生效合约');
  });

  it('submit 成功但没关联合约 → contractId 记 null（口径要能看出缺口，而不是省略字段）', () => {
    const record = complianceAudit(
      'submit_external_control',
      'external-control',
      result({ data: { jobId: 'job-2', compliance: { status: 'unknown' } } }),
    );
    expect(record?.entry.details).toMatchObject({ contractId: null, verdict: 'unknown' });
  });

  it('submit 被闸拦下：原因分得开（权限 / 合约 / 未知）', () => {
    for (const status of ['needs_permission', 'needs_contract', 'unknown']) {
      expect(
        complianceAudit(
          'submit_cohort_count',
          'cohort-count',
          result({ success: false, error: 'x', data: { compliance: { status } } }),
        )?.verdict,
      ).toBe(status);
    }
  });

  it('不带合规判定的工具调用不产出记录（不把无关工具也算进合规指标）', () => {
    expect(complianceAudit('list_participants', 'other', result({ data: { items: [] } }))).toBeNull();
    expect(complianceAudit('submit_external_control', 'external-control', undefined)).toBeNull();
  });

  it('request_contract：成功记 contract_requested 并带 contractId', () => {
    expect(
      complianceAudit(
        'request_contract',
        'other',
        result({
          data: {
            contractId: 'ct-9',
            status: 'draft',
            contractRequest: { fix: 'await_provider_approval', compositionId: 'comp-1' },
          },
        }),
      ),
    ).toMatchObject({ verdict: 'contract_requested', action: 'contract_request', contractId: 'ct-9' });
  });

  it('request_contract 成功 → 审计链记 CREATE/contract（平台里真的多了一份草稿）', () => {
    const record = complianceAudit(
      'request_contract',
      'other',
      result({
        data: {
          contractId: 'ct-9',
          status: 'draft',
          contractRequest: { fix: 'await_provider_approval', compositionId: 'comp-1' },
        },
      }),
      'session-2',
    );

    expect(record?.entry).toEqual({
      action: 'CREATE',
      resource: 'contract',
      details: {
        source: 'ai-chat-agent',
        sessionId: 'session-2',
        contractId: 'ct-9',
        status: 'draft',
        compositionId: 'comp-1',
        verdict: 'contract_requested',
      },
    });
  });

  it('request_contract 的自动推进结果分项：ready / offered / skipped（Phase 5.2 合约创建成功率）', () => {
    const cls = (data: Record<string, unknown>, success = true) =>
      complianceAudit('request_contract', 'other', result({ success, data }))?.autoOffer;

    expect(cls({ contractId: 'ct-1', status: 'active', autoOffered: true })).toBe('ready');
    expect(cls({ contractId: 'ct-2', status: 'draft', autoOffered: true })).toBe('offered');
    expect(cls({ contractId: 'ct-3', status: 'draft', autoOffered: false })).toBe('skipped');
    // 失败一律记 skipped（没推进成）
    expect(
      cls({ contractRequest: { fix: 'create_pre_review' } }, false),
    ).toBe('skipped');
  });

  it('request_contract 失败 → 审计链记 READ/contract，并写明是哪种前置条件不满足', () => {
    const record = complianceAudit(
      'request_contract',
      'other',
      result({
        success: false,
        error: '本方还没有合规预审组合',
        data: { contractRequest: { fix: 'create_pre_review' } },
      }),
    );

    expect(record?.entry).toMatchObject({
      action: 'READ',
      resource: 'contract',
      details: { verdict: 'create_pre_review', source: 'ai-chat-agent' },
    });
  });

  it('request_contract 失败：按 fix 分类（缺预审 / 缺登录态 / 硬失败）', () => {
    const verdict = (fix?: string) =>
      complianceAudit(
        'request_contract',
        'other',
        result({ success: false, error: 'x', data: { contractRequest: fix ? { fix } : {} } }),
      )?.verdict;

    expect(verdict('create_pre_review')).toBe('create_pre_review');
    expect(verdict('sign_in')).toBe('sign_in');
    expect(verdict()).toBe('contract_request_failed');
  });
});
