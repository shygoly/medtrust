// algorithm-sandbox — worker 内运行器(design D1/D2/D10)。
//
// worker 用 `worker_threads` 启动,不继承宿主环境变量(`env: {}`)、不带 execArgv、
// 受 `resourceLimits` 约束。宿主只注入一块有上限的 `WebAssembly.Memory`;worker 内
// 只做:编译 → 选一块模块接受的内存上限 → 写入输入 → 调用 run → 读回输出。
//
// 源码以字符串常量内联并 `eval: true` 启动:worker 只有一段代码、无模块解析,
// 因此 ts-jest(src/)与 nest build(dist/)下路径行为完全一致,且 worker 不需要
// (也不允许)加载任何宿主模块。
export const SANDBOX_WORKER_SOURCE = String.raw`
const { parentPort } = require('worker_threads');

// 候选内存上限(页,1 页 = 64KiB)。模块通过导入内存类型声明自己的上限,
// 宿主注入的内存必须"不大于"它。从沙箱配置上限开始向下探测第一个能被模块接受的。
function candidateMaxima(configPages) {
  const cands = [];
  for (let p = configPages; p >= 1; p = Math.floor(p / 2)) cands.push(p);
  return [...new Set(cands)];
}

parentPort.on('message', (msg) => {
  try {
    const bytes = new Uint8Array(msg.moduleBytes);
    const mod = new WebAssembly.Module(bytes);
    const input = new Uint8Array(msg.input);
    const outOff = msg.outOff;
    const outBytes = msg.outBytes;
    const neededPages = Math.max(1, Math.ceil((outOff + outBytes) / 65536));

    if (neededPages > msg.configMaxPages) {
      parentPort.postMessage({
        ok: false,
        reason: 'memory-limit',
        error:
          '输入所需内存 ' + neededPages + ' 页 > 沙箱上限 ' + msg.configMaxPages + ' 页',
      });
      return;
    }

    let memory = null;
    let maxPages = 0;
    let lastError = null;
    for (const candidate of candidateMaxima(msg.configMaxPages)) {
      if (candidate < neededPages) continue;
      const candidateMemory = new WebAssembly.Memory({
        initial: neededPages,
        maximum: candidate,
      });
      try {
        new WebAssembly.Instance(mod, { env: { memory: candidateMemory } });
        memory = candidateMemory;
        maxPages = candidate;
        break;
      } catch (err) {
        lastError = err;
      }
    }
    if (!memory) {
      parentPort.postMessage({
        ok: false,
        reason: 'instantiate-failed',
        error:
          '模块声明的内存上限与沙箱配置不兼容: ' +
          (lastError && lastError.message ? lastError.message : String(lastError)),
      });
      return;
    }

    const instance = new WebAssembly.Instance(mod, { env: { memory } });
    const abiVersion = instance.exports.abi_version.value;
    new Uint8Array(memory.buffer, 0, input.length).set(input);

    const startedAt = Date.now();
    const rc = instance.exports.run(0, msg.n, msg.k, outOff);
    const durationMs = Date.now() - startedAt;
    if (rc !== 0) {
      parentPort.postMessage({ ok: false, reason: 'module-error', error: 'run 返回非零: ' + rc });
      return;
    }
    const out = new Uint8Array(memory.buffer, outOff, outBytes).slice();
    // envVarCount:worker 不继承宿主环境变量(D1),如实回传给宿主记进审计。
    parentPort.postMessage(
      {
        ok: true,
        output: out.buffer,
        abiVersion,
        memoryPages: maxPages,
        durationMs,
        envVarCount: Object.keys(process.env).length,
      },
      [out.buffer],
    );
  } catch (err) {
    parentPort.postMessage({
      ok: false,
      reason: 'worker-error',
      error: err && err.message ? err.message : String(err),
    });
  }
});
`;
