import { JsonLogger, pseudonymize, redact } from './json.logger';

const capture = (options?: Partial<ConstructorParameters<typeof JsonLogger>[0]>) => {
  const lines: string[] = [];
  const logger = new JsonLogger({ sink: (line) => lines.push(line), ...options });
  return { logger, lines, parsed: () => lines.map((line) => JSON.parse(line)) };
};

describe('JsonLogger（结构化日志）', () => {
  it('一行一条 JSON，含时间/级别/上下文', () => {
    const { logger, parsed } = capture();
    logger.log('hello', 'ChatService');
    const record = parsed()[0];
    expect(record).toMatchObject({ level: 'info', message: 'hello', context: 'ChatService' });
    expect(record.time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('对象消息进 fields 并打码敏感键（令牌 / 口令 / 请求体 / 用户原话）', () => {
    const { logger, parsed } = capture();
    logger.log(
      {
        event: 'chat_completed',
        authorization: 'Bearer secret-token',
        token: 't',
        values: { trial: 'p-sponsor' },
        content: '患者姓名张三',
        sessionId: 's-1',
      },
      'ChatService',
    );
    const fields = parsed()[0].fields as Record<string, unknown>;
    expect(fields.authorization).toBe('[redacted]');
    expect(fields.token).toBe('[redacted]');
    expect(fields.values).toBe('[redacted]');
    expect(fields.content).toBe('[redacted]');
    expect(fields.sessionId).toBe('s-1');
  });

  it('超长字符串截断，避免日志变成数据出口', () => {
    const { logger, parsed } = capture();
    logger.log({ note: 'x'.repeat(5000) });
    const note = (parsed()[0].fields as Record<string, string>).note;
    expect(note.length).toBeLessThan(300);
    expect(note).toContain('[truncated]');
  });

  it('级别过滤：低于阈值的不输出', () => {
    const { logger, lines } = capture({ level: 'warn' });
    logger.log('info');
    logger.debug('debug');
    expect(lines).toHaveLength(0);
    logger.warn('warn');
    expect(lines).toHaveLength(1);
    logger.error('boom');
    expect(lines).toHaveLength(2);
  });

  it('error 带 trace；pretty 格式输出可读行', () => {
    const json = capture();
    json.logger.error('boom', 'at line 1', 'ChatService');
    expect(json.parsed()[0].trace).toBe('at line 1');

    const pretty = capture({ format: 'pretty' });
    pretty.logger.log({ event: 'x' }, 'Ctx');
    expect(pretty.lines[0]).toContain('[info]');
    expect(pretty.lines[0]).toContain('{"event":"x"}');
  });

  it('嵌套对象与数组同样打码，且层级/长度封顶', () => {
    const redacted = redact({
      outer: { authorization: 'Bearer x', list: [{ token: 't' }, 1, 2] },
      deep: { a: { b: { c: { d: { e: 1 } } } } },
    }) as Record<string, any>;
    expect(redacted.outer.authorization).toBe('[redacted]');
    expect(redacted.outer.list[0].token).toBe('[redacted]');
    expect(JSON.stringify(redacted.deep)).toContain('depth-limited');

    expect(redact(new Array(100).fill(1))).toHaveLength(20);
  });

  it('pseudonymize：稳定、不可逆、不等于原值', () => {
    const a = pseudonymize('42');
    expect(a).toBe(pseudonymize('42'));
    expect(a).not.toBe('42');
    expect(a).toHaveLength(10);
    expect(pseudonymize('')).toBeNull();
    expect(pseudonymize(undefined)).toBeNull();
  });
});
