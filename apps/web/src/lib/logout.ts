import { getApiErrorMessage } from "@/api/core/error";
import type { LogoutOptions } from "@/zustand/auth";
import { toast } from "sonner";

type LogoutAction = (options?: LogoutOptions) => Promise<void>;

export async function logoutWithFeedback(
  logout: LogoutAction,
  options: LogoutOptions,
): Promise<boolean> {
  try {
    await logout(options);
    return true;
  } catch (error) {
    toast.error(
      getApiErrorMessage(
        error,
        "Sign out failed. Your session is still active; please try again.",
      ),
    );
    return false;
  }
}
