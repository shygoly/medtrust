describe('定点校验指标出域（任务 3.4）', () => {
  it('AUC 等于定点参考，小样本不交出 AUC', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { algorithmValidationStageSandbox } = await import('@medtrust/domain-med');
    const { VALIDATION_Q, decodeValidationMetrics } = await import('@medtrust/wasm-algorithms');

    const rows = [
      { subjectKey: 'sk-1', eventOccurred: true, observations: { score: 0.75 } },
      { subjectKey: 'sk-2', eventOccurred: true, observations: { score: 0.25 } },
      { subjectKey: 'sk-3', eventOccurred: false, observations: { score: 0.5 } },
      { subjectKey: 'sk-4', eventOccurred: false, observations: { score: 0 } },
    ];

    const wasmPath = join(
      __dirname,
      '../../../../../packages/wasm-algorithms/build/algorithm-validation.wasm',
    );
    const bytes = readFileSync(wasmPath);
    const memory = new WebAssembly.Memory({ initial: 2, maximum: 1024 });
    const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), { env: { memory } });
    const payload = await algorithmValidationStageSandbox.runStage({
      spaceId: 'sh-med',
      stageInput: {
        stage: {
          params: { scoreField: 'score', labelField: 'eventOccurred', minCell: 1 },
          output_schema: 'rws.algorithm-validation/1.0',
        },
      },
      moduleSm3: 'test',
      rowsByRole: () => new Map(),
      codeWhitelist: () => undefined,
      tables: () => [{ node: 'a', rows }],
      strataKeys: () => undefined,
      configuredStrataKeys: () => undefined,
      runSandbox: async (request) => {
        expect(request.abi).toBe('validation-metrics@1');
        new Uint8Array(memory.buffer).set(request.input, 0);
        const code = (
          instance.exports as { run: (a: number, b: number, c: number, d: number) => number }
        ).run(0, request.n ?? 0, request.k ?? 0, request.outOff);
        expect(code).toBe(0);
        const output = new Uint8Array(memory.buffer, request.outOff, request.outBytes).slice();
        const fitted = decodeValidationMetrics(output);
        expect(fitted.aucQ).toBe((3 * VALIDATION_Q) / 4);
        return { output };
      },
    });
    const body = (
      payload as {
        payload: {
          cohortSize: number;
          suppressed: boolean;
          effectEstimate: { beta: number; measure: string };
        };
      }
    ).payload;
    expect(body.cohortSize).toBe(4);
    expect(body.suppressed).toBe(false);
    expect(body.effectEstimate.measure).toBe('auc');
    expect(body.effectEstimate.beta).toBe(0.75);
    expect(JSON.stringify(body)).not.toContain('sk-1');
  });
});
