import { RequestHandlerParams } from "./utils";

export async function handleRequestLock({ path }: RequestHandlerParams) {
  const token = `opaquelocktoken:${crypto.randomUUID()}`;
  const body = `<?xml version="1.0" encoding="utf-8" ?>
<D:prop xmlns:D="DAV:">
  <D:lockdiscovery>
    <D:activelock>
      <D:locktype><D:write /></D:locktype>
      <D:lockscope><D:exclusive /></D:lockscope>
      <D:depth>infinity</D:depth>
      <D:timeout>Second-604800</D:timeout>
      <D:locktoken><D:href>${token}</D:href></D:locktoken>
      <D:lockroot><D:href>/webdav/${encodeURI(path)}</D:href></D:lockroot>
    </D:activelock>
  </D:lockdiscovery>
</D:prop>`;

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Lock-Token": `<${token}>`,
    },
  });
}

export async function handleRequestUnlock() {
  return new Response(null, { status: 204 });
}
