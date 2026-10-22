const { connect } = require("./lib/repository");
const { createApp } = require("./app");
connect()
  .then(({ repository }) => {
    const app = createApp({
      repository,
      secret: process.env.SESSION_SECRET,
      secure: process.env.NODE_ENV === "production",
    });
    app.listen(process.env.PORT || 4372, "127.0.0.1", () =>
      console.log("The Edit server ready."),
    );
  })
  .catch(() => {
    console.error(
      "Unable to connect to the database. Check server configuration.",
    );
    process.exitCode = 1;
  });
