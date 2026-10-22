const test = require("node:test");
const assert = require("node:assert/strict");
const { MongoMemoryServer } = require("mongodb-memory-server");
const { MongoClient } = require("mongodb");
const { MongoRepository, SLOTS } = require("../lib/repository");
const { RETENTION_MS } = require("../lib/domain");
test(
  "real Mongo persistence: idempotent seed/slots, atomic claims/CAS, fixed expiry and seed-safe cleanup",
  { timeout: 120000 },
  async () => {
    const server = await MongoMemoryServer.create();
    const client = new MongoClient(server.getUri());
    await client.connect();
    try {
      const collection = client.db("edit_test").collection("edit_demo");
      const repo = new MongoRepository(collection);
      await repo.prepare({ skipIndexes: true });
      await repo.prepare({ skipIndexes: true });
      assert.equal(await collection.countDocuments({}), 101);
      assert.equal(
        (await collection.indexes()).length,
        1,
        "scoped preparation must not create indexes",
      );
      await repo.health();
      const now = new Date("2026-10-21T12:00:00Z");
      const attempts = await Promise.allSettled(
        Array.from({ length: SLOTS + 5 }, () =>
          repo.claim(
            { id: "u", name: "test", role: "admin", passwordHash: "hash" },
            now,
          ),
        ),
      );
      assert.equal(
        attempts.filter((x) => x.status === "fulfilled").length,
        100,
      );
      assert.equal(attempts.filter((x) => x.status === "rejected").length, 5);
      const first = attempts.find((x) => x.status === "fulfilled").value;
      const binding = { slot: first._id, generation: first.generation };
      assert.equal(+first.expiresAt, +now + RETENTION_MS);
      await Promise.all(
        Array.from({ length: 4 }, (_, i) =>
          repo.mutate(binding, now, (doc) => {
            doc.articles.push({
              id: String(i),
              title: "Concurrent story " + i,
              content: "Test",
              date: "2026-10-21",
              author: "Demo",
            });
          }),
        ),
      );
      const after = await repo.read(binding.slot, binding.generation, now);
      assert.equal(after.articles.length, 4);
      assert.equal(after.rev, 4);
      assert.equal(+after.expiresAt, +first.expiresAt);
      await assert.rejects(
        repo.mutate(binding, now, (doc) => {
          doc.pages = Array.from({ length: 11 }, () => ({}));
        }),
      );
      assert.equal(
        (await repo.read(binding.slot, binding.generation, now)).pages.length,
        0,
      );
      const expired = new Date(+now + RETENTION_MS + 1);
      assert.equal(
        await repo.read(binding.slot, binding.generation, expired),
        null,
      );
      const result = await repo.cleanup(expired);
      assert.equal(result.clearedWorkspaces, 100);
      assert.equal(await collection.countDocuments({}), 101);
      assert.equal(
        (await collection.findOne({ _id: "seed-content" })).isSeed,
        true,
      );
      assert.equal(
        (await collection.findOne({ _id: first._id })).articles.length,
        0,
      );
      const next = await repo.claim(
        { id: "new", name: "new", role: "admin", passwordHash: "hash" },
        expired,
      );
      assert.notEqual(next.generation, first.generation);
      assert.equal(
        await repo.read(binding.slot, binding.generation, expired),
        null,
      );
    } finally {
      await client.close();
      await server.stop();
    }
  },
);
