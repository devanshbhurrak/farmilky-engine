type SSEStream = { send: (event: string, data: unknown) => void };
type RemoteBroadcaster = (key: string, event: { type: string; [k: string]: unknown }) => void;

const connections = new Map<string, Set<SSEStream>>();
let remoteBroadcaster: RemoteBroadcaster | undefined;

/**
 * In Workers an SSE connection lives inside one isolate. Broadcasts from other
 * isolates are forwarded to the SseHub Durable Object through this hook.
 */
export function configureRemoteBroadcast(fn: RemoteBroadcaster | undefined): void {
  remoteBroadcaster = fn;
}

export function subscribe(key: string, stream: SSEStream): void {
  let set = connections.get(key);
  if (!set) {
    set = new Set();
    connections.set(key, set);
  }
  set.add(stream);
}

export function unsubscribe(key: string, stream: SSEStream): void {
  const set = connections.get(key);
  if (!set) return;
  set.delete(stream);
  if (set.size === 0) connections.delete(key);
}

export function broadcast(key: string, event: { type: string; [k: string]: unknown }): void {
  if (remoteBroadcaster) {
    try {
      remoteBroadcaster(key, event);
    } catch {
      // Fall through to local delivery; remote hub is best-effort.
    }
  }
  connections.get(key)?.forEach((s) => {
    try {
      s.send(event.type, JSON.stringify(event));
    } catch {
      // Ignore broken streams; cleanup happens on abort
    }
  });
}

export function connectionCount(key: string): number {
  return connections.get(key)?.size ?? 0;
}

export const sseManager = { subscribe, unsubscribe, broadcast, connectionCount };
