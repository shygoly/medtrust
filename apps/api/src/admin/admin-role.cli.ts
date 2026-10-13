/**
 * 平台管理员(admin)的服务器侧授予 / 撤销命令(D-ID-3)。
 *
 * 只能在 API 所在的服务器或容器内执行——它直连数据库,不经过任何网络接口:
 *
 *   node dist/admin/admin-role.cli.js grant <email>
 *   node dist/admin/admin-role.cli.js revoke <email> --role=<provider|consumer|operator|compliance>
 *
 * 数据库取自与 API 相同的环境变量(DATABASE_URL)。执行后该用户的刷新令牌全部吊销,
 * 重新登录后生效;被撤销者的访问令牌在到期前仍带旧角色,需要立即生效时同时禁用该账号。
 *
 * 本命令**不写链式审计日志**:audit_logs 的哈希链只应由运行中的 API 单进程追加,
 * 第二个进程并发追加可能使链分叉。执行记录以一行 JSON 打到标准输出,请留存。
 */
import "../load-env";
import { hostname, userInfo } from "os";
import { DataSource, DataSourceOptions } from "typeorm";
import { AppDataSource, RefreshToken, User } from "@medtrust/database";
import {
  AdminRoleError,
  applyAdminRole,
  parseAdminRoleArgs,
} from "./admin-role";

async function main(): Promise<number> {
  let command;
  try {
    command = parseAdminRoleArgs(process.argv.slice(2));
  } catch (error) {
    console.error((error as Error).message);
    return 2;
  }

  // 只读写两张表,不做结构同步(开发环境的 synchronize 交给 API 进程)。
  const dataSource = new DataSource({
    ...AppDataSource.options,
    synchronize: false,
    migrationsRun: false,
  } as DataSourceOptions);
  await dataSource.initialize();
  try {
    const result = await applyAdminRole(
      {
        users: dataSource.getRepository(User),
        refreshTokens: dataSource.getRepository(RefreshToken),
      },
      command,
    );
    console.log(
      JSON.stringify({
        at: new Date().toISOString(),
        // 执行者取操作系统账号与主机名(不读环境变量:它们可被随意设置,也不属于部署配置)。
        by: `${userInfo().username}@${hostname()}`,
        ...result,
      }),
    );
    return 0;
  } catch (error) {
    if (!(error instanceof AdminRoleError)) throw error;
    console.error(error.message);
    return 1;
  } finally {
    await dataSource.destroy();
  }
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
