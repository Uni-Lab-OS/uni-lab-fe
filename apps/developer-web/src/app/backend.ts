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
  const services = createServices({
    backend: config,
    getAccessToken: accessToken,
  });
  const core = createBackendCore({
    baseUrl,
    timeoutMs: 12_000,
    getAccessToken: accessToken,
  }, {
    runtimeEvents: {
      subscribe(listener, options) {
        const subscription = services.workflow.subscribeWorkflowRuntime((event) => {
          if (event.event !== "workflow.runtime.changed" && event.event !== "device_action_task.changed") return;
          listener({
            id: event.id,
            event: event.event,
            workflowTaskUuid: event.event === "workflow.runtime.changed"
              ? event.data.workflow_task_uuid
              : event.data.task_uuid,
            raw: event.data,
          });
        }, {
          lastEventId: options?.lastEventId,
          onError: (error) => {
            // 当前 OS 某些 runtime.changed 帧附带 dispatch_gate 等扩展字段。
            // 失效事件仍包含权威 task UUID；兼容性解析告警不应把 Core 会话置为错误，
            // 真正的 SSE 连接错误继续交给 Core Store 展示。
            if (error.message === "Workflow Runtime SSE 返回了无效事件") return;
            options?.onError?.(error);
          },
        });
        return { dispose: subscription.dispose };
      },
    },
  });
  return {
    config,
    core,
    services,
  };
}
