"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Legacy registration form entry.
 *
 * The supported happy path is the AI assistant: login, deterministic cards,
 * job execution, report build and evidence download. Keeping this route as a
 * redirect preserves old bookmarks without maintaining a second write path.
 */
export default function LegacyRegistrationPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace(
      "/space/assistant?prompt=" +
        encodeURIComponent("创建一项单臂外部对照注册研究并生成模拟报告"),
    );
  }, [router]);
  return (
    <div className="p-8 text-sm" role="status">
      正在转到 AI 助手…
    </div>
  );
}
