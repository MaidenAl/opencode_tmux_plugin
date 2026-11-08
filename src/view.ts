import { paneStatus, type SessionSource, type Status } from "./status.ts";

export interface StatusView {
  data: { session: SessionSource & { root(id: string): string } };
  ui: {
    tabs: {
      enabled(): boolean;
      list(): readonly { sessionID: string; busy: boolean; attention: boolean }[];
    };
    router: { current(): { type: string; sessionID?: string } };
  };
}

export function openRoots(context: StatusView): string[] {
  const roots = new Set(context.ui.tabs.enabled()
    ? context.ui.tabs.list().map((tab) => tab.sessionID) : []);
  const route = context.ui.router.current();
  if (route.type === "session" && route.sessionID) {
    roots.add(context.data.session.root(route.sessionID));
  }
  return [...roots];
}

export function viewStatus(context: StatusView): Status {
  const status = paneStatus(openRoots(context), context.data.session);
  const tabs = context.ui.tabs.enabled() ? context.ui.tabs.list() : [];
  if (status === "attention" || tabs.some((tab) => tab.attention)) return "attention";
  if (status === "working" || tabs.some((tab) => tab.busy)) return "working";
  return status;
}
