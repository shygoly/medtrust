"use client";

import { PageHeader } from "@/components/console/ui";
import { ChatPanel } from "@/components/console/chat/chat-panel";

export default function AssistantPage() {
  return (
    <>
      <PageHeader
        kicker="AI ASSISTANT · 全局入口"
        desc="统一进入研究设计、访问合约、结果解读、平台运维、合规证据和医院码表助手；会话、草稿与审计保持一致。"
      />
      <div className="p-8">
        <ChatPanel />
      </div>
    </>
  );
}
