import type { Repository } from "typeorm";
import type { RefreshToken, User } from "@medtrust/database";

// D-ID-3:平台管理员(admin)只能在服务器侧授予与撤销。本文件是命令的可测试核心;
// 入口见 admin-role.cli.ts。用户管理接口(AdminService)一律拒绝授予 admin 与修改 admin 账号。

export const NON_ADMIN_ROLES = [
  "provider",
  "consumer",
  "operator",
  "compliance",
] as const;
export type NonAdminRole = (typeof NON_ADMIN_ROLES)[number];

export type AdminRoleCommand =
  | { action: "grant"; email: string }
  | { action: "revoke"; email: string; role: NonAdminRole };

export interface AdminRoleResult {
  action: "grant" | "revoke";
  userId: number;
  email: string;
  previousRole: string | null;
  role: string;
  revokedRefreshTokens: number;
}

export const ADMIN_ROLE_USAGE = [
  "用法:",
  "  admin-role grant <email>",
  `  admin-role revoke <email> --role=<${NON_ADMIN_ROLES.join("|")}>`,
].join("\n");

/** 命令用法或目标不合法(以非零状态退出,不改数据)。 */
export class AdminRoleError extends Error {}

export function parseAdminRoleArgs(argv: string[]): AdminRoleCommand {
  const [action, email, ...rest] = argv;
  if (!email || !/^[^@\s]+@[^@\s]+$/.test(email)) {
    throw new AdminRoleError(`缺少或非法的邮箱。\n${ADMIN_ROLE_USAGE}`);
  }
  if (action === "grant") {
    if (rest.length)
      throw new AdminRoleError(`多余的参数。\n${ADMIN_ROLE_USAGE}`);
    return { action, email };
  }
  if (action === "revoke") {
    const role =
      rest.length === 1 ? rest[0].match(/^--role=(.+)$/)?.[1] : undefined;
    if (!role || !(NON_ADMIN_ROLES as readonly string[]).includes(role)) {
      throw new AdminRoleError(
        `撤销时必须用 --role 指定该账号的新角色。\n${ADMIN_ROLE_USAGE}`,
      );
    }
    return { action, email, role: role as NonAdminRole };
  }
  throw new AdminRoleError(ADMIN_ROLE_USAGE);
}

export async function applyAdminRole(
  repos: {
    users: Pick<Repository<User>, "findOne" | "save">;
    refreshTokens: Pick<Repository<RefreshToken>, "update">;
  },
  command: AdminRoleCommand,
): Promise<AdminRoleResult> {
  const user = await repos.users.findOne({ where: { email: command.email } });
  if (!user) throw new AdminRoleError(`用户不存在:${command.email}`);
  const previousRole = user.participantRole ?? null;

  if (command.action === "grant") {
    if (user.status === "disabled") {
      throw new AdminRoleError(
        `账号已禁用,不能授予平台管理员:${command.email}`,
      );
    }
    if (previousRole === "admin") {
      throw new AdminRoleError(`该账号已是平台管理员:${command.email}`);
    }
    user.participantRole = "admin";
    // 与用户管理一致:分配了角色即视为账号可用。
    if (user.status === "pending") user.status = "active";
  } else {
    if (previousRole !== "admin") {
      throw new AdminRoleError(
        `该账号不是平台管理员,无可撤销:${command.email}`,
      );
    }
    user.participantRole = command.role;
  }

  await repos.users.save(user);
  // 角色写在令牌里:吊销刷新令牌,迫使重新登录后才带上新角色。
  const revoked = await repos.refreshTokens.update(
    { userId: user.id, revoked: false },
    { revoked: true },
  );
  return {
    action: command.action,
    userId: user.id,
    email: user.email,
    previousRole,
    role: user.participantRole,
    revokedRefreshTokens: revoked.affected ?? 0,
  };
}
