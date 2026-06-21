import { redirect } from "next/navigation";

// 旧的中心化多租户控制台已退役 — 其功能由联邦控制台 /space 承载
// (数据产品目录 / 数字合约 / 审计日志 等)。所有 /dashboard/* 重定向到 /space。
export default function DashboardLayout(): never {
  redirect("/space");
}
