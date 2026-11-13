/**
 * Formats backend error responses from Google Auth into clean, actionable
 * user-facing messages and identifies structured error states (e.g. suspension,
 * approval pending, maintenance mode).
 */

export interface GoogleAuthParsedError {
  message: string;
  isSuspended: boolean;
  isDeactivated: boolean;
  isPendingApproval: boolean;
  isMaintenanceMode: boolean;
  isRegistrationsClosed: boolean;
  isAccountAlreadyExists: boolean;
  isGoogleAccountNotFound: boolean;
  suspensionInfo?: {
    reason?: string;
    suspendedUntil?: string | null;
  };
}

export function parseGoogleAuthError(err: unknown): GoogleAuthParsedError {
  const data = (
    err as {
      response?: {
        status?: number;
        data?: {
          message?: string | string[];
          error?: {
            code?: string;
            reason?: string;
            suspendedUntil?: string | null;
          };
          code?: string;
          reason?: string;
          suspendedUntil?: string | null;
          maintenanceMode?: boolean;
        };
      };
    }
  )?.response?.data;

  const status = (err as { response?: { status?: number } })?.response?.status;
  const isDirectPending =
    typeof err === "object" &&
    err !== null &&
    "isPendingApproval" in err &&
    err.isPendingApproval === true;
  const directMessage = err instanceof Error ? err.message : null;

  const rawMsg = data?.message ?? directMessage;
  const msg = Array.isArray(rawMsg)
    ? rawMsg.join(", ")
    : typeof rawMsg === "string"
      ? rawMsg
      : "Google authentication failed. Please try again.";

  const isMaintenanceMode = Boolean(
    data?.maintenanceMode || (status === 503 && msg.toLowerCase().includes("maintenance"))
  );
  const isRegistrationsClosed = Boolean(
    status === 503 && msg.toLowerCase().includes("disabled")
  );
  const isPendingApproval = Boolean(
    isDirectPending ||
    msg.toLowerCase().includes("not approved") ||
    msg.toLowerCase().includes("pending approval") ||
    msg.toLowerCase().includes("under review")
  );
  const isDeactivated = Boolean(
    msg.toLowerCase().includes("deactivated") ||
    data?.code === "ACCOUNT_DEACTIVATED" ||
    msg === "ACCOUNT_DEACTIVATED"
  );
  const isSuspended = Boolean(
    data?.error?.code === "ACCOUNT_SUSPENDED" ||
    data?.code === "ACCOUNT_SUSPENDED" ||
    msg.toLowerCase().includes("suspended")
  );
  const errorCode = data?.error?.code ?? data?.code;
  const normalizedMessage = msg.toLowerCase();
  const isAccountAlreadyExists = Boolean(
    errorCode === "GOOGLE_ACCOUNT_EXISTS" ||
    errorCode === "ACCOUNT_ALREADY_EXISTS" ||
    (status === 409 && normalizedMessage.includes("already exists"))
  );
  const isGoogleAccountNotFound = Boolean(
    errorCode === "GOOGLE_ACCOUNT_NOT_FOUND" ||
    normalizedMessage.includes("no customer account is associated") ||
    normalizedMessage.includes("no vendor account is associated")
  );

  let suspensionInfo: { reason?: string; suspendedUntil?: string | null } | undefined;
  if (isSuspended) {
    suspensionInfo = {
      reason: data?.error?.reason || data?.reason || "Administrative review or policy violation.",
      suspendedUntil: data?.error?.suspendedUntil || data?.suspendedUntil || null,
    };
  }

  let userMessage = msg;
  if (isMaintenanceMode) {
    userMessage = msg || "The platform is currently under maintenance. Please check back shortly.";
  } else if (isRegistrationsClosed) {
    userMessage = msg || "New registrations are currently closed by platform administration.";
  } else if (isPendingApproval) {
    userMessage = "Your merchant account is pending review. You will receive an email once approved.";
  } else if (isDeactivated) {
    userMessage = "This account was previously deactivated. Please reactivate your account or contact support.";
  }

  return {
    message: userMessage,
    isSuspended,
    isDeactivated,
    isPendingApproval,
    isMaintenanceMode,
    isRegistrationsClosed,
    isAccountAlreadyExists,
    isGoogleAccountNotFound,
    suspensionInfo,
  };
}
