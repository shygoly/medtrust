#!/usr/bin/env node
/**
 * 连接器 SM2 密钥本地生成（D-MDOP-3 / 任务 4.4）。
 *
 * 参与方密钥一律由参与方自己生成：本脚本在院内生成密钥对，私钥以 **0600** 落到
 * 本地文件，只把公钥交给平台 CA 签发证书。平台侧已删除代生成路径——注册不带公钥即被拒。
 *
 *   node apps/connector/scripts/keygen.mjs [--out data/connector-sm2.key] [--force]
 *
 * 输出：公钥（未压缩点 04‖x‖y）、kid（公钥 SM3 全长）与下一步注册命令提示。
 */
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const mdop = require('@medtrust/mdop');

const args = process.argv.slice(2);
const readFlag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};

const out = resolve(readFlag('--out', 'data/connector-sm2.key'));
const force = args.includes('--force');

if (existsSync(out) && !force) {
  console.error(
    `[拒绝] 私钥文件已存在：${out}\n` +
      '重新生成会让已注册的证书失效（平台 CA 里是旧公钥）。确认要换钥匙再加 --force。\n' +
      '（轮换流程：先 deregister 旧证书，再 keygen --force 并重新注册。）',
  );
  process.exit(1);
}

const pair = mdop.generateSm2KeyPair();
mkdirSync(dirname(out), { recursive: true });
// 先以 0600 创建再写入，避免短暂的宽松权限窗口。
writeFileSync(out, `${pair.privateKey}\n`, { mode: 0o600 });
chmodSync(out, 0o600);

const kid = mdop.publicKeyKid(pair.publicKey);
console.log('连接器 SM2 密钥已生成（私钥只在本地，平台不会接触）：');
console.log(`  私钥文件   ${out}（0600）`);
console.log(`  公钥       ${pair.publicKey}`);
console.log(`  kid        ${kid}`);
console.log('');
console.log('在连接器部署配置里加：');
console.log(`  CONNECTOR_SM2_PRIVATE_KEY_FILE=${out}`);
console.log('然后带公钥去注册（平台不代生成）：');
console.log(
  `  node apps/connector/scripts/register.mjs --connector-id <connectorId> --participant-id <participantId> --token <operator JWT>`,
);
