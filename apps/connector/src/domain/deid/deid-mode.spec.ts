// 通道开关：`CONNECTOR_DEID_MODE=builtin|agent`（design §9）。
import {
  DeidBypassForbidden,
  assertNoBuiltinBypass,
  resolveDeidMode,
} from './deid-mode';

describe('resolveDeidMode', () => {
  it('缺省 builtin（不改变既有部署行为）', () => {
    expect(resolveDeidMode(undefined)).toBe('builtin');
    expect(resolveDeidMode('')).toBe('builtin');
    expect(resolveDeidMode('  ')).toBe('builtin');
  });

  it('显式 agent / builtin（大小写与空白不影响）', () => {
    expect(resolveDeidMode('agent')).toBe('agent');
    expect(resolveDeidMode(' AGENT ')).toBe('agent');
    expect(resolveDeidMode('builtin')).toBe('builtin');
  });

  it('非法值不静默回落，直接判配置错误', () => {
    expect(() => resolveDeidMode('agentt')).toThrow(/CONNECTOR_DEID_MODE 非法/);
    expect(() => resolveDeidMode('wasm')).toThrow(/CONNECTOR_DEID_MODE 非法/);
  });
});

describe('assertNoBuiltinBypass', () => {
  it('builtin 模式允许本地脱敏', () => {
    expect(() => assertNoBuiltinBypass('builtin', 'LocalDataLoader')).not.toThrow();
  });

  it('agent 模式下本地脱敏是硬错误（不退回弱脱敏）', () => {
    expect(() => assertNoBuiltinBypass('agent', 'LocalDataLoader')).toThrow(
      DeidBypassForbidden,
    );
  });
});
