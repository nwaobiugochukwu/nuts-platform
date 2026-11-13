"use client";

import { useAuthStore } from "@/zustand/auth";
import { logoutWithFeedback } from "@/lib/logout";
import { Button } from "@/component/ui/button";
import { useEffect, useState } from "react";

export default function LogoutPage() {
  const logout = useAuthStore((s) => s.logout);
  const [logoutFailed, setLogoutFailed] = useState(false);

  const getRedirectTarget = () => {
    const role = useAuthStore.getState().role;
    return (
      role === "admin"
        ? "/auth/admin/login"
        : role === "vendor"
        ? "/auth/vendor/login"
        : "/"
    );
  };

  useEffect(() => {
    void logoutWithFeedback(logout, { redirectTo: getRedirectTarget() }).then(
      (success) => {
        if (!success) setLogoutFailed(true);
      },
    );
  }, [logout]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      {logoutFailed ? (
        <div className="space-y-4 text-center">
          <p className="text-muted-foreground">
            Sign out could not be confirmed. Your session is still active.
          </p>
          <Button
            onClick={() =>
              void logoutWithFeedback(logout, {
                redirectTo: getRedirectTarget(),
              }).then((success) => setLogoutFailed(!success))
            }
          >
            Try again
          </Button>
        </div>
      ) : (
        <p className="text-muted-foreground">Logging out...</p>
      )}
    </div>
  );
}
