export interface RequestHandlerParams {
  bucket: R2Bucket;
  path: string;
  request: Request;
}

export const WEBDAV_ENDPOINT = "/webdav/";

export const ROOT_OBJECT = {
  key: "",
  uploaded: new Date(),
  httpMetadata: {
    contentType: "application/x-directory",
    contentDisposition: undefined,
    contentLanguage: undefined,
  },
  customMetadata: undefined,
  size: 0,
  etag: undefined,
};

export function notFound() {
  return new Response("Not found", { status: 404 });
}

export function getObjectHeaders(obj: R2Object) {
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("Accept-Ranges", "bytes");
  headers.set("Content-Length", obj.size.toString());
  headers.set("ETag", obj.httpEtag);
  headers.set("Last-Modified", obj.uploaded.toUTCString());
  return headers;
}

export function getWriteHttpMetadata(headers: Headers): R2HTTPMetadata {
  const metadata: R2HTTPMetadata = {};
  const contentType = headers.get("content-type");
  const contentDisposition = headers.get("content-disposition");
  const contentLanguage = headers.get("content-language");
  const cacheControl = headers.get("cache-control");
  const cacheExpiry = headers.get("expires");

  if (contentType) metadata.contentType = contentType;
  if (contentDisposition) metadata.contentDisposition = contentDisposition;
  if (contentLanguage) metadata.contentLanguage = contentLanguage;
  if (cacheControl) metadata.cacheControl = cacheControl;
  if (cacheExpiry) metadata.cacheExpiry = new Date(cacheExpiry);

  return metadata;
}

export function parseBucketPath(context: any): [R2Bucket, string] {
  const { request, env, params } = context;
  const url = new URL(request.url);

  const pathSegments = (params.path || []) as String[];
  const path = decodeURIComponent(pathSegments.join("/"));
  const driveid = url.hostname.replace(/\..*/, "");

  return [env[driveid] || env["BUCKET"], path];
}

export async function* listAll(
  bucket: R2Bucket,
  prefix?: string,
  isRecursive: boolean = false
) {
  let cursor: string | undefined = undefined;
  do {
    var r2Objects = await bucket.list({
      prefix: prefix,
      delimiter: isRecursive ? undefined : "/",
      cursor: cursor,
      // @ts-ignore
      include: ["httpMetadata", "customMetadata"],
    });

    for await (const obj of r2Objects.objects)
      if (!obj.key.startsWith("_$flaredrive$/")) yield obj;

    if (r2Objects.truncated) cursor = r2Objects.cursor;
  } while (r2Objects.truncated);
}
