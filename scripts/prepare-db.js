const { connect } = require("../lib/repository");
(async () => {
  let client;
  try {
    const connected = await connect();
    client = connected.client;
    await connected.repository.prepare({ skipIndexes: true });
    console.log(
      "Prepared permanent sample content and 100 bounded workspace slots. No indexes or capacity changed.",
    );
  } catch {
    console.error(
      "Database preparation failed. Check the private connection settings and collection permissions.",
    );
    process.exitCode = 1;
  } finally {
    await client?.close();
  }
})();
