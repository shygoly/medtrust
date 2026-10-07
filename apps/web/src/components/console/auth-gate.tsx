"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/api/client";
import { clearSession } from "@/lib/auth";
import { isSessionRejected } from "@/lib/session-errors";

type Profile = {
  userId: number;
  email: string;
  participantId?: string;
  role?: "provider" | "consumer" | "operator" | "compliance" | "admin";
};

// Client gate for the console:
// - no valid token → /login
// - token rejected by the server (401/403) → clear session, /login?expired=1
// - network / gateway failure → keep the session and retry with backoff
// - valid token but no participant role yet (self-registered, P0-9) → pending
//   screen with logout; business console is not exposed.
export function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ok, setOk] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [reconnecting, setReconnecting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const verify = async (attempt: number) => {
      if (!api.getToken()) {
        router.replace("/login");
        return;
      }
      try {
        const p = await api.getProfile();
        if (!cancelled) {
          setProfile(p);
          setReconnecting(false);
          setOk(true);
        }
      } catch (err) {
        if (cancelled) return;
        if (isSessionRejected(err)) {
          clearSession();
          router.replace("/login?expired=1");
          return;
        }
        setReconnecting(true);
        timer = setTimeout(() => verify(attempt + 1), Math.min(1000 * 2 ** attempt, 8000));
      }
    };
    verify(0);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [router]);

  if (!ok) {
    return (
      <div className="cs flex min-h-screen items-center justify-center">
        <span className="cs-label">{reconnecting ? "网络不稳定，正在重连…" : "验证会话…"}</span>
      </div>
    );
  }

  if (!profile) {
    return null;
  }

  if (!profile.role) {
    return (
      <div className="cs flex min-h-screen items-center justify-center p-8">
        <div className="max-w-md w-full text-center space-y-4">
          <div
            className="mx-auto w-12 h-12 rounded-full flex items-center justify-center"
            style={{ background: "var(--cs-bg-2)", color: "var(--cs-amber)" }}
          >
            <span className="text-xl">!</span>
          </div>
          <h1 className="text-lg font-medium">账号待分配参与方角色</h1>
          <p className="text-sm" style={{ color: "var(--cs-dim)" }}>
            您的账号（{profile.email}）已登录,但尚未绑定参与方与角色。
            先提交机构认证，运营方审核通过并分配角色后即可访问控制台。
          </p>
          <div className="flex items-center justify-center gap-3">
            <Link href="/account/identity" className="cs-btn">
              提交或查看机构认证
            </Link>
            <button
              className="cs-btn cs-btn-ghost"
              onClick={() => {
                clearSession();
                router.replace("/login");
              }}
            >
              退出登录
            </button>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
