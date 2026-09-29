import { createBackendCore, type BackendCore } from "@unilab-fe/core";
import {
  createServices,
  type BackendConfig,
  type Services,
} from "@unilab/services";

export interface StudioBackend {
  readonly core: BackendCore;
  readonly services: Services;
  readonly config: BackendConfig;
}

/**
 * 浏览器应用只通过这个 composition root 获取领域 port。
 * 默认走同源代理，生产环境可通过 VITE_UNILAB_API_URL 指向 Edge / OS。
 */
export function createStudioBackend(): StudioBackend {
  const backendId = import.meta.env.VITE_UNILAB_BACKEND_ID || "local-python";
  const configuredBaseUrl =
    import.meta.env.VITE_UNILAB_API_URL ||
    import.meta.env.VITE_EDGE_API_URL ||
    "/__unilab_backend";
  // services 构造工作流 SSE 地址时需要绝对 URL；同源代理仍然保留原始路径。
  const baseUrl = new URL(configuredBaseUrl, window.location.origin)
    .toString()
    .replace(/\/$/, "");
  const config: BackendConfig = {
    id: backendId,
    name: "Uni-Lab OS",
    protocol: "unilab/v1",
    apiUrl: baseUrl,
    auth: "none",
    serverKind: backendId === "local-go" ? "backend" : "edge",
    workspaceMode: "singleton",
  };
  const accessToken = () =>
    window.sessionStorage.getItem("unilab.access_token");
  return {
    config,
    core: createBackendCore({
      baseUrl,
      timeoutMs: 12_000,
      getAccessToken: accessToken,
    }),
    services: createServices({
      backend: config,
      getAccessToken: accessToken,
    }),
  };
}
