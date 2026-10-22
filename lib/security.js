const {
  randomBytes,
  scrypt: rawScrypt,
  timingSafeEqual,
  createHmac,
  createHash,
} = require("node:crypto");
const { promisify } = require("node:util");
const scrypt = promisify(rawScrypt);
const { Problem } = require("./domain");
let activeHashes = 0;
async function derive(password, salt) {
  if (activeHashes >= 2)
    throw new Problem("Sign-in is busy. Please try again in a moment.", 503);
  activeHashes++;
  try {
    return await scrypt(password, salt, 64, {
      N: 65536,
      r: 8,
      p: 2,
      maxmem: 80 * 1024 * 1024,
    });
  } finally {
    activeHashes--;
  }
}
const hash = (value) => createHash("sha256").update(value).digest("hex");
const token = () => randomBytes(32).toString("base64url");
const equal = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
async function passwordHash(password) {
  const salt = randomBytes(16).toString("hex");
  const key = await derive(password, salt);
  return "scrypt$" + salt + "$" + key.toString("hex");
}
async function verifyPassword(password, value) {
  if (typeof password !== "string" || Buffer.byteLength(password) > 256)
    return false;
  const [algorithm, salt, expected] = String(value).split("$");
  if (
    algorithm !== "scrypt" ||
    !salt ||
    !/^[a-f0-9]{128}$/.test(expected || "")
  )
    return false;
  const key = await derive(password, salt);
  return equal(key.toString("hex"), expected);
}
function signer(secret) {
  if (typeof secret !== "string" || secret.length < 32)
    throw new Error("SESSION_SECRET must contain at least 32 characters.");
  return {
    sign(value) {
      const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
      return (
        payload +
        "." +
        createHmac("sha256", secret).update(payload).digest("base64url")
      );
    },
    read(value) {
      try {
        if (typeof value !== "string" || value.length > 2048) return null;
        const [payload, sig, ...rest] = value.split(".");
        if (
          rest.length ||
          !equal(
            createHmac("sha256", secret).update(payload).digest("base64url"),
            sig,
          )
        )
          return null;
        return JSON.parse(Buffer.from(payload, "base64url").toString());
      } catch {
        return null;
      }
    },
  };
}
function cookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || "")
      .split(";")
      .map((pair) => {
        const i = pair.indexOf("=");
        if (i < 0) return [];
        try {
          return [
            pair.slice(0, i).trim(),
            decodeURIComponent(pair.slice(i + 1)),
          ];
        } catch {
          return [];
        }
      })
      .filter((pair) => pair.length === 2),
  );
}
module.exports = {
  hash,
  token,
  equal,
  passwordHash,
  verifyPassword,
  signer,
  cookies,
};
