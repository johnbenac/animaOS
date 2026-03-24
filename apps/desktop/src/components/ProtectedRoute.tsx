import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import type { ReactNode } from "react";

export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading, isProvisioned } = useAuth();

  if (isLoading) return null;

  if (!isAuthenticated) {
    return <Navigate to={isProvisioned ? "/login" : "/init"} replace />;
  }

  return <>{children}</>;
}
