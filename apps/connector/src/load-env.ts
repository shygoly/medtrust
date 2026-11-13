/**
 * 连接器自己的 `.env` 必须在导入 `@medtrust/database` 之前装入。
 * `ConnectorDataSource` 在模块导入期就把 `CONNECTOR_DB_URL` / `DB_SYNCHRONIZE` 冻结进配置，
 * `ConfigModule.forRoot()` 晚于这一步。已存在的环境变量优先。测试不读这份文件。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const envPath = join(__dirname, "..", ".env");

if (process.env.NODE_ENV !== "test" && existsSync(envPath)) {
  for (const raw of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

const url = process.env.CONNECTOR_DB_URL ?? "";
const driver = /^postgres(ql)?:\/\//.test(url) ? "postgres" : "INVALID";
const shown = url ? `${url.split(":")[0]}:…` : "未设置（将回落到本机默认库）";
console.log(
  `[env] ${existsSync(envPath) ? envPath : ".env 不存在"} · CONNECTOR_DB_URL=${shown} → ${driver}`,
);

export {};
