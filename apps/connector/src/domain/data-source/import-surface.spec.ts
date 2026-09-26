// omop-data-source-access task 4.2 —— 接库之后，Wasm 模块的导入面**不变**。
//
// 数据库句柄由连接器独占（D-CN-6）：模块拿到的只有连接器投影好的整数列，
// 没有、也不能有任何「查数据」的接口。这里把最容易被「顺手加上」的几种数据访问导入
// 逐个喂给准入校验，断言它们和任何其它非白名单导入一样在实例化前被拒。
import { verifyModule, ModuleVerificationError } from '../sandbox/module-verifier';
import { sm3BytesHex } from '../sm3';
// 用平台准入与连接器共享的判定包里的构造器：它能造 WASI 导入。
import { buildFixtureWasm } from '@medtrust/wasm-algorithms';
import {
  PLATFORM_MODULE_ANALYSIS_TYPE,
  PLATFORM_MODULE_BYTES,
  PLATFORM_MODULE_SM3,
  newTestCa,
} from '../sandbox/__fixtures__/platform-module';

function rejectionOf(bytes: Uint8Array): ModuleVerificationError | undefined {
  const ca = newTestCa();
  try {
    verifyModule(bytes, {
      analysisType: PLATFORM_MODULE_ANALYSIS_TYPE,
      expectedSm3: sm3BytesHex(bytes),
      signature: ca.sign(bytes), // 签名是真的——拦它的只能是导入白名单
      registryPublicKey: ca.publicKey,
    });
  } catch (err) {
    return err as ModuleVerificationError;
  }
  return undefined;
}

describe('Wasm 导入面不因数据库接入而扩大（4.2）', () => {
  it.each(['cdm_query', 'sql_exec', 'db_connect', 'fetch_rows', 'read_view'])(
    '导入 env.%s（数据查询接口）→ 实例化前拒绝',
    (name) => {
      const err = rejectionOf(buildFixtureWasm({ importFunc: name }));
      expect(err?.reason).toBe('illegal-import');
      expect(err?.message).toContain(`env.${name}`);
    },
  );

  it.each(['fd_read', 'path_open', 'sock_recv'])(
    '导入 wasi_snapshot_preview1.%s（文件 / 网络读取）→ 实例化前拒绝',
    (name) => {
      const err = rejectionOf(buildFixtureWasm({ importWasi: name }));
      expect(err?.reason).toBe('illegal-import');
    },
  );

  it('在用的平台模块导入面恰为一块宿主内存', () => {
    const imports = WebAssembly.Module.imports(new WebAssembly.Module(PLATFORM_MODULE_BYTES));
    expect(imports).toEqual([{ module: 'env', name: 'memory', kind: 'memory' }]);
    // 而它照样通过准入：白名单没有为接库而放宽，也不需要放宽。
    const ca = newTestCa();
    expect(
      verifyModule(PLATFORM_MODULE_BYTES, {
        analysisType: PLATFORM_MODULE_ANALYSIS_TYPE,
        expectedSm3: PLATFORM_MODULE_SM3,
        signature: ca.sign(PLATFORM_MODULE_BYTES),
        registryPublicKey: ca.publicKey,
      }).sm3,
    ).toBe(PLATFORM_MODULE_SM3);
  });
});
