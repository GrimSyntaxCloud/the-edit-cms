const { connect } = require("../lib/repository");
(async () => {
  let client;
  try {
    const connected = await connect();
    client = connected.client;
    const result = await connected.repository.cleanup(new Date());
    console.log(JSON.stringify(result));
  } catch {
    console.error("Cleanup failed. Check private connection settings.");
    process.exitCode = 1;
  } finally {
    await client?.close();
  }
})();
