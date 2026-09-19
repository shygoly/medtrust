// 测试夹具:手写最简 wasm 模块,用来覆盖**平台模块不会出现**的失败形态
// (非法导入、无限循环、自相矛盾输出、不支持的 ABI)。测试签名与 SM3 由用例
// 用同一套 CA 现签现算,因此这些字节仍能通过双重校验、抵达被抓的那一层。
//
// 说明:手写二进制只服务于"负路径可达性",不参与平台产物(见 design D4:
// 平台模块一律由 AssemblyScript 从仓库源码构建)。

export interface FixtureSpec {
  /** 是否导入 env.memory(缺省导入,min=1,max=1024)。 */
  importMemory?: boolean;
  /** 额外导入一个函数(env.<name>)—— 违反零能力导入。 */
  importFunc?: string;
  /** run 的函数体。 */
  body?: 'trivial-return-0' | 'infinite-loop' | 'write-const';
  /** body=write-const 时从 outOff 起顺序写入的 u32 值。 */
  storeValues?: number[];
  abiVersion?: number;
  exportRun?: boolean;
  exportAbi?: boolean;
  exportMemory?: boolean;
}

function uleb(value: number): number[] {
  const out: number[] = [];
  let v = value >>> 0;
  do {
    let byte = v & 0x7f;
    v >>>= 7;
    if (v !== 0) byte |= 0x80;
    out.push(byte);
  } while (v !== 0);
  return out;
}

function utf8(text: string): number[] {
  const bytes = Array.from(Buffer.from(text, 'utf8'));
  return [...uleb(bytes.length), ...bytes];
}

function vec(items: number[][]): number[] {
  return [...uleb(items.length), ...items.flat()];
}

function section(id: number, content: number[]): number[] {
  return [id, ...uleb(content.length), ...content];
}

export function buildFixtureWasm(spec: FixtureSpec = {}): Uint8Array {
  const importMemory = spec.importMemory ?? true;
  const importFunc = spec.importFunc;
  const abiVersion = spec.abiVersion ?? 1;
  const exportRun = spec.exportRun ?? true;
  const exportAbi = spec.exportAbi ?? true;
  const exportMemory = spec.exportMemory ?? false;
  const body = spec.body ?? 'trivial-return-0';

  const bytes: number[] = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];

  // type: () -> i32 ... 实际 run 取 4 个 i32 参数,返回 i32
  bytes.push(
    ...section(1, vec([[0x60, 0x04, 0x7f, 0x7f, 0x7f, 0x7f, 0x01, 0x7f]])),
  );

  // import
  const imports: number[][] = [];
  if (importMemory) {
    imports.push([
      ...utf8('env'),
      ...utf8('memory'),
      0x02,
      0x01, // limits: has max
      ...uleb(1),
      ...uleb(1024),
    ]);
  }
  if (importFunc) {
    imports.push([...utf8('env'), ...utf8(importFunc), 0x00, ...uleb(0)]);
  }
  if (imports.length) bytes.push(...section(2, vec(imports)));

  // func
  const definedFuncs = 1;
  bytes.push(...section(3, vec([[0x00]])));

  // global abi_version
  bytes.push(
    ...section(6, vec([[0x7f, 0x00, 0x41, ...uleb(abiVersion), 0x0b]])),
  );

  // export
  const importedFuncCount = importFunc ? 1 : 0;
  const exports: number[][] = [];
  if (exportRun) {
    exports.push([...utf8('run'), 0x00, ...uleb(importedFuncCount)]);
  }
  if (exportMemory && importMemory) exports.push([...utf8('memory'), 0x02, 0x00]);
  if (exportAbi) exports.push([...utf8('abi_version'), 0x03, 0x00]);
  if (exports.length) bytes.push(...section(7, vec(exports)));

  // code
  const instructions: number[] = [];
  if (body === 'infinite-loop') {
    instructions.push(0x03, 0x40, 0x0c, 0x00, 0x0b); // loop br 0 end
    instructions.push(0x41, 0x00); // i32.const 0 (unreachable)
  } else if (body === 'write-const') {
    (spec.storeValues ?? []).forEach((value, index) => {
      instructions.push(0x20, 0x03); // local.get 3 (outOff)
      instructions.push(0x41, ...uleb(index)); // i32.const index
      instructions.push(0x6a); // i32.add
      instructions.push(0x41, ...uleb(value)); // i32.const value
      instructions.push(0x36, 0x02, 0x00); // i32.store align=2 offset=0
    });
    instructions.push(0x41, 0x00);
  } else {
    instructions.push(0x41, 0x00);
  }
  const bodyBytes = [0x00, ...instructions, 0x0b]; // locals vec = 0 + body + end
  bytes.push(...section(10, vec([[...uleb(bodyBytes.length), ...bodyBytes]])));

  void definedFuncs;
  return new Uint8Array(bytes);
}
