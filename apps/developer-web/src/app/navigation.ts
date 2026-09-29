import { useSyncExternalStore } from "react";
import type { StudioRoute } from "../components/AppShell";

export function routeFromPath(pathname: string): StudioRoute {
  const segment = pathname.split("/").filter(Boolean)[0];
  return segment === "devices" ||
    segment === "reagents" ||
    segment === "materials" ||
    segment === "workflows" ||
    segment === "tasks"
    ? segment
    : "overview";
}

export function navigateTo(route: StudioRoute, search = ""): void {
  const path = route === "overview" ? "/" : `/${route}`;
  window.history.pushState({}, "", `${path}${search}`);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function useStudioRoute(): StudioRoute {
  return useSyncExternalStore(
    (onStoreChange) => {
      window.addEventListener("popstate", onStoreChange);
      return () => window.removeEventListener("popstate", onStoreChange);
    },
    () => routeFromPath(window.location.pathname),
    () => "overview",
  );
}
