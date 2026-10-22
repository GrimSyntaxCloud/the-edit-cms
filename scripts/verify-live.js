// Explicit release verification against the owner-authorized demo only.
// Creates fictional test workspaces; with a scoped URI it expires only those generations.
const assert = require("node:assert/strict");
const sharp = require("sharp");
const { connect } = require("../lib/repository");
const { RETENTION_MS } = require("../lib/domain");
const base =
  process.env.DEMO_URL ||
  "https://salmon-pebble-0af10980f.2.azurestaticapps.net";
const password = "fictional-live-verification-123";
const created = [];
const results = [];
function browser() {
  const jar = {};
  return {
    jar,
    async request(path, options = {}) {
      const headers = new Headers(options.headers);
      headers.set(
        "Cookie",
        Object.entries(jar)
          .map(([key, value]) => key + "=" + value)
          .join("; "),
      );
      const response = await fetch(base + path, {
        ...options,
        headers,
        redirect: "manual",
      });
      for (const value of response.headers.getSetCookie()) {
        const pair = value.split(";")[0];
        const at = pair.indexOf("=");
        jar[pair.slice(0, at)] = pair.slice(at + 1);
      }
      const text = await response.text();
      return { status: response.status, headers: response.headers, text };
    },
    async form(fields) {
      return this.request("/", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(fields).toString(),
      });
    },
  };
}
const csrfOf = (response) => {
  const value = response.text.match(/name="csrf" value="([^"]+)"/);
  assert.ok(value, "CSRF token rendered");
  return value[1];
};
function binding(browser) {
  const value = decodeURIComponent(browser.jar.edit_workspace).split(".")[0];
  return JSON.parse(Buffer.from(value, "base64url").toString());
}
(async () => {
  let client;
  try {
    const a = browser(),
      b = browser();
    let response = await a.request("/api/health");
    assert.equal(response.status, 200);
    assert.equal(JSON.parse(response.text).database, "connected");
    results.push("health/database");
    for (const [i, actor] of [a, b].entries()) {
      const page = await actor.request("/?page=start");
      assert.equal(page.status, 200);
      actor.csrf = csrfOf(page);
      actor.name = "release-" + Date.now() + "-" + i;
      response = await actor.form({
        action: "start",
        csrf: actor.csrf,
        name: actor.name,
        password,
      });
      assert.equal(response.status, 303, response.text);
      assert.ok(actor.jar.edit_auth);
      created.push(binding(actor));
      assert.match(response.headers.getSetCookie().join(";"), /HttpOnly/i);
      assert.match(response.headers.getSetCookie().join(";"), /Secure/i);
    }
    results.push("isolated workspace signup");
    const desk = await a.request("/?page=desk");
    assert.equal(desk.status, 200);
    const expiry = desk.text.match(/<time[^>]*>([^<]+)<\/time>/)?.[1];
    assert.ok(expiry, "Fixed deadline visible");
    const title = "Release verification " + Date.now();
    response = await a.form({
      action: "article",
      csrf: a.csrf,
      title,
      content: "Fictional release verification story.",
      author: "Demo editor",
      date: new Date().toISOString().slice(0, 10),
    });
    assert.equal(response.status, 303, response.text);
    const articlePath = response.headers.get("location");
    assert.equal((await a.request(articlePath)).status, 200);
    assert.equal((await b.request(articlePath)).status, 404);
    assert.ok(
      !(await b.request("/api.php?type=articles")).text.includes(title),
    );
    results.push("story persistence and cross-workspace isolation");
    const form = new FormData();
    for (const [key, value] of Object.entries({
      action: "article",
      csrf: a.csrf,
      title: "Image " + title,
      content: "Fictional image verification.",
      author: "Demo editor",
      date: new Date().toISOString().slice(0, 10),
    }))
      form.set(key, value);
    const png = await sharp({
      create: { width: 20, height: 20, channels: 3, background: "#b84432" },
    })
      .png()
      .toBuffer();
    form.set("image", new Blob([png], { type: "image/png" }), "demo.png");
    response = await a.request("/", { method: "POST", body: form });
    assert.equal(response.status, 303, response.text);
    const stories = JSON.parse(
      (await a.request("/api.php?type=articles")).text,
    );
    const imageStory = stories.find((s) => s.title === "Image " + title);
    assert.ok(imageStory.image);
    const imageResponse = await fetch(
      base + "/image.php?id=" + imageStory.image,
      {
        headers: {
          Cookie: Object.entries(a.jar)
            .map(([key, value]) => key + "=" + value)
            .join("; "),
        },
      },
    );
    assert.equal(imageResponse.status, 200);
    assert.equal(
      (await sharp(Buffer.from(await imageResponse.arrayBuffer())).metadata())
        .format,
      "jpeg",
    );
    assert.equal(
      (await b.request("/image.php?id=" + imageStory.image)).status,
      404,
    );
    results.push("private real image upload/download");
    const csv = new FormData();
    csv.set("csrf", a.csrf);
    csv.set("action", "import");
    csv.set(
      "csv",
      new Blob(
        [
          'title,content,author,date\n"=1+1",Fictional CSV story,Demo,' +
            new Date().toISOString().slice(0, 10) +
            "\n",
        ],
        { type: "text/csv" },
      ),
      "stories.csv",
    );
    response = await a.request("/", { method: "POST", body: csv });
    assert.equal(response.status, 303, response.text);
    assert.match((await a.request("/export.php")).text, /"'=1\+1"/);
    results.push("CSV import/export");
    response = await a.form({
      action: "page",
      csrf: a.csrf,
      title: "Release page",
      keywords: "demo",
      heading: "Fictional page",
      content: "Private workspace page.",
      slug: "release-page",
    });
    assert.equal(response.status, 303, response.text);
    assert.equal(
      (await a.request("/?page=content&slug=release-page")).status,
      200,
    );
    assert.equal(
      (await b.request("/?page=content&slug=release-page")).status,
      404,
    );
    results.push("custom pages and ownership");
    const people = await a.request("/api.php?type=users");
    assert.equal(people.status, 200);
    assert.doesNotMatch(people.text, /passwordHash|scrypt|sessions/);
    response = await a.form({
      action: "user",
      csrf: a.csrf,
      name: "staff-review",
      role: "editor",
      password,
    });
    assert.equal(response.status, 303, response.text);
    const priorAuth = a.jar.edit_auth;
    assert.equal(
      (await a.form({ action: "logout", csrf: a.csrf })).status,
      303,
    );
    assert.equal(
      (
        await a.form({
          action: "login",
          csrf: a.csrf,
          name: "staff-review",
          password,
        })
      ).status,
      303,
    );
    assert.equal((await a.request("/api.php?type=users")).status, 403);
    assert.equal(
      (
        await a.form({
          action: "user",
          csrf: a.csrf,
          name: "forbidden",
          role: "admin",
          password,
        })
      ).status,
      403,
    );
    assert.equal((await a.request(articlePath)).status, 200);
    assert.ok((await a.request("/?page=desk")).text.includes(expiry));
    results.push(
      "roles, logout/login, retained content and unchanged deadline",
    );
    const replay = browser();
    replay.jar.edit_auth = priorAuth;
    replay.jar.edit_workspace = a.jar.edit_workspace;
    assert.equal((await replay.request("/?page=desk")).status, 303);
    results.push("revoked session replay denied");
    if (process.env.MONGODB_URI) {
      const connected = await connect();
      client = connected.client;
      const collection = connected.db.collection("edit_demo");
      const before = await collection.findOne({ _id: "seed-content" });
      for (const item of created) {
        const doc = await collection.findOne({
          _id: item.slot,
          generation: item.generation,
        });
        assert.ok(doc);
        assert.equal(+doc.expiresAt - +doc.createdAt, RETENTION_MS);
        const expired = await collection.updateOne(
          { _id: item.slot, generation: item.generation },
          { $set: { expiresAt: new Date(Date.now() - 1000) } },
        );
        assert.equal(expired.modifiedCount, 1);
      }
      assert.equal((await a.request("/?page=desk")).status, 303);
      assert.equal(
        JSON.parse((await a.request("/api.php?type=articles")).text).length,
        3,
      );
      await connected.repository.cleanup(new Date());
      for (const item of created) {
        const doc = await collection.findOne({ _id: item.slot });
        assert.equal(doc.generation, null);
        assert.equal(
          doc.users.length +
            doc.articles.length +
            doc.pages.length +
            doc.images.length +
            doc.sessions.length,
          0,
        );
      }
      assert.deepEqual(
        await collection.findOne({ _id: "seed-content" }),
        before,
      );
      assert.equal(await collection.countDocuments({}), 101);
      results.push(
        "real Cosmos fixed96h/expiry/cleanup; permanent seed and101documents preserved",
      );
    }
    console.log(
      JSON.stringify(
        {
          url: base,
          checks: results,
          createdWorkspaceBindings: process.env.MONGODB_URI
            ? undefined
            : created,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error("Live verification failed:", error.message);
    process.exitCode = 1;
  } finally {
    if (process.env.MONGODB_URI && created.length) {
      try {
        const connected = await connect();
        client = connected.client;
        const collection = connected.db.collection("edit_demo");
        for (const item of created)
          await collection.updateOne(
            {
              _id: item.slot,
              generation: item.generation,
              kind: "workspace",
              isSeed: false,
            },
            { $set: { expiresAt: new Date(Date.now() - 1000) } },
          );
        await connected.repository.cleanup(new Date());
      } catch {
        console.error(
          "Test workspace cleanup could not finish; normal 96-hour expiry still applies.",
        );
        process.exitCode = 1;
      }
    }
    await client?.close();
  }
})();
