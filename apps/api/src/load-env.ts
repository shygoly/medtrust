/**
 * 最早的 \`.env\` 装载器 —— 必须位于任何「在模块导入期读 process.env」的模块之前。
 *
 * 背景（2026-10-12 实测的**两次**静默降级）：
 *  1. \`@medtrust/database\` 的 \`data-source.ts\` 在**模块导入期**就把
 *     \`process.env.DATABASE_URL\` 冻结进 \`DataSource.options\`，而 \`ConfigModule.forRoot()\` 是在
 *     app.module 的装饰器表达式里才加载 .env —— 求值顺序上晚于前者。于是 .env 里明明写着
 *     \`DATABASE_URL=postgres://…\`，进程仍按默认值连 SQLite，且不报任何错。
 *  2. 即便改用 Node 内置的 \`process.loadEnvFile\` 也救不了测试：jest 沙箱里的 \`process\` 由
 *     jest-util 的 \`createProcessObject\` 重建，**不复制该 API**（jest 29 实测），守卫静默跳过，
 *     测试又退回 SQLite。
 * 所以这里用 dotenv（与 @nestjs/config 同一个解析器）单一路径覆盖 node 与 ts-jest。
 *
 * 语义：**已存在的环境变量优先**（\`override: false\`），容器/生产注入的 env 不会被 .env 覆盖。
 * 路径与 @nestjs/config 的默认一致：\`process.cwd()/.env\`，即 \`pnpm --filter api dev\` 下的
 * \`apps/api/.env\`；仓库根的 \`.env.example\` 只是模板。
 *
 * 末尾打印一行「主库实际会用哪个驱动」——这类静默降级不该再靠人去猜。
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { config } from "dotenv";

const envPath = join(process.cwd(), ".env");
const found = existsSync(envPath);

if (found) {
  config({ path: envPath, override: false });
}

const url = process.env.DATABASE_URL ?? "";
const driver = /^postgres(ql)?:\/\//.test(url) ? "postgres" : "better-sqlite3";
const shown = url
  ? url.split(":")[0] + ":…"
  : "未设置（代码回退 ./data/medtrust.db）";

console.log(
  `[env] ${found ? envPath : ".env 不存在"} · DATABASE_URL=${shown} → 主库驱动 ${driver}`,
);

export {};
