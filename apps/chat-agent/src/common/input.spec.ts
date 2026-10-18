import { normalizeUserMessage } from './input';

describe('normalizeUserMessage（4.3.2 输入边界）', () => {
  it('非字符串一律拒（不做隐式转换）', () => {
    for (const bad of [undefined, null, 42, {}, [], true]) {
      expect(normalizeUserMessage(bad, 100)).toMatchObject({ ok: false, status: 400 });
    }
  });

  it('空白与纯控制字符视为空', () => {
    expect(normalizeUserMessage('   ', 100)).toMatchObject({ ok: false, reason: 'message 不能为空' });
    expect(normalizeUserMessage('\u0000\u0007', 100)).toMatchObject({ ok: false });
  });

  it('去掉控制字符但保留换行与制表，且不改写正文', () => {
    const result = normalizeUserMessage('  第一行\u0007\n第二行\t<40|M  ', 200);
    expect(result).toEqual({ ok: true, text: '第一行\n第二行\t<40|M' });
  });

  it('不转义 HTML：内容原样保留（前端 React 负责转义）', () => {
    const result = normalizeUserMessage('<script>alert(1)</script>', 200);
    expect(result).toEqual({ ok: true, text: '<script>alert(1)</script>' });
  });

  it('长度封顶：边界内通过，超出 413', () => {
    expect(normalizeUserMessage('x'.repeat(100), 100)).toMatchObject({ ok: true });
    const tooLong = normalizeUserMessage('x'.repeat(101), 100);
    expect(tooLong).toMatchObject({ ok: false, status: 413 });
    expect((tooLong as { reason: string }).reason).toContain('上限 100');
  });
});
