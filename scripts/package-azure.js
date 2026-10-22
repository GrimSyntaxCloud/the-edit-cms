const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const out = path.join(root, "release");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, "api"), { recursive: true });
fs.mkdirSync(path.join(out, "site"), { recursive: true });
for (const name of ["app.js", "lib", "views", "azure", "package-lock.json"])
  fs.cpSync(path.join(root, name), path.join(out, "api", name), {
    recursive: true,
  });
fs.copyFileSync(
  path.join(root, "azure/host.json"),
  path.join(out, "api/host.json"),
);
const pkg = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);
pkg.main = "azure/functions.js";
pkg.engines = { node: "22.x" };
delete pkg.scripts;
delete pkg.devDependencies;
fs.writeFileSync(
  path.join(out, "api/package.json"),
  JSON.stringify(pkg, null, 2) + "\n",
);
fs.cpSync(path.join(root, "public"), path.join(out, "site"), {
  recursive: true,
});
fs.cpSync(path.join(root, "public"), path.join(out, "api/public"), {
  recursive: true,
});
fs.copyFileSync(
  path.join(root, "azure/staticwebapp.config.json"),
  path.join(out, "site/staticwebapp.config.json"),
);
fs.writeFileSync(
  path.join(out, "site/index.html"),
  '<!doctype html><html lang="en"><meta charset="utf-8"><title>The Edit</title><p>The Edit is starting. Please refresh in a moment.</p></html>\n',
);
console.log(
  "Azure source package created. Install production dependencies inside release/api on Linux before deployment.",
);
