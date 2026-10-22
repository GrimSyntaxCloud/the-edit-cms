const serverless = require("serverless-http");
const { connect } = require("../lib/repository");
const { createApp } = require("../app");
let pending;
function responseCookies(headers) {
  const cookies = [];
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() !== "set-cookie") continue;
    const parts = headers[key].split(";").map((part) => part.trim());
    const pair = parts.shift();
    const at = pair.indexOf("=");
    const cookie = { name: pair.slice(0, at), value: pair.slice(at + 1) };
    for (const part of parts) {
      const separator = part.indexOf("=");
      const name = (
        separator < 0 ? part : part.slice(0, separator)
      ).toLowerCase();
      const value = separator < 0 ? "" : part.slice(separator + 1);
      if (name === "path") cookie.path = value;
      else if (name === "expires") cookie.expires = new Date(value);
      else if (name === "max-age") cookie.maxAge = Number(value);
      else if (name === "httponly") cookie.httpOnly = true;
      else if (name === "secure") cookie.secure = true;
      else if (name === "samesite") cookie.sameSite = value;
    }
    cookies.push(cookie);
    delete headers[key];
  }
  return cookies;
}
function createHandler(app) {
  const wrapped = serverless(app, {
    provider: "azure",
    binary: ["image/*"],
    request: (req) => {
      delete req.ip;
      req.socket.remoteAddress = "127.0.0.1";
    },
  });
  return async (request) => {
    if (process.env.DEMO_MAINTENANCE === "true")
      return {
        status: 503,
        headers: { "Retry-After": "120", "Cache-Control": "no-store" },
        body: "The demo is briefly unavailable for maintenance.",
      };
    try {
      // Keep multipart bytes intact. Text decoding corrupts uploaded images.
      const rawBody = Buffer.from(await request.arrayBuffer());
      if (rawBody.length > 2300000)
        return { status: 413, body: "Form too large." };
      const url = new URL(request.url);
      const path =
        request.params.path === "home" ? "" : request.params.path || "";
      // Never let the provider log cookies, forms, or private editorial content.
      const result = await wrapped(
        { log: () => {} },
        {
          method: request.method,
          url: "/" + path,
          query: Object.fromEntries(url.searchParams),
          headers: Object.fromEntries(request.headers),
          rawBody,
        },
      );
      return {
        status: result.status,
        cookies: responseCookies(result.headers),
        headers: result.headers,
        body: result.isBase64Encoded
          ? Buffer.from(result.body, "base64")
          : result.body,
      };
    } catch {
      return {
        status: 503,
        headers: { "Cache-Control": "no-store" },
        body: "The demo is temporarily unavailable. Please try again.",
      };
    }
  };
}
async function site(request) {
  try {
    if (!pending)
      pending = connect()
        .then(({ repository }) =>
          createHandler(
            createApp({
              repository,
              secret: process.env.SESSION_SECRET,
              secure: true,
            }),
          ),
        )
        .catch((error) => {
          pending = undefined;
          throw error;
        });
    return await (
      await pending
    )(request);
  } catch {
    return {
      status: 503,
      headers: { "Cache-Control": "no-store" },
      body: "The demo is temporarily unavailable. Please try again.",
    };
  }
}
async function health() {
  if (process.env.DEMO_MAINTENANCE === "true")
    return { status: 503, jsonBody: { status: "maintenance" } };
  try {
    const { repository } = await connect();
    await repository.health();
    return { jsonBody: { status: "ok", database: "connected" } };
  } catch {
    return { status: 503, jsonBody: { status: "unavailable" } };
  }
}
module.exports = { createHandler, site, health };
