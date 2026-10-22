const { randomUUID } = require("node:crypto");
const { MongoClient } = require("mongodb");
const {
  Problem,
  RETENTION_MS,
  active,
  checkBudget,
  seeds,
} = require("./domain");
const SLOTS = 100;
function emptySlot(i) {
  return {
    _id: `workspace:${i}`,
    kind: "workspace",
    isSeed: false,
    generation: null,
    rev: 0,
    expiresAt: new Date(0),
    users: [],
    articles: [],
    pages: [],
    images: [],
    sessions: [],
  };
}
function newWorkspace(user, now) {
  return {
    kind: "workspace",
    isSeed: false,
    generation: randomUUID(),
    rev: 0,
    createdAt: new Date(now),
    expiresAt: new Date(+now + RETENTION_MS),
    users: [user],
    articles: [],
    pages: [],
    images: [],
    sessions: [],
  };
}
function cleanData() {
  return {
    generation: null,
    createdAt: null,
    expiresAt: new Date(0),
    users: [],
    articles: [],
    pages: [],
    images: [],
    sessions: [],
  };
}
class MongoRepository {
  constructor(collection) {
    this.collection = collection;
  }
  async prepare({ skipIndexes = true } = {}) {
    await this.collection.updateOne(
      { _id: "seed-content" },
      {
        $setOnInsert: { kind: "seed", isSeed: true, ...structuredClone(seeds) },
      },
      { upsert: true },
    );
    for (let i = 0; i < SLOTS; i++)
      await this.collection.updateOne(
        { _id: `workspace:${i}` },
        { $setOnInsert: emptySlot(i) },
        { upsert: true },
      );
    if (!skipIndexes)
      await this.collection.createIndex(
        { kind: 1, expiresAt: 1 },
        { name: "edit_workspace_expiry" },
      );
  }
  async claim(user, now) {
    const doc = await this.collection.findOneAndUpdate(
      { kind: "workspace", isSeed: false, expiresAt: { $lte: now } },
      { $set: newWorkspace(user, now) },
      { returnDocument: "after" },
    );
    if (!doc)
      throw new Problem(
        "All demo workspaces are in use. Please try again later.",
        503,
      );
    return doc;
  }
  async read(slot, generation, now) {
    const doc = await this.collection.findOne({
      _id: slot,
      generation,
      kind: "workspace",
      isSeed: false,
      expiresAt: { $gt: now },
    });
    return doc;
  }
  async mutate(binding, now, fn) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const doc = await this.read(binding.slot, binding.generation, now);
      if (!doc)
        throw new Problem("Your workspace has expired. Start a new demo.", 410);
      const original = doc.rev;
      const result = await fn(doc);
      checkBudget(doc);
      doc.rev = original + 1;
      const changed = await this.collection.replaceOne(
        {
          _id: doc._id,
          generation: doc.generation,
          rev: original,
          expiresAt: { $gt: now },
        },
        doc,
      );
      if (changed.modifiedCount === 1) return { doc, result };
    }
    throw new Problem(
      "Another change arrived at the same time. Please try again.",
      409,
    );
  }
  async cleanup(now) {
    const result = await this.collection.updateMany(
      {
        kind: "workspace",
        isSeed: false,
        generation: { $ne: null },
        expiresAt: { $lte: now },
      },
      { $set: cleanData(), $inc: { rev: 1 } },
    );
    return { clearedWorkspaces: result.modifiedCount };
  }
  async health() {
    const seed = await this.collection.findOne(
      { _id: "seed-content", isSeed: true },
      { projection: { _id: 1 } },
    );
    if (!seed) throw new Error("Database has not been prepared.");
  }
}
class MemoryRepository {
  constructor() {
    this.docs = new Map(
      Array.from({ length: SLOTS }, (_, i) => {
        const doc = emptySlot(i);
        return [doc._id, doc];
      }),
    );
    this.seed = structuredClone(seeds);
    this.queue = Promise.resolve();
  }
  async prepare() {}
  async exclusive(fn) {
    const next = this.queue.then(fn);
    this.queue = next.catch(() => {});
    return next;
  }
  async claim(user, now) {
    return this.exclusive(() => {
      for (const [id, doc] of this.docs)
        if (!active(doc, now)) {
          const fresh = { _id: id, ...newWorkspace(user, now) };
          this.docs.set(id, fresh);
          return structuredClone(fresh);
        }
      throw new Problem(
        "All demo workspaces are in use. Please try again later.",
        503,
      );
    });
  }
  async read(slot, generation, now) {
    const doc = this.docs.get(slot);
    return active(doc, now) && doc.generation === generation
      ? structuredClone(doc)
      : null;
  }
  async mutate(binding, now, fn) {
    return this.exclusive(async () => {
      const doc = await this.read(binding.slot, binding.generation, now);
      if (!doc)
        throw new Problem("Your workspace has expired. Start a new demo.", 410);
      const result = await fn(doc);
      checkBudget(doc);
      doc.rev++;
      this.docs.set(doc._id, structuredClone(doc));
      return { doc, result };
    });
  }
  async cleanup(now) {
    return this.exclusive(() => {
      let count = 0;
      for (const doc of this.docs.values())
        if (doc.generation && !active(doc, now)) {
          Object.assign(doc, cleanData(), { rev: doc.rev + 1 });
          count++;
        }
      return { clearedWorkspaces: count };
    });
  }
  async health() {}
}
let pending;
async function connect() {
  if (!pending)
    pending = (async () => {
      if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is required.");
      const client = new MongoClient(process.env.MONGODB_URI, {
        retryWrites: false,
        maxPoolSize: 3,
        serverSelectionTimeoutMS: 10000,
      });
      await client.connect();
      const db = client.db(process.env.MONGODB_DATABASE || "portfolio-demos");
      return {
        client,
        db,
        repository: new MongoRepository(db.collection("edit_demo")),
      };
    })().catch((error) => {
      pending = null;
      throw error;
    });
  return pending;
}
module.exports = {
  MongoRepository,
  MemoryRepository,
  connect,
  SLOTS,
  emptySlot,
};
