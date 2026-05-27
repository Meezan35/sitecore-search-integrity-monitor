import { mkdirSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";

import type { PushCachePayload } from "../connectors/push.connector";

interface PushBody {
  secret?: string;
  urls?: string[];
  source?: string;
  timestamp?: string;
}

const MAX_BODY_BYTES = 50 * 1024 * 1024;

function jsonResponse(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) });
  res.end(payload);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", reject);
  });
}

export function startPushReceiver(port: number, apiSecret: string): Server {
  const server = createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/api/push") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
      return;
    }

    let raw: string;
    try {
      raw = await readBody(req);
    } catch {
      jsonResponse(res, 400, { error: "Could not read request body" });
      return;
    }

    let body: PushBody;
    try {
      body = JSON.parse(raw) as PushBody;
    } catch {
      jsonResponse(res, 400, { error: "Invalid JSON" });
      return;
    }

    if (body.secret !== apiSecret) {
      jsonResponse(res, 401, { error: "Unauthorized" });
      return;
    }

    if (
      !Array.isArray(body.urls) ||
      typeof body.source !== "string" ||
      body.source.trim().length === 0 ||
      typeof body.timestamp !== "string" ||
      body.timestamp.trim().length === 0
    ) {
      jsonResponse(res, 400, { error: "Missing or invalid fields: urls, source, timestamp" });
      return;
    }

    const payload: PushCachePayload = {
      source: body.source.trim(),
      timestamp: body.timestamp.trim(),
      urls: body.urls.filter((u) => typeof u === "string" && u.trim().length > 0),
    };

    const cacheDir = join(process.cwd(), "push-cache");
    mkdirSync(cacheDir, { recursive: true });
    const filePath = join(cacheDir, `${payload.source}.json`);
    writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");

    jsonResponse(res, 200, { ok: true, written: filePath, count: payload.urls.length });
  });

  server.listen(port, () => {
    console.log(`Push receiver listening on port ${port}`);
  });

  return server;
}

if (require.main === module) {
  const secret = process.env.PUSH_API_SECRET;
  if (secret == null || secret.length === 0) {
    console.error("PUSH_API_SECRET environment variable is required.");
    process.exit(1);
  }

  const port = Number(process.env.PORT) || 3001;
  startPushReceiver(port, secret);
}
