const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const sharp = require("sharp");
const { createApp } = require("../app");
const { MemoryRepository, SLOTS } = require("../lib/repository");
const {
  seeds,
  RETENTION_MS,
  parseCsv,
  csvExport,
  articleData,
} = require("../lib/domain");
const { signer, hash, verifyPassword } = require("../lib/security");
const SECRET = "test-secret-for-isolated-demo-workspaces-48-characters";
function fixture() {
  let time = new Date("2026-10-21T12:00:00Z");
  const repository = new MemoryRepository();
  const app = createApp({
    repository,
    secret: SECRET,
    secure: false,
    now: () => new Date(time),
    limits: false,
  });
  return {
    app,
    repository,
    advance: (ms) => (time = new Date(+time + ms)),
    now: () => time,
  };
}
const csrfOf = (response) => {
  const m = response.text.match(/name="csrf" value="([^"]+)"/);
  assert.ok(m, "CSRF hidden field exists");
  return m[1];
};
async function start(f, name = "editor") {
  const agent = request.agent(f.app);
  const page = await agent.get("/?page=start");
  const csrf = csrfOf(page);
  const response = await agent
    .post("/")
    .type("form")
    .send({ csrf, action: "start", name, password: "fictional-password-123" });
  assert.equal(response.status, 303, response.text);
  return { agent, csrf, response };
}
const story = {
  action: "article",
  title: "A test story",
  content: "Fictional content\nSecond paragraph",
  author: "Demo Writer",
  date: "2026-10-21",
};
test("public seeds and protected workspace/API routes", async () => {
  const f = fixture();
  const page = await request(f.app).get("/");
  assert.equal(page.status, 200);
  assert.match(page.text, /Worth a closer/);
  assert.match(page.text, /Try the editorial desk/);
  assert.equal((await request(f.app).get("/?page=desk")).status, 303);
  assert.equal((await request(f.app).get("/api.php?type=users")).status, 403);
  const api = await request(f.app).get("/api.php?type=articles");
  assert.equal(api.body.length, 3);
  assert.equal((await request(f.app).get("/api.php?type=bad")).status, 400);
  assert.equal((await request(f.app).get("/missing")).status, 404);
});
test("CSRF required, scrypt stored, authentication isolated and logout revokes token", async () => {
  const f = fixture();
  assert.equal(
    (
      await request(f.app).post("/").type("form").send({
        action: "start",
        name: "editor",
        password: "fictional-password-123",
      })
    ).status,
    403,
  );
  const a = await start(f);
  const doc = [...f.repository.docs.values()].find((x) => x.generation);
  assert.match(doc.users[0].passwordHash, /^scrypt\$/);
  assert.ok(
    await verifyPassword("fictional-password-123", doc.users[0].passwordHash),
  );
  assert.equal(doc.sessions.length, 1);
  const auth = a.response.headers["set-cookie"]
    .find((c) => c.startsWith("edit_auth="))
    .split(";")[0];
  const binding = a.response.headers["set-cookie"]
    .find((c) => c.startsWith("edit_workspace="))
    .split(";")[0];
  assert.equal((await a.agent.get("/?page=desk")).status, 200);
  assert.equal(
    (
      await a.agent
        .post("/")
        .type("form")
        .send({ csrf: a.csrf, action: "logout" })
    ).status,
    303,
  );
  assert.equal(
    (await request(f.app).get("/?page=desk").set("Cookie", [auth, binding]))
      .status,
    303,
  );
  const login = await a.agent.get("/?page=login");
  const csrf = csrfOf(login);
  assert.equal(
    (
      await a.agent
        .post("/")
        .type("form")
        .send({ csrf, action: "login", name: "editor", password: "wrong" })
    ).status,
    401,
  );
  assert.equal(
    (
      await a.agent.post("/").type("form").send({
        csrf,
        action: "login",
        name: "editor",
        password: "fictional-password-123",
      })
    ).status,
    303,
  );
});
test("article create/edit/search/sort, text escaping and readonly seeds", async () => {
  const f = fixture();
  const a = await start(f);
  const created = await a.agent
    .post("/")
    .type("form")
    .send({ ...story, csrf: a.csrf, title: "<script>alert(1)</script>" });
  assert.equal(created.status, 303);
  const id = new URL(created.headers.location, "http://local").searchParams.get(
    "id",
  );
  const detail = await a.agent.get(created.headers.location);
  assert.match(detail.text, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(detail.text, /<script>alert/);
  assert.equal(
    (
      await a.agent
        .post("/")
        .type("form")
        .send({ ...story, csrf: a.csrf, id, title: "Updated title" })
    ).status,
    303,
  );
  const searched = await a.agent.get("/?page=desk&search=updated&sort=oldest");
  assert.match(searched.text, /Updated title/);
  assert.doesNotMatch(searched.text, /Small spaces\. Bigger possibilities\./);
  assert.equal(
    (
      await a.agent
        .post("/")
        .type("form")
        .send({ ...story, csrf: a.csrf, id: "seed-1" })
    ).status,
    403,
  );
  assert.equal((await a.agent.get("/?page=edit&copy=seed-1")).status, 200);
  assert.equal(
    (
      await a.agent
        .post("/")
        .type("form")
        .send({ ...story, csrf: a.csrf, date: "2026-02-30" })
    ).status,
    422,
  );
  assert.equal(
    (
      await a.agent
        .post("/")
        .type("form")
        .send({ ...story, csrf: a.csrf, date: "9999-99-99" })
    ).status,
    422,
  );
});
test("workspaces cannot read/edit each other’s articles, pages, people or images", async () => {
  const f = fixture();
  const a = await start(f, "first");
  const b = await start(f, "second");
  const created = await a.agent
    .post("/")
    .type("form")
    .send({ ...story, csrf: a.csrf, title: "PRIVATE WORKSPACE STORY" });
  const id = new URL(created.headers.location, "http://local").searchParams.get(
    "id",
  );
  assert.equal((await b.agent.get(created.headers.location)).status, 404);
  assert.equal(
    (
      await b.agent
        .post("/")
        .type("form")
        .send({ ...story, csrf: b.csrf, id })
    ).status,
    404,
  );
  assert.doesNotMatch(
    (await b.agent.get("/api.php?type=articles")).text,
    /PRIVATE WORKSPACE STORY/,
  );
  const users = await a.agent.get("/api.php?type=users");
  assert.equal(
    (await b.agent.get("/api.php?type=users&id=" + users.body[0].id)).status,
    404,
  );
  assert.equal(
    (
      await b.agent.post("/").type("form").send({
        action: "user",
        csrf: b.csrf,
        id: users.body[0].id,
        name: "hijack",
        role: "admin",
      })
    ).status,
    404,
  );
});
test("pages validate unique safe URL keys and keep samples unchanged", async () => {
  const f = fixture();
  const a = await start(f);
  const page = {
    action: "page",
    csrf: a.csrf,
    title: "Our team",
    keywords: "demo,team",
    heading: "Good people",
    content: "Fictional team",
    slug: "our-team",
  };
  assert.equal((await a.agent.post("/").type("form").send(page)).status, 303);
  assert.match(
    (await a.agent.get("/?page=content&slug=our-team")).text,
    /Fictional team/,
  );
  assert.equal((await a.agent.post("/").type("form").send(page)).status, 422);
  assert.equal(
    (
      await a.agent
        .post("/")
        .type("form")
        .send({ ...page, slug: "../bad" })
    ).status,
    422,
  );
  assert.equal(
    (
      await a.agent
        .post("/")
        .type("form")
        .send({ ...page, slug: "about" })
    ).status,
    422,
  );
});
test("users preserve roles, hide hashes and revoke changed-password sessions", async () => {
  const f = fixture();
  const a = await start(f);
  let users = await a.agent.get("/api.php?type=users");
  const owner = users.body[0];
  assert.doesNotMatch(users.text, /password|scrypt|sessions/);
  assert.doesNotMatch(
    (await a.agent.get("/api.php?type=users&id=" + owner.id)).text,
    /password|scrypt/,
  );
  assert.equal(
    (
      await a.agent.post("/").type("form").send({
        action: "user",
        csrf: a.csrf,
        id: owner.id,
        name: "editor",
        role: "editor",
      })
    ).status,
    422,
  );
  assert.equal(
    (
      await a.agent.post("/").type("form").send({
        action: "user",
        csrf: a.csrf,
        name: "staff",
        role: "editor",
        password: "staff-password-123",
      })
    ).status,
    303,
  );
  await a.agent.post("/").type("form").send({ action: "logout", csrf: a.csrf });
  assert.equal(
    (
      await a.agent.post("/").type("form").send({
        action: "login",
        csrf: a.csrf,
        name: "staff",
        password: "staff-password-123",
      })
    ).status,
    303,
  );
  assert.equal((await a.agent.get("/?page=users")).status, 403);
  assert.equal((await a.agent.get("/api.php?type=users")).status, 403);
  assert.equal(
    (
      await a.agent.post("/").type("form").send({
        action: "user",
        csrf: a.csrf,
        name: "evil",
        role: "admin",
        password: "password-for-test",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await a.agent
        .post("/")
        .type("form")
        .send({ ...story, csrf: a.csrf })
    ).status,
    303,
  );
});
test("image uploads decode/resample safely, reject fake types and remain private", async () => {
  const f = fixture();
  const a = await start(f);
  const image = await sharp({
    create: { width: 12, height: 12, channels: 3, background: "#af3333" },
  })
    .png()
    .toBuffer();
  const response = await a.agent
    .post("/")
    .field("csrf", a.csrf)
    .field("action", "article")
    .field("title", "Image story")
    .field("content", "Test image")
    .field("author", "Demo")
    .field("date", "2026-10-21")
    .attach("image", image, "sample.png");
  assert.equal(response.status, 303, response.text);
  const data = (await a.agent.get("/api.php?type=articles")).body.find(
    (x) => x.title === "Image story",
  );
  assert.ok(data.image);
  const served = await a.agent.get("/image.php?id=" + data.image);
  assert.equal(served.status, 200);
  assert.match(served.headers["content-type"], /image\/jpeg/);
  assert.equal(
    (await request(f.app).get("/image.php?id=" + data.image)).status,
    404,
  );
  const b = await start(f, "other");
  assert.equal((await b.agent.get("/image.php?id=" + data.image)).status, 404);
  const invalid = await a.agent
    .post("/")
    .field("csrf", a.csrf)
    .field("action", "article")
    .field("title", "Bad")
    .field("content", "Bad")
    .field("author", "Demo")
    .field("date", "2026-10-21")
    .attach("image", Buffer.from('<svg onload="alert(1)"></svg>'), "fake.png");
  assert.equal(invalid.status, 422);
});
test("CSV import is atomic, handles quotes/newlines and neutralizes formulas in export", async () => {
  const f = fixture();
  const a = await start(f);
  const csv =
    'title,content,author,date\r\n"=2+2","A story, with commas\nand lines",Demo,2026-10-21\r\n';
  assert.equal(
    (
      await a.agent
        .post("/")
        .field("csrf", a.csrf)
        .field("action", "import")
        .attach("csv", Buffer.from(csv), "stories.csv")
    ).status,
    303,
  );
  const before = (await a.agent.get("/api.php?type=articles")).body.length;
  const invalid =
    "title,content,author,date\nGood,Content,Demo,2026-10-21\nBad,Content,Demo,2026-02-30\n";
  assert.equal(
    (
      await a.agent
        .post("/")
        .field("csrf", a.csrf)
        .field("action", "import")
        .attach("csv", Buffer.from(invalid), "stories.csv")
    ).status,
    422,
  );
  assert.equal(
    (await a.agent.get("/api.php?type=articles")).body.length,
    before,
  );
  assert.match((await a.agent.get("/export.php")).text, /"'=2\+2"/);
});
test("fixed96h expiry is not renewed by edits; immediate API expiry then cleanup removes all private data", async () => {
  const f = fixture();
  const a = await start(f);
  const doc = [...f.repository.docs.values()].find((x) => x.generation);
  const originalExpiry = +doc.expiresAt;
  f.advance(7 * 60 * 60 * 1000);
  assert.equal(
    (
      await a.agent
        .post("/")
        .type("form")
        .send({ ...story, csrf: a.csrf })
    ).status,
    303,
  );
  assert.equal(+f.repository.docs.get(doc._id).expiresAt, originalExpiry);
  f.advance(RETENTION_MS);
  assert.equal((await a.agent.get("/?page=desk")).status, 303);
  assert.equal((await a.agent.get("/api.php?type=articles")).body.length, 3);
  const result = await f.repository.cleanup(f.now());
  assert.equal(result.clearedWorkspaces, 1);
  const empty = f.repository.docs.get(doc._id);
  assert.equal(
    empty.users.length +
      empty.sessions.length +
      empty.articles.length +
      empty.images.length,
    0,
  );
  assert.deepEqual(f.repository.seed, seeds);
});
test("atomic hard100workspace limit survives parallel allocation and rejects oldgeneration afterreuse", async () => {
  const f = fixture();
  const attempts = await Promise.allSettled(
    Array.from({ length: SLOTS + 5 }, () =>
      f.repository.claim(
        { id: "u", name: "test", role: "admin", passwordHash: "hash" },
        f.now(),
      ),
    ),
  );
  assert.equal(attempts.filter((x) => x.status === "fulfilled").length, SLOTS);
  assert.equal(attempts.filter((x) => x.status === "rejected").length, 5);
  const old = attempts[0].value;
  f.advance(RETENTION_MS + 1);
  await f.repository.cleanup(f.now());
  const fresh = await f.repository.claim(
    { id: "u2", name: "new", role: "admin", passwordHash: "hash" },
    f.now(),
  );
  assert.equal(fresh._id, old._id);
  assert.notEqual(fresh.generation, old.generation);
  assert.equal(await f.repository.read(old._id, old.generation, f.now()), null);
});
test("workspace record caps reject entire mutations without partial writes", async () => {
  const f = fixture();
  const doc = await f.repository.claim(
    { id: "u", name: "a", role: "admin", passwordHash: "hash" },
    f.now(),
  );
  const binding = { slot: doc._id, generation: doc.generation };
  await assert.rejects(() =>
    f.repository.mutate(binding, f.now(), (d) => {
      d.articles = Array.from({ length: 31 }, (_, i) => ({
        id: String(i),
        title: "X",
      }));
    }),
  );
  assert.equal(
    (await f.repository.read(binding.slot, binding.generation, f.now()))
      .articles.length,
    0,
  );
});
test("stylesheet serves correctly and session expiry/password reset revoke authentication", async () => {
  const f = fixture();
  assert.match(
    (await request(f.app).get("/style.css")).headers["content-type"],
    /text\/css/,
  );
  const a = await start(f);
  const id = (await a.agent.get("/api.php?type=users")).body[0].id;
  const oldCookies = a.response.headers["set-cookie"].map(
    (c) => c.split(";")[0],
  );
  assert.equal(
    (
      await a.agent.post("/").type("form").send({
        action: "user",
        csrf: a.csrf,
        id,
        name: "editor",
        role: "admin",
        password: "changed-fictional-password",
      })
    ).status,
    303,
  );
  assert.equal(
    (await request(f.app).get("/?page=desk").set("Cookie", oldCookies)).status,
    303,
  );
  assert.equal(
    (
      await a.agent.post("/").type("form").send({
        action: "login",
        csrf: a.csrf,
        name: "editor",
        password: "fictional-password-123",
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await a.agent.post("/").type("form").send({
        action: "login",
        csrf: a.csrf,
        name: "editor",
        password: "changed-fictional-password",
      })
    ).status,
    303,
  );
  f.advance(8 * 60 * 60 * 1000 + 1);
  assert.equal((await a.agent.get("/?page=desk")).status, 303);
});
test("expensive password work is bounded to two concurrent operations", async () => {
  const { passwordHash } = require("../lib/security");
  const pending = [
    passwordHash("long-fictional-password-1"),
    passwordHash("long-fictional-password-2"),
  ];
  await assert.rejects(
    passwordHash("long-fictional-password-3"),
    (error) => error.status === 503,
  );
  await Promise.all(pending);
});
