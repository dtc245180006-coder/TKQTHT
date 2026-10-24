export async function api(url, method = "GET", body) {
  const response = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token":
        document.querySelector('meta[name="csrf-token"]')?.content || "",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  if (
    response.status === 401 &&
    result.code === "AUTH_REQUIRED" &&
    document.body.dataset.role !== "guest"
  ) {
    window.location.assign(
      `/login?next=${encodeURIComponent(window.location.pathname)}`,
    );
  }
  if (!response.ok || !result.success)
    throw new Error(result.message || "Không thể xử lý yêu cầu");
  return result.data;
}
