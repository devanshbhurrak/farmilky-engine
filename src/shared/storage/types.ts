export interface StoredObject {
  body: ArrayBuffer;
  contentType: string;
}

export interface StorageAdapter {
  put(key: string, body: ArrayBuffer | Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<StoredObject>;
  delete(key: string): Promise<void>;
}

let adapter: StorageAdapter | undefined;

export function configureStorage(next: StorageAdapter): void {
  adapter = next;
}

export function getStorage(): StorageAdapter {
  if (!adapter) throw new Error('Storage adapter has not been configured');
  return adapter;
}

export function hasStorage(): boolean {
  return adapter !== undefined;
}
