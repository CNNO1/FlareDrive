type Env = {
  BUCKET: R2Bucket;
  WEBDAV_USERNAME: string;
  WEBDAV_PASSWORD: string;
};

const PART_SIZE = 10 * 1024 * 1024;
const MAX_WEBUI_BYTES = 250 * 1024 * 1024;
const DIRECTORY_TYPE = "application/x-directory";

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), { ...init, headers });
}

function assertAuth(request: Request, env: Env) {
  if (!env.WEBDAV_USERNAME || !env.WEBDAV_PASSWORD) {
    throw new HttpError(403, "Authentication is not configured");
  }
  const expected = `Basic ${btoa(`${env.WEBDAV_USERNAME}:${env.WEBDAV_PASSWORD}`)}`;
  if (request.headers.get("Authorization") !== expected) {
    throw new HttpError(401, "Unauthorized");
  }
}

function routePath(context: EventContext<Env, string, unknown>) {
  const raw = (context.params as { path?: string[] | string }).path;
  return Array.isArray(raw) ? raw.join("/") : raw ?? "";
}

function cleanKey(input: string | null | undefined, options?: { folder?: boolean }) {
  let key = (input ?? "").replace(/\\/g, "/").replace(/^\/+/, "");
  const parts = key.split("/").filter((part) => part && part !== ".");
  if (parts.includes("..")) throw new HttpError(400, "Invalid path");
  key = parts.join("/");
  if (options?.folder && key && !key.endsWith("/")) key += "/";
  return key;
}

function requireKey(input: string | null | undefined, options?: { folder?: boolean }) {
  const key = cleanKey(input, options);
  if (!key) throw new HttpError(400, "Missing path");
  return key;
}

function metadataFromHeaders(headers: Headers): R2HTTPMetadata {
  const metadata: R2HTTPMetadata = {};
  const contentType = headers.get("content-type");
  const contentDisposition = headers.get("content-disposition");
  const contentLanguage = headers.get("content-language");
  const cacheControl = headers.get("cache-control");
  if (contentType) metadata.contentType = contentType;
  if (contentDisposition) metadata.contentDisposition = contentDisposition;
  if (contentLanguage) metadata.contentLanguage = contentLanguage;
  if (cacheControl) metadata.cacheControl = cacheControl;
  return metadata;
}

function objectHeaders(object: R2Object) {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Accept-Ranges", "bytes");
  headers.set("Content-Length", object.size.toString());
  headers.set("ETag", object.httpEtag);
  headers.set("Last-Modified", object.uploaded.toUTCString());
  return headers;
}

function fileName(key: string) {
  const normalized = key.replace(/\/$/, "");
  return normalized.split("/").pop() || normalized;
}

async function* listAll(bucket: R2Bucket, prefix = "") {
  let cursor: string | undefined;
  do {
    const page = await bucket.list({
      prefix,
      cursor,
      include: ["httpMetadata", "customMetadata"] as any,
    });
    for (const object of page.objects) yield object;
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

async function deletePrefix(bucket: R2Bucket, prefix: string) {
  const keys: string[] = [];
  for await (const object of listAll(bucket, prefix)) {
    keys.push(object.key);
    if (keys.length >= 1000) {
      await bucket.delete(keys.splice(0, keys.length));
    }
  }
  if (keys.length) await bucket.delete(keys);
}

async function listObjects(bucket: R2Bucket, rawPrefix: string) {
  const prefix = cleanKey(rawPrefix, { folder: Boolean(rawPrefix) });
  const folders = new Map<string, any>();
  const files: any[] = [];
  let cursor: string | undefined;

  do {
    const page: any = await bucket.list({
      prefix,
      delimiter: "/",
      cursor,
      include: ["httpMetadata", "customMetadata"] as any,
    });

    for (const childPrefix of page.delimitedPrefixes ?? []) {
      folders.set(childPrefix, {
        key: childPrefix,
        name: fileName(childPrefix),
        type: "folder",
        size: 0,
        updated: null,
        contentType: DIRECTORY_TYPE,
      });
    }

    for (const object of page.objects as R2Object[]) {
      if (object.key === prefix) continue;
      if (object.key.endsWith("/") || object.httpMetadata?.contentType === DIRECTORY_TYPE) {
        folders.set(object.key.endsWith("/") ? object.key : `${object.key}/`, {
          key: object.key.endsWith("/") ? object.key : `${object.key}/`,
          name: fileName(object.key),
          type: "folder",
          size: 0,
          updated: object.uploaded.toISOString(),
          contentType: DIRECTORY_TYPE,
        });
        continue;
      }
      files.push({
        key: object.key,
        name: fileName(object.key),
        type: "file",
        size: object.size,
        updated: object.uploaded.toISOString(),
        contentType: object.httpMetadata?.contentType || "application/octet-stream",
      });
    }

    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  const items = [...folders.values(), ...files].sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name, "zh-Hans-CN", { numeric: true });
  });

  return json({ prefix, items, limits: { maxUploadBytes: MAX_WEBUI_BYTES, partSize: PART_SIZE } });
}

async function usage(bucket: R2Bucket) {
  let size = 0;
  let count = 0;
  let folders = 0;
  for await (const object of listAll(bucket)) {
    if (object.key.endsWith("/") || object.httpMetadata?.contentType === DIRECTORY_TYPE) {
      folders += 1;
      continue;
    }
    count += 1;
    size += object.size;
  }
  return json({ size, count, folders, recommendedLimitBytes: 3 * 1024 * 1024 * 1024 });
}

async function download(bucket: R2Bucket, request: Request) {
  const key = requireKey(new URL(request.url).searchParams.get("key"));
  const object = await bucket.get(key, { range: request.headers });
  if (!object || !("body" in object)) throw new HttpError(404, "Not found");
  const headers = objectHeaders(object);
  headers.set("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(fileName(key))}`);
  return new Response(object.body, { headers });
}

async function createFolder(bucket: R2Bucket, request: Request) {
  const body = await request.json<{ key?: string }>();
  const key = requireKey(body.key, { folder: true });
  await bucket.put(key, "", { httpMetadata: { contentType: DIRECTORY_TYPE } });
  return json({ ok: true, key }, { status: 201 });
}

async function createMultipart(bucket: R2Bucket, request: Request) {
  const body = await request.json<{ key?: string; size?: number; contentType?: string }>();
  const key = requireKey(body.key);
  const size = Number(body.size ?? 0);
  if (!Number.isFinite(size) || size < 0) throw new HttpError(400, "Invalid file size");
  if (size > MAX_WEBUI_BYTES) {
    return json(
      { error: "WebUI upload limit is 250MiB", maxUploadBytes: MAX_WEBUI_BYTES },
      { status: 413 }
    );
  }
  const contentType = body.contentType || "application/octet-stream";

  if (size === 0) {
    await bucket.put(key, "", { httpMetadata: { contentType } });
    return json({ key, empty: true, partSize: PART_SIZE }, { status: 201 });
  }

  const upload = await bucket.createMultipartUpload(key, {
    httpMetadata: { contentType },
    customMetadata: { size: String(size) },
  });
  return json({ key, uploadId: upload.uploadId, partSize: PART_SIZE, maxUploadBytes: MAX_WEBUI_BYTES });
}

async function uploadPart(bucket: R2Bucket, request: Request) {
  const url = new URL(request.url);
  const key = requireKey(url.searchParams.get("key"));
  const uploadId = url.searchParams.get("uploadId");
  const partNumber = Number(url.searchParams.get("partNumber"));
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (!uploadId || !Number.isInteger(partNumber) || partNumber < 1) {
    throw new HttpError(400, "Invalid multipart parameters");
  }
  if (!request.body) throw new HttpError(400, "Missing request body");
  if (contentLength > PART_SIZE + 1024 * 1024) throw new HttpError(413, "Part is too large");
  const upload = bucket.resumeMultipartUpload(key, uploadId);
  const part = await upload.uploadPart(partNumber, request.body);
  return json({ partNumber, etag: part.etag });
}

function normalizeUploadedParts(parts: unknown) {
  if (!Array.isArray(parts) || !parts.length) {
    throw new HttpError(400, "Missing uploaded parts");
  }
  const seen = new Set<number>();
  return parts
    .map((part) => {
      if (!part || typeof part !== "object") {
        throw new HttpError(400, "Invalid uploaded part");
      }
      const candidate = part as Partial<R2UploadedPart>;
      if (!Number.isInteger(candidate.partNumber) || candidate.partNumber! < 1 || !candidate.etag) {
        throw new HttpError(400, "Invalid uploaded part");
      }
      if (seen.has(candidate.partNumber)) {
        throw new HttpError(400, "Duplicate uploaded part");
      }
      seen.add(candidate.partNumber);
      return { partNumber: candidate.partNumber, etag: candidate.etag };
    })
    .sort((a, b) => a.partNumber - b.partNumber);
}

async function completeMultipart(bucket: R2Bucket, request: Request) {
  const body = await request.json<{ key?: string; uploadId?: string; parts?: unknown }>();
  const key = requireKey(body.key);
  if (!body.uploadId) {
    throw new HttpError(400, "Invalid complete request");
  }
  const parts = normalizeUploadedParts(body.parts);
  const upload = bucket.resumeMultipartUpload(key, body.uploadId);
  let object: R2Object;
  try {
    object = await upload.complete(parts);
  } catch {
    throw new HttpError(409, "Multipart upload could not be completed. Retry the upload.");
  }
  return json({ key, size: object.size, etag: object.httpEtag });
}

async function abortMultipart(bucket: R2Bucket, request: Request) {
  const body = await request.json<{ key?: string; uploadId?: string }>();
  const key = requireKey(body.key);
  if (!body.uploadId) throw new HttpError(400, "Missing uploadId");
  await bucket.resumeMultipartUpload(key, body.uploadId).abort();
  return json({ ok: true });
}

async function deleteObject(bucket: R2Bucket, request: Request) {
  const key = requireKey(new URL(request.url).searchParams.get("key"));
  if (key.endsWith("/")) {
    await deletePrefix(bucket, key);
  } else {
    await bucket.delete(key);
  }
  return json({ ok: true });
}

async function copyObject(bucket: R2Bucket, from: string, to: string) {
  const source = await bucket.get(from);
  if (!source || !("body" in source)) return;
  await bucket.put(to, source.body, {
    httpMetadata: source.httpMetadata,
    customMetadata: source.customMetadata,
  });
}

async function renameObject(bucket: R2Bucket, request: Request) {
  const body = await request.json<{ from?: string; to?: string }>();
  const from = requireKey(body.from, { folder: body.from?.endsWith("/") });
  const to = requireKey(body.to, { folder: body.from?.endsWith("/") });
  if (from === to) return json({ ok: true });

  if (from.endsWith("/")) {
    await bucket.put(to, "", { httpMetadata: { contentType: DIRECTORY_TYPE } });
    for await (const object of listAll(bucket, from)) {
      const target = `${to}${object.key.slice(from.length)}`;
      await copyObject(bucket, object.key, target);
    }
    await deletePrefix(bucket, from);
  } else {
    await copyObject(bucket, from, to);
    await bucket.delete(from);
  }
  return json({ ok: true });
}

export const onRequest: PagesFunction<Env> = async (context) => {
  try {
    assertAuth(context.request, context.env);
    const action = routePath(context);
    const method = context.request.method;
    const bucket = context.env.BUCKET;

    if (!bucket) throw new HttpError(500, "R2 bucket binding is missing");
    if (method === "GET" && action === "list") {
      return listObjects(bucket, new URL(context.request.url).searchParams.get("prefix") ?? "");
    }
    if (method === "GET" && action === "usage") return usage(bucket);
    if (method === "GET" && action === "file") return download(bucket, context.request);
    if (method === "POST" && action === "folder") return createFolder(bucket, context.request);
    if (method === "POST" && action === "multipart/create") return createMultipart(bucket, context.request);
    if (method === "PUT" && action === "multipart/part") return uploadPart(bucket, context.request);
    if (method === "POST" && action === "multipart/complete") return completeMultipart(bucket, context.request);
    if (method === "POST" && action === "multipart/abort") return abortMultipart(bucket, context.request);
    if (method === "DELETE" && action === "object") return deleteObject(bucket, context.request);
    if (method === "POST" && action === "rename") return renameObject(bucket, context.request);

    throw new HttpError(404, "Not found");
  } catch (error) {
    if (error instanceof HttpError) {
      const headers: HeadersInit = error.status === 401 ? { "WWW-Authenticate": 'Basic realm="FlareDrive Light"' } : {};
      return json({ error: error.message }, { status: error.status, headers });
    }
    return json({ error: error instanceof Error ? error.message : "Internal error" }, { status: 500 });
  }
};
