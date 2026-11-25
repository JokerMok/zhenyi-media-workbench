export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const origin = () => process.env.ZHENYI_WORKBENCH_ORIGIN;

export async function GET(request: Request) {
  const endpoint = origin();
  if (!endpoint) return Response.json({ error: "作品台联动未启动。" }, { status: 503 });
  const ticket = new URL(request.url).searchParams.get("ticket") ?? "";
  const response = await fetch(endpoint + "/api/delivery/wechat/bridge?ticket=" + encodeURIComponent(ticket), { cache: "no-store" });
  return new Response(response.body, { status: response.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const endpoint = origin();
  if (!endpoint) return Response.json({ error: "作品台联动未启动。" }, { status: 503 });
  if (request.headers.get("origin") !== process.env.ZHENYI_FORMATTER_ORIGIN ||
      !request.headers.get("content-type")?.startsWith("application/json")) {
    return Response.json({ error: "请在排版页保存。" }, { status: 403 });
  }
  const response = await fetch(endpoint + "/api/delivery/wechat/bridge", {
    method: "POST",
    headers: { origin: endpoint, "content-type": "application/json" },
    body: request.body,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  return new Response(response.body, { status: response.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
