import { existsSync, readFileSync } from "node:fs";
import { expect, request, type APIRequestContext } from "@playwright/test";
import { parse } from "dotenv";
import jsQR from "jsqr";
import { PNG } from "pngjs";

/**
 * Accounts the flow uses: the seeded admin and a seeded faculty member
 * (`npm run db:seed`) as the resource's owner. Environment variables win;
 * otherwise the seed's own values are read from server/.env (parsed, never
 * loaded into process.env). The student is registered fresh on every run.
 */
export function accounts() {
  const file = new URL("../../server/.env", import.meta.url);
  const env = { ...(existsSync(file) ? parse(readFileSync(file)) : {}), ...process.env };
  const need = (key: string, fallbackKey: string): string => {
    const value = env[key] ?? env[fallbackKey];
    if (!value) throw new Error(`Set ${key} (or ${fallbackKey} in server/.env) for the e2e run`);
    return value;
  };
  return {
    admin: { email: need("E2E_ADMIN_EMAIL", "SEED_ADMIN_EMAIL"), password: need("E2E_ADMIN_PASSWORD", "SEED_ADMIN_PASSWORD") },
    owner: { email: env.E2E_OWNER_EMAIL ?? "anita.rao@college.edu", password: need("E2E_USER_PASSWORD", "SEED_USER_PASSWORD") },
  };
}

interface Envelope<T> {
  data?: T;
  error?: { code: string; message: string };
}

/** A signed-in API client for one user, talking to the same origin the browser uses. */
export class Api {
  private constructor(
    private readonly ctx: APIRequestContext,
    private readonly token: string,
    readonly user: { id: string; departmentId: string },
  ) {}

  /** Registers a new account (every signup starts as a student) and signs it in. */
  static async register(
    baseURL: string,
    who: { email: string; password: string; fullName: string; departmentId: string },
  ): Promise<Api> {
    const ctx = await request.newContext({ baseURL });
    const res = await ctx.post("/api/auth/register", { data: who });
    expect(res.status(), `register ${who.email}`).toBe(201);
    await ctx.dispose();
    return Api.signIn(baseURL, { email: who.email, password: who.password });
  }

  static async signIn(baseURL: string, who: { email: string; password: string }): Promise<Api> {
    const ctx = await request.newContext({ baseURL });
    const login = await ctx.post("/api/auth/login", { data: who });
    expect(login.status(), `login ${who.email}`).toBe(200);
    const token = ((await login.json()) as Envelope<{ accessToken: string }>).data?.accessToken ?? "";
    const me = await ctx.get("/api/auth/me", { headers: { Authorization: `Bearer ${token}` } });
    const user = ((await me.json()) as Envelope<{ id: string; departmentId: string }>).data;
    if (!user) throw new Error(`no /me for ${who.email}`);
    return new Api(ctx, token, user);
  }

  async call<T>(method: "GET" | "POST" | "PATCH", path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; data: T }> {
    const res = await this.ctx.fetch(path, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, ...headers },
      ...(body === undefined ? {} : { data: body }),
    });
    const json = (await res.json()) as Envelope<T>;
    if (!res.ok()) throw new Error(`${method} ${path} -> ${res.status()} ${JSON.stringify(json.error)}`);
    return { status: res.status(), data: json.data as T };
  }

  /** The resource's printed QR code, decoded to the path it opens (/checkin?r=&sig=). */
  async checkinPath(resourceId: string): Promise<string> {
    const res = await this.ctx.get(`/api/resources/${resourceId}/qr`, { headers: { Authorization: `Bearer ${this.token}` } });
    expect(res.status()).toBe(200);
    const png = PNG.sync.read(await res.body());
    const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
    if (!decoded) throw new Error("QR code did not decode");
    const url = new URL(decoded.data);
    return `${url.pathname}${url.search}`;
  }

  dispose(): Promise<void> {
    return this.ctx.dispose();
  }
}
