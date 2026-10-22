const test = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");
const { createHandler } = require("../azure/handler");
const { createApp } = require("../app");
const { MemoryRepository } = require("../lib/repository");
const secret = "adapter-test-secret-at-least-32-characters-long";
function incoming(path = "home", query = "", options = {}) {
  const request = new Request(
    "https://demo.test/api/site/" + path + query,
    options,
  );
  request.params = { path };
  return request;
}
function jarFrom(response, jar = {}) {
  for (const c of response.cookies || []) jar[c.name] = c.value;
  const headers = response.headers;
  const values = headers["set-cookie"] || headers["Set-Cookie"] || [];
  for (const value of Array.isArray(values) ? values : [values]) {
    const pair = value.split(";")[0];
    const at = pair.indexOf("=");
    jar[pair.slice(0, at)] = pair.slice(at + 1);
  }
  return jar;
}
const cookie = (jar) =>
  Object.entries(jar)
    .map(([key, value]) => key + "=" + value)
    .join("; ");
test("Azure adapter preserves cookies, query routing, binary multipart images and binary responses", async () => {
  const repo = new MemoryRepository();
  const handler = createHandler(
    createApp({ repository: repo, secret, secure: true, limits: true }),
  );
  const initial = await handler(incoming("home", "?page=start"));
  assert.equal(initial.status, 200);
  const csrf = String(initial.body).match(/name="csrf" value="([^"]+)"/)[1];
  const jar = jarFrom(initial);
  let response = await handler(
    incoming("home", "", {
      method: "POST",
      headers: {
        cookie: cookie(jar),
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        action: "start",
        csrf,
        name: "azure-editor",
        password: "fictional-password-123",
      }).toString(),
    }),
  );
  assert.equal(response.status, 303, String(response.body));
  jarFrom(response, jar);
  assert.ok(jar.edit_auth);
  const form = new FormData();
  for (const [key, value] of Object.entries({
    action: "article",
    csrf,
    title: "Binary image",
    content: "Preserved bytes",
    author: "Demo",
    date: "2026-10-21",
  }))
    form.set(key, value);
  const bytes = await sharp({
    create: { width: 16, height: 16, channels: 3, background: "#c22" },
  })
    .png()
    .toBuffer();
  form.set("image", new Blob([bytes], { type: "image/png" }), "image.png");
  response = await handler(
    incoming("home", "", {
      method: "POST",
      headers: { cookie: cookie(jar) },
      body: form,
    }),
  );
  assert.equal(response.status, 303, String(response.body));
  response = await handler(
    incoming("api.php", "?type=articles", { headers: { cookie: cookie(jar) } }),
  );
  assert.equal(response.status, 200);
  const story = JSON.parse(response.body).find(
    (a) => a.title === "Binary image",
  );
  assert.ok(story.image);
  response = await handler(
    incoming("image.php", "?id=" + story.image, {
      headers: { cookie: cookie(jar) },
    }),
  );
  assert.equal(response.status, 200);
  assert.ok(Buffer.isBuffer(response.body));
  assert.equal((await sharp(response.body).metadata()).format, "jpeg");
});
