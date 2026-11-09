export async function request(url, method = "GET", body) {
  const response = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const message = response.status === 404
      ? "This MyMusics server does not have this feature yet. Install the latest release, restart MyMusics, and reload this page."
      : `The server returned a non-JSON response (HTTP ${response.status}). Restart MyMusics and try again.`;
    throw new Error(message);
  }
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Request could not be completed.");
  return result;
}
