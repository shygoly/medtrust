"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/api/client";
import { clearSession } from "@/lib/auth";

// Client gate for the console: redirect to /login when there's no valid token.
export function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ok, setOk] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!api.getToken()) {
        router.replace("/login");
        return;
      }
      try {
        await api.getProfile();
        if (!cancelled) setOk(true);
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
  return <>{children}</>;
}
