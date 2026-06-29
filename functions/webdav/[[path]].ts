type Env = {
  BUCKET: R2Bucket;
  WEBDAV_USERNAME: string;
  WEBDAV_PASSWORD: string;
};

const DIRECTORY_TYPE = "application/x-directory";
const MAX_WEBDAV_PUT_BYTES = 95 * 1024 * 1024;

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function assertAuth(request: Request, env: Env) {
  const expected = `Basic ${btoa(`${env.WEBDAV_USERNAME}:${env.WEBDAV_PASSWORD}`)}`;
  if (!env.WEBDAV_USERNAME || !env.WEBDAV_PASSWORD) {
    throw new HttpError(403, "WebDAV is not configured");
  }
  if (request.headers.get("Authorization") !== expected) {
    throw new HttpError(401, "Unauthorized");
  }
}

function rawPath(context: EventContext<Env, string, unknown>) {
  const raw = (context.params as { path?: string[] | string }).path;
  const joined = Array.isArray(raw) ? raw.join("/") : raw ?? "";
  return decodeURIComponent(joined).replace(/^\/+/, "");
}

function cleanKey(input: string, options?: { folder?: boolean }) {
  let key = input.replace(/\\/g, "/").replace(/^\/+/, "");
  const parts = key.split("/").filter((part) => part && part !== ".");
  if (parts.includes("..")) throw new HttpError(400, "Invalid path");
  key = parts.join("/");
  if (options?.folder && key && !key.endsWith("/")) key += "/";
  return key;
}

function escapeXml(value: string | number | null | undefined) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function encodePath(key: string) {
  return key
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function href(key: string, folder = false) {
  const encoded = encodePath(key);
  return `/webdav/${encoded}${folder && encoded && !encoded.endsWith("/") ? "/" : ""}`;
}

function displayName(key: string) {
  const trimmed = key.replace(/\/$/, "");
  return trimmed.split("/").pop() || "FlareDrive";
}

function writeMetadata(headers: Headers): R2HTTPMetadata {
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
    if (keys.length >= 1000) await bucket.delete(keys.splice(0, keys.length));
  }
  if (keys.length) await bucket.delete(keys);
}

function propResponse(item: {
  key: string;
  folder: boolean;
  size: number;
  updated: Date;
  contentType?: string;
  etag?: string;
}) {
  const type = item.folder ? DIRECTORY_TYPE : item.contentType || "application/octet-stream";
  return `
  <D:response>
    <D:href>${escapeXml(href(item.key, item.folder))}</D:href>
    <D:propstat>
      <D:prop>
        <D:displayname>${escapeXml(displayName(item.key))}</D:displayname>
        <D:creationdate>${escapeXml(item.updated.toISOString())}</D:creationdate>
        <D:getlastmodified>${escapeXml(item.updated.toUTCString())}</D:getlastmodified>
        <D:getcontentlength>${item.folder ? 0 : item.size}</D:getcontentlength>
        <D:getcontenttype>${escapeXml(type)}</D:getcontenttype>
        ${item.etag ? `<D:getetag>${escapeXml(item.etag)}</D:getetag>` : ""}
        <D:resourcetype>${item.folder ? "<D:collection/>" : ""}</D:resourcetype>
        <D:supportedlock>
          <D:lockentry><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype></D:lockentry>
        </D:supportedlock>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>`;
}

async function resolveResource(bucket: R2Bucket, key: string) {
  if (!key) return { folder: true, key: "", object: null as R2Object | null };
  const object = await bucket.head(key);
  if (object) {
    const folder = key.endsWith("/") || object.httpMetadata?.contentType === DIRECTORY_TYPE;
    return { folder, key: folder && !key.endsWith("/") ? `${key}/` : key, object };
  }
  const folderKey = key.endsWith("/") ? key : `${key}/`;
  const marker = await bucket.head(folderKey);
  if (marker) return { folder: true, key: folderKey, object: marker };
  const page = await bucket.list({ prefix: folderKey, limit: 1 });
  if (page.objects.length) return { folder: true, key: folderKey, object: null };
  return null;
}

async function handleOptions() {
  return new Response(null, {
    headers: {
      Allow: "OPTIONS, PROPFIND, MKCOL, HEAD, GET, PUT, DELETE, COPY, MOVE, LOCK, UNLOCK",
      DAV: "1, 2",
      "MS-Author-Via": "DAV",
    },
  });
}

async function handlePropfind(bucket: R2Bucket, request: Request, key: string) {
  const resource = await resolveResource(bucket, cleanKey(key));
  if (!resource) throw new HttpError(404, "Not found");
  const depth = request.headers.get("Depth") ?? "infinity";
  const now = new Date();
  const items = [
    propResponse({
      key: resource.key,
      folder: resource.folder,
      size: resource.object?.size ?? 0,
      updated: resource.object?.uploaded ?? now,
      contentType: resource.object?.httpMetadata?.contentType,
      etag: resource.object?.httpEtag,
    }),
  ];

  if (resource.folder && depth !== "0") {
    const prefix = resource.key ? cleanKey(resource.key, { folder: true }) : "";
    const folders = new Set<string>();
    let cursor: string | undefined;
    do {
      const page: any = await bucket.list({
        prefix,
        delimiter: "/",
        cursor,
        include: ["httpMetadata", "customMetadata"] as any,
      });
      for (const childPrefix of page.delimitedPrefixes ?? []) folders.add(childPrefix);
      for (const object of page.objects as R2Object[]) {
        if (object.key === prefix) continue;
        if (object.key.endsWith("/") || object.httpMetadata?.contentType === DIRECTORY_TYPE) {
          folders.add(object.key.endsWith("/") ? object.key : `${object.key}/`);
          continue;
        }
        items.push(
          propResponse({
            key: object.key,
            folder: false,
            size: object.size,
            updated: object.uploaded,
            contentType: object.httpMetadata?.contentType,
            etag: object.httpEtag,
          })
        );
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);

    for (const folder of [...folders].sort()) {
      items.push(propResponse({ key: folder, folder: true, size: 0, updated: now, contentType: DIRECTORY_TYPE }));
    }
  }

  return new Response(`<?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:">${items.join("")}</D:multistatus>`, {
    status: 207,
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
}

async function handleGet(bucket: R2Bucket, request: Request, key: string, head = false) {
  const clean = cleanKey(key);
  const resource = await resolveResource(bucket, clean);
  if (!resource || resource.folder) throw new HttpError(404, "Not found");
  if (head) {
    const object = await bucket.head(clean);
    if (!object) throw new HttpError(404, "Not found");
    return new Response(null, { headers: objectHeaders(object) });
  }
  const object = await bucket.get(clean, { range: request.headers });
  if (!object || !("body" in object)) throw new HttpError(404, "Not found");
  return new Response(object.body, { headers: objectHeaders(object) });
}

async function handlePut(bucket: R2Bucket, request: Request, key: string) {
  const clean = cleanKey(key);
  if (!clean || clean.endsWith("/")) throw new HttpError(405, "Cannot PUT a collection");
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_WEBDAV_PUT_BYTES) {
    throw new HttpError(413, "WebDAV single-request upload limit is 95MiB. Use the WebUI for files up to 250MiB.");
  }
  await bucket.put(clean, request.body ?? "", { httpMetadata: writeMetadata(request.headers) });
  return new Response(null, { status: 201 });
}

async function handleMkcol(bucket: R2Bucket, key: string) {
  const folder = cleanKey(key, { folder: true });
  if (!folder) throw new HttpError(405, "Root already exists");
  const exists = await resolveResource(bucket, folder);
  if (exists) throw new HttpError(405, "Already exists");
  await bucket.put(folder, "", { httpMetadata: { contentType: DIRECTORY_TYPE } });
  return new Response(null, { status: 201 });
}

async function handleDelete(bucket: R2Bucket, key: string) {
  const clean = cleanKey(key);
  if (!clean) throw new HttpError(403, "Refusing to delete root");
  const resource = await resolveResource(bucket, clean);
  if (!resource) throw new HttpError(404, "Not found");
  if (resource.folder) await deletePrefix(bucket, cleanKey(resource.key, { folder: true }));
  else await bucket.delete(clean);
  return new Response(null, { status: 204 });
}

function destinationKey(request: Request) {
  const raw = request.headers.get("Destination");
  if (!raw) throw new HttpError(400, "Missing Destination");
  const url = new URL(raw);
  const prefix = "/webdav/";
  if (!url.pathname.startsWith(prefix)) throw new HttpError(400, "Invalid Destination");
  return cleanKey(decodeURIComponent(url.pathname.slice(prefix.length)));
}

async function copyObject(bucket: R2Bucket, from: string, to: string) {
  const source = await bucket.get(from);
  if (!source || !("body" in source)) return;
  await bucket.put(to, source.body, {
    httpMetadata: source.httpMetadata,
    customMetadata: source.customMetadata,
  });
}

async function handleCopyMove(bucket: R2Bucket, request: Request, key: string, move: boolean) {
  const from = cleanKey(key);
  const to = destinationKey(request);
  const resource = await resolveResource(bucket, from);
  if (!resource) throw new HttpError(404, "Not found");
  if (resource.folder) {
    const fromPrefix = cleanKey(resource.key, { folder: true });
    const toPrefix = cleanKey(to, { folder: true });
    await bucket.put(toPrefix, "", { httpMetadata: { contentType: DIRECTORY_TYPE } });
    for await (const object of listAll(bucket, fromPrefix)) {
      await copyObject(bucket, object.key, `${toPrefix}${object.key.slice(fromPrefix.length)}`);
    }
    if (move) await deletePrefix(bucket, fromPrefix);
  } else {
    await copyObject(bucket, from, to);
    if (move) await bucket.delete(from);
  }
  return new Response(null, { status: 201 });
}

async function handleLock(key: string) {
  const token = `opaquelocktoken:${crypto.randomUUID()}`;
  const body = `<?xml version="1.0" encoding="utf-8"?>
<D:prop xmlns:D="DAV:"><D:lockdiscovery><D:activelock>
<D:locktype><D:write/></D:locktype><D:lockscope><D:exclusive/></D:lockscope>
<D:depth>infinity</D:depth><D:timeout>Second-604800</D:timeout>
<D:locktoken><D:href>${escapeXml(token)}</D:href></D:locktoken>
<D:lockroot><D:href>${escapeXml(href(cleanKey(key)))}</D:href></D:lockroot>
</D:activelock></D:lockdiscovery></D:prop>`;
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "application/xml; charset=utf-8", "Lock-Token": `<${token}>` },
  });
}

export const onRequest: PagesFunction<Env> = async (context) => {
  try {
    if (context.request.method === "OPTIONS") return handleOptions();
    assertAuth(context.request, context.env);
    const bucket = context.env.BUCKET;
    if (!bucket) throw new HttpError(500, "R2 bucket binding is missing");
    const key = rawPath(context);

    switch (context.request.method) {
      case "PROPFIND":
        return handlePropfind(bucket, context.request, key);
      case "GET":
        return handleGet(bucket, context.request, key);
      case "HEAD":
        return handleGet(bucket, context.request, key, true);
      case "PUT":
        return handlePut(bucket, context.request, key);
      case "MKCOL":
        return handleMkcol(bucket, key);
      case "DELETE":
        return handleDelete(bucket, key);
      case "COPY":
        return handleCopyMove(bucket, context.request, key, false);
      case "MOVE":
        return handleCopyMove(bucket, context.request, key, true);
      case "LOCK":
        return handleLock(key);
      case "UNLOCK":
        return new Response(null, { status: 204 });
      default:
        throw new HttpError(405, "Method not allowed");
    }
  } catch (error) {
    if (error instanceof HttpError) {
      const headers: HeadersInit = error.status === 401 ? { "WWW-Authenticate": 'Basic realm="FlareDrive Light"' } : {};
      return new Response(error.message, { status: error.status, headers });
    }
    return new Response(error instanceof Error ? error.message : "Internal error", { status: 500 });
  }
};
