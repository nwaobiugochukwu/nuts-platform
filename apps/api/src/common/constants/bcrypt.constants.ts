// Cost factor 12 is a practical production baseline. Login flows upgrade weaker
// existing hashes after successful authentication and never downgrade hashes.
export const BCRYPT_COST_FACTOR = 12;

// Fixed bcrypt hash used when a login email is not found. It is intentionally
// public and avoids hashing attacker-controlled input on every unknown login.
export const UNKNOWN_ACCOUNT_PASSWORD_HASH =
  '$2b$12$TivXb9R0HwhxN/hjavR9QuxWr8bz7FnrGrjVHaPwAPDlEfhC.6DFa';
