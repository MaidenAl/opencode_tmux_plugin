export type Status = "idle" | "done" | "error" | "working" | "attention";

// This subset is satisfied by context.data.session in OpenCode's TUI API.
export interface SessionSource {
  get(id: string): {
    outcome?: "succeeded" | "failed" | "interrupted";
    time: { busy?: number; idle?: number };
  } | undefined;
  family(id: string): string[];
  status(id: string): "idle" | "running";
  permission: { list(id: string): readonly unknown[] | undefined };
  form: { list(id: string): readonly unknown[] | undefined };
}

export function paneStatus(roots: readonly string[], data: SessionSource): Status {
  let working = false;
  let failed = false;
  let finished = false;

  for (const root of new Set(roots)) {
    const session = data.get(root);
    const family = new Set([root, ...data.family(root)]);
    for (const id of family) {
      if (data.permission.list(id)?.length || data.form.list(id)?.length) {
        return "attention";
      }
      working ||= data.status(id) === "running";
      const member = data.get(id);
      // A new parent execution must not inherit failures from its old children.
      if (id === root || (member?.time.idle ?? 0) >= (session?.time.busy ?? 0)) {
        failed ||= member?.outcome === "failed";
      }
    }
    finished ||= session?.outcome === "succeeded";
  }

  return working ? "working" : failed ? "error" : finished ? "done" : "idle";
}
