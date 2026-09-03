import { withHarbinger } from "@harbinger/cloudflare";

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);

    if (url.pathname === "/.well-known/harbinger") {
      return Response.json(env.HARBINGER_INDEX, {
        headers: { "content-type": "application/vnd.x403.harbinger+json" },
      });
    }

    if (url.pathname === "/v1/stream") {
      return withHarbinger(req, {
        price: env.PING_PRICE ?? "0.002",
        asset: "USDC",
        network: "base",
        resource: "harbinger.notify",
      }, () => streamWatches(req, env, ctx));
    }

    return new Response("harbinger edge", { status: 200 });
  }
};
