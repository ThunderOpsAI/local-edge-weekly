function getInternalBaseUrl() {
  const port = process.env.PORT || "3000";
  return `http://127.0.0.1:${port}`;
}

export function getDispatchRunsUrl() {
  return `${getInternalBaseUrl()}/api/internal/dispatch-runs`;
}
