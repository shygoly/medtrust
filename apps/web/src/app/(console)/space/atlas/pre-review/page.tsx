import { redirect } from "next/navigation";

/**
 * L2 合规预审页面 - 重定向到 compose
 *
 * 历史原因：此路由曾是 compose 页的副本（264 行）。
 * 现已改为重定向，消除副本、保留 URL 向后兼容。
 *
 * 参考：openspec/changes/mdop-rws-ladder-migration/design.md D9.2
 */
export default function PreReviewPage() {
  redirect("/space/atlas/compose");
}
