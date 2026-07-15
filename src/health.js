export function summarizeAccountHealth(accounts) {
  const enabled = accounts.filter((account) => account.enabled);
  const connected = enabled.filter((account) => account.status === "connected");
  const actionRequired = enabled.filter((account) =>
    account.status === "logged_out" ||
    account.status === "pairing_required" ||
    account.status === "pairing_code_issued"
  );

  let state = "idle";
  if (enabled.length > 0 && connected.length === enabled.length) state = "healthy";
  else if (actionRequired.length > 0) state = "action_required";
  else if (enabled.length > 0) state = "degraded";

  return {
    state,
    enabled: enabled.length,
    connected: connected.length,
    actionRequired: actionRequired.length,
    healthy: state === "idle" || state === "healthy"
  };
}
