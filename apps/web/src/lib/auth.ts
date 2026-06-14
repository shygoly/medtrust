"use client";

import { useEffect, useState } from "react";
import { api } from "@/api/client";

export interface AuthUser {
  id: number;
  email: string;
  name?: string;
  role?: "provider" | "consumer" | "operator";
  participantId?: string;
}

const USER_KEY = "medtrust_user";

export function saveSession(token: string, user: AuthUser) {
  api.setToken(token);
  if (typeof window !== "undefined") localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession() {
  api.clearToken();
  if (typeof window !== "undefined") localStorage.removeItem(USER_KEY);
}

export function getUser(): AuthUser | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(USER_KEY);
  return raw ? (JSON.parse(raw) as AuthUser) : null;
}

export const roleLabel: Record<string, string> = {
  provider: "数据提供方",
  consumer: "数据使用方",
  operator: "运营 / 监管方",
};

// Client hook: current session user + role, with a ready flag (localStorage is
// only available after mount, so SSR renders nothing role-specific).
export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setUser(getUser());
    setReady(true);
  }, []);
  return {
    user,
    ready,
    role: user?.role,
    logout: () => {
      clearSession();
      window.location.href = "/login";
    },
  };
}
