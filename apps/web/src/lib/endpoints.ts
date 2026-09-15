// WebSocket 基址。生产构建 NEXT_PUBLIC_API_URL=/api/v1（同源，由 nginx 在服务器本机转给 API），
// WS 跟随页面同源；原生 WebSocket 需要绝对 ws/wss 地址，所以从页面地址推导。本地开发保持直连 :5021。

export function resolveWsBase(
  apiBase: string,
  configuredWs: string | undefined,
  location: { protocol: string; host: string } | undefined,
): string {
  if (configuredWs) return configuredWs.replace(/\/$/, "");
  if (apiBase.startsWith("/") && location) {
    return `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}`;
  }
  return "ws://localhost:5021";
}
