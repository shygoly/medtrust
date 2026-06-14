"use client";

import { useAuth } from "@/lib/auth";

// Renders children only if the current user's participant role is allowed.
// Coarse UI gating that mirrors the server-side ParticipantRolesGuard.
export function RoleGate({ roles, children }: { roles: string[]; children: React.ReactNode }) {
  const { user, ready } = useAuth();
  if (!ready) return null;
  if (!user?.role || !roles.includes(user.role)) return null;
  return <>{children}</>;
}
