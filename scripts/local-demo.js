const { MemoryRepository } = require("../lib/repository");
const { createApp } = require("../app");
const { randomBytes } = require("node:crypto");
const app = createApp({
  repository: new MemoryRepository(),
  secret: randomBytes(48).toString("hex"),
  secure: false,
  limits: false,
});
app.listen(process.env.PORT || 4372, "127.0.0.1", () =>
  console.log(
    "The Edit local review: http://127.0.0.1:" +
      (process.env.PORT || 4372) +
      " (temporary memory only; hosted edition uses Cosmos DB)",
  ),
);
