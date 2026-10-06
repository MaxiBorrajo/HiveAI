import { join } from "node:path";
import { chmod, mkdir, rename } from "node:fs/promises";

const MASTER_KEY_FILE = ".master.key";
const SECRETS_FILE = "secrets.enc";
const FORMAT_VERSION = 1;

interface EncryptedPayload {
  v: number;
  iv: string;
  data: string;
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const bin = atob(value);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export class SecretStore {
  private key: CryptoKey | undefined;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly dir: string) {}

  private get masterKeyPath() {
    return join(this.dir, MASTER_KEY_FILE);
  }

  private get secretsPath() {
    return join(this.dir, SECRETS_FILE);
  }

  private async loadKey(): Promise<CryptoKey> {
    if (this.key) return this.key;

    let raw: Uint8Array<ArrayBuffer>;
    try {
      raw = fromBase64((await Deno.readTextFile(this.masterKeyPath)).trim());
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
      await mkdir(this.dir, { recursive: true });
      raw = crypto.getRandomValues(new Uint8Array(32));
      await Deno.writeTextFile(this.masterKeyPath, toBase64(raw), {
        mode: 0o600,
        createNew: true,
      });
      await chmod(this.masterKeyPath, 0o600).catch(() => {});
    }

    this.key = await crypto.subtle.importKey(
      "raw",
      raw,
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"],
    );
    return this.key;
  }

  private async readAll(): Promise<Record<string, string>> {
    let text: string;
    try {
      text = await Deno.readTextFile(this.secretsPath);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return {};
      throw error;
    }

    const payload = JSON.parse(text) as EncryptedPayload;
    const key = await this.loadKey();
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(payload.iv) },
      key,
      fromBase64(payload.data),
    );
    return JSON.parse(new TextDecoder().decode(plain));
  }

  private async writeAll(secrets: Record<string, string>): Promise<void> {
    const key = await this.loadKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(JSON.stringify(secrets)),
    );
    const payload: EncryptedPayload = {
      v: FORMAT_VERSION,
      iv: toBase64(iv),
      data: toBase64(new Uint8Array(cipher)),
    };

    await mkdir(this.dir, { recursive: true });
    const tmp = `${this.secretsPath}.tmp`;
    await Deno.writeTextFile(tmp, JSON.stringify(payload), { mode: 0o600 });
    await rename(tmp, this.secretsPath);
  }

  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => {});
    return run;
  }

  put(id: string, value: string): Promise<void> {
    return this.serialize(async () => {
      const all = await this.readAll();
      all[id] = value;
      await this.writeAll(all);
    });
  }

  get(id: string): Promise<string | undefined> {
    return this.serialize(async () => (await this.readAll())[id]);
  }

  delete(id: string): Promise<void> {
    return this.serialize(async () => {
      const all = await this.readAll();
      if (!(id in all)) return;
      delete all[id];
      await this.writeAll(all);
    });
  }
}
