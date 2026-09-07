"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/api/client";
import { clearSession } from "@/lib/auth";

type Profile = {
  userId: number;
  email: string;
  participantId?: string;
  role?: "provider" | "consumer" | "operator" | "compliance" | "admin";
};

// Client gate for the console:
// - no valid token → /login
// - valid token but no participant role yet (self-registered, P0-9) → pending
//   screen with logout; business console is not exposed.
export function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ok, setOk] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!api.getToken()) {
        router.replace("/login");
        return;
      }
      try {
        const p = await api.getProfile();
        if (!cancelled) {
          setProfile(p);
          setOk(true);
        }
      } catch {
        clearSession();
        if (!cancelled) router.replace("/login?expired=1");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (!ok) {
    return (
      <div className="cs flex min-h-screen items-center justify-center">
        <span className="cs-label">验证会话…</span>
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
            请联系运营方完成机构认证审核与角色分配后再访问控制台。
          </p>
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
    );
  }

  return <>{children}</>;
}
