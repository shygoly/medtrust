"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/api/client";

// Client gate for the console: redirect to /login when there's no token.
export function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ok, setOk] = useState(false);

  useEffect(() => {
    if (!api.getToken()) {
      router.replace("/login");
    } else {
      setOk(true);
    }
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
