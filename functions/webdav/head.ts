import { notFound } from "./utils";
import { RequestHandlerParams } from "./utils";
import { getObjectHeaders } from "./utils";

export async function handleRequestHead({
  bucket,
  path,
}: RequestHandlerParams) {
  const obj = await bucket.head(path);
  if (obj === null) return notFound();

  return new Response(null, { headers: getObjectHeaders(obj) });
}
