const express = require("express");
const helmet = require("helmet");
const multer = require("multer");
const { rateLimit } = require("express-rate-limit");
const { randomUUID } = require("node:crypto");
const path = require("node:path");
const {
  Problem,
  seeds,
  RETENTION_MS,
  MAX_UPLOAD_BYTES,
  articleData,
  pageData,
  userData,
  parseCsv,
  csvExport,
  imageData,
  checkBudget,
  attachImage,
  visibleArticles,
} = require("./lib/domain");
const {
  hash,
  token,
  equal,
  passwordHash,
  verifyPassword,
  signer,
  cookies,
} = require("./lib/security");
const SESSION_MS = 8 * 60 * 60 * 1000;
function createApp({
  repository,
  secret,
  secure = true,
  now = () => new Date(),
  limits = true,
}) {
  const app = express();
  const signed = signer(secret);
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.set("view engine", "ejs");
  app.set("views", path.join(__dirname, "views"));
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'none'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'self'"],
          baseUri: ["'self'"],
        },
      },
    }),
  );
  app.get("/style.css", (req, res) =>
    res.sendFile(path.join(__dirname, "public/style.css")),
  );
  app.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.use(
    express.urlencoded({ extended: false, limit: "90kb", parameterLimit: 30 }),
  );
  const cookieOptions = { httpOnly: true, sameSite: "lax", secure, path: "/" };
  const writeCookie = (res, name, value, maxAge) =>
    res.cookie(name, signed.sign(value), { ...cookieOptions, maxAge });
  const clearAuth = (res) => res.clearCookie("edit_auth", cookieOptions);
  const bindingOf = (doc) => ({ slot: doc._id, generation: doc.generation });
  const validBinding = (b) =>
    b &&
    typeof b.slot === "string" &&
    /^workspace:\d{1,2}$/.test(b.slot) &&
    typeof b.generation === "string" &&
    /^[a-f0-9-]{36}$/.test(b.generation);
  function actor(doc, sessionHash, time) {
    const session = doc.sessions.find(
      (s) => s.hash === sessionHash && +new Date(s.expiresAt) > +time,
    );
    const user = session && doc.users.find((u) => u.id === session.userId);
    if (!user) throw new Problem("Your session ended. Sign in again.", 401);
    return user;
  }
  app.use(async (req, res, next) => {
    try {
      req.clock = now();
      const jar = cookies(req);
      const csrf = signed.read(jar.edit_csrf);
      req.csrf = csrf && typeof csrf.token === "string" ? csrf.token : token();
      if (!csrf)
        writeCookie(res, "edit_csrf", { token: req.csrf }, RETENTION_MS);
      const b = signed.read(jar.edit_workspace);
      req.binding = validBinding(b) ? b : null;
      req.workspace = req.binding
        ? await repository.read(b.slot, b.generation, req.clock)
        : null;
      req.user = null;
      const auth = signed.read(jar.edit_auth);
      if (
        req.workspace &&
        auth &&
        auth.slot === b.slot &&
        auth.generation === b.generation &&
        typeof auth.token === "string"
      ) {
        req.sessionHash = hash(auth.token);
        try {
          req.user = actor(req.workspace, req.sessionHash, req.clock);
        } catch {
          clearAuth(res);
        }
      }
      res.locals = {
        csrf: req.csrf,
        user: req.user,
        workspace: req.user ? req.workspace : null,
        hasWorkspace: Boolean(req.workspace),
        page: "home",
        error: "",
        notice: "",
        form: {},
        item: null,
        rows: [],
        search: "",
        sort: "newest",
        seeds,
        articles: visibleArticles(req.user ? req.workspace : null),
        today: req.clock.toISOString().slice(0, 10),
        imageUrl: (id) => "/image.php?id=" + encodeURIComponent(id),
        expiry: req.workspace
          ? new Date(req.workspace.expiresAt).toISOString()
          : null,
      };
      next();
    } catch {
      next(
        new Problem(
          "The demo is temporarily unavailable. Please try again.",
          503,
        ),
      );
    }
  });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: MAX_UPLOAD_BYTES,
      files: 1,
      fields: 15,
      fieldSize: 25000,
      parts: 18,
    },
  }).fields([
    { name: "image", maxCount: 1 },
    { name: "csv", maxCount: 1 },
  ]);
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: "Too many sign-in attempts. Please try again in 15 minutes.",
    skip: () => !limits,
  });
  const startLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 3,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: "Please wait before starting another demo workspace.",
    skip: () => !limits,
  });
  function requireUser(req, res, next) {
    if (!req.user) return res.redirect(303, "/?page=login");
    next();
  }
  function mustAdmin(user) {
    if (user.role !== "admin")
      throw new Problem("Administrator access required.", 403);
  }
  async function signInSession(
    binding,
    userId,
    req,
    res,
    expectedPasswordHash,
  ) {
    const raw = token();
    const result = await repository.mutate(binding, req.clock, (doc) => {
      const current = doc.users.find((user) => user.id === userId);
      if (!current || current.passwordHash !== expectedPasswordHash)
        throw new Problem("Your credentials changed. Sign in again.", 401);
      doc.sessions = doc.sessions
        .filter((s) => +new Date(s.expiresAt) > +req.clock)
        .slice(-9);
      doc.sessions.push({
        hash: hash(raw),
        userId,
        expiresAt: new Date(
          Math.min(+new Date(doc.expiresAt), +req.clock + SESSION_MS),
        ),
      });
    });
    writeCookie(
      res,
      "edit_workspace",
      binding,
      Math.max(0, +new Date(result.doc.expiresAt) - +req.clock),
    );
    writeCookie(
      res,
      "edit_auth",
      { ...binding, token: raw },
      Math.min(SESSION_MS, +new Date(result.doc.expiresAt) - +req.clock),
    );
  }
  app.post(
    "/",
    upload,
    (req, res, next) => {
      if (!equal(req.csrf, req.body?.csrf))
        return next(
          new Problem("Your form expired. Refresh and try again.", 403),
        );
      next();
    },
    (req, res, next) => {
      if (["login", "start"].includes(req.body.action))
        return authLimiter(req, res, next);
      next();
    },
    (req, res, next) =>
      req.body.action === "start" ? startLimiter(req, res, next) : next(),
    async (req, res, next) => {
      try {
        const action = req.body.action;
        const uploaded = req.files?.image?.[0];
        if (action === "start") {
          const input = userData({ ...req.body, role: "admin" }, true);
          const user = {
            id: randomUUID(),
            name: input.name,
            passwordHash: await passwordHash(input.password),
            role: "admin",
          };
          const doc = await repository.claim(user, req.clock);
          await signInSession(
            bindingOf(doc),
            user.id,
            req,
            res,
            user.passwordHash,
          );
          return res.redirect(303, "/?page=desk");
        }
        if (action === "login") {
          if (!req.workspace)
            throw new Problem(
              "This workspace is missing or expired. Start a new demo.",
              410,
            );
          const name =
            typeof req.body.name === "string" ? req.body.name.trim() : "";
          const user = req.workspace.users.find(
            (u) => u.name.toLowerCase() === name.toLowerCase(),
          );
          if (
            !user ||
            !(await verifyPassword(req.body.password, user.passwordHash))
          )
            throw new Problem("Username or password not recognized.", 401);
          await signInSession(
            req.binding,
            user.id,
            req,
            res,
            user.passwordHash,
          );
          return res.redirect(303, "/?page=desk");
        }
        if (!req.user)
          throw new Problem("Sign in to your workspace first.", 401);
        if (action === "logout") {
          await repository.mutate(req.binding, req.clock, (doc) => {
            doc.sessions = doc.sessions.filter(
              (s) => s.hash !== req.sessionHash,
            );
          });
          clearAuth(res);
          return res.redirect(303, "/");
        }
        if (action === "article" || action === "page") {
          const data =
            action === "article" ? articleData(req.body) : pageData(req.body);
          const image = await imageData(uploaded);
          const id = typeof req.body.id === "string" ? req.body.id : "";
          if (id.startsWith("seed-"))
            throw new Problem(
              "Sample content is read-only. Use “Copy to workspace” instead.",
              403,
            );
          const result = await repository.mutate(
            req.binding,
            req.clock,
            (doc) => {
              actor(doc, req.sessionHash, req.clock);
              const collection =
                action === "article" ? doc.articles : doc.pages;
              let record = id ? collection.find((r) => r.id === id) : null;
              if (id && !record)
                throw new Problem("That record is not in your workspace.", 404);
              if (
                action === "page" &&
                doc.pages.some((p) => p.slug === data.slug && p.id !== id)
              )
                throw new Problem("That URL key is already in use.");
              if (!record) {
                record = {
                  id: randomUUID(),
                  createdAt: new Date(req.clock),
                  expiresAt: new Date(doc.expiresAt),
                  isSeed: false,
                };
                collection.push(record);
              }
              Object.assign(record, data);
              attachImage(doc, record, image);
              return record.id;
            },
          );
          return res.redirect(
            303,
            action === "article"
              ? "/?page=article&id=" + result.result
              : "/?page=pages",
          );
        }
        if (action === "import") {
          const file = req.files?.csv?.[0];
          if (!file) throw new Problem("Choose a CSV file.");
          const records = parseCsv(file.buffer);
          await repository.mutate(req.binding, req.clock, (doc) => {
            actor(doc, req.sessionHash, req.clock);
            for (const data of records)
              doc.articles.push({
                id: randomUUID(),
                ...data,
                isSeed: false,
                createdAt: new Date(req.clock),
                expiresAt: new Date(doc.expiresAt),
              });
          });
          return res.redirect(303, "/?page=desk&imported=" + records.length);
        }
        if (action === "user") {
          mustAdmin(req.user);
          const id = typeof req.body.id === "string" ? req.body.id : "";
          const data = userData(req.body, !id);
          const password = data.password
            ? await passwordHash(data.password)
            : null;
          const image = await imageData(uploaded);
          let revoked = false;
          await repository.mutate(req.binding, req.clock, (doc) => {
            const current = actor(doc, req.sessionHash, req.clock);
            mustAdmin(current);
            let user = id ? doc.users.find((u) => u.id === id) : null;
            if (id && !user)
              throw new Problem("That person is not in your workspace.", 404);
            if (id === current.id && data.role !== "admin")
              throw new Problem(
                "You cannot remove your own administrator role.",
              );
            if (
              doc.users.some(
                (u) =>
                  u.id !== id &&
                  u.name.toLowerCase() === data.name.toLowerCase(),
              )
            )
              throw new Problem("That username is already in use.");
            if (!user) {
              user = {
                id: randomUUID(),
                createdAt: new Date(req.clock),
                expiresAt: new Date(doc.expiresAt),
              };
              doc.users.push(user);
            }
            const roleChanged = user.role && user.role !== data.role;
            Object.assign(user, { name: data.name, role: data.role });
            if (password) user.passwordHash = password;
            if (password || roleChanged) {
              doc.sessions = doc.sessions.filter((s) => s.userId !== user.id);
              revoked = id === current.id;
            }
            attachImage(doc, user, image);
          });
          if (revoked) {
            clearAuth(res);
            return res.redirect(303, "/?page=login");
          }
          return res.redirect(303, "/?page=users");
        }
        throw new Problem("Unknown action.", 400);
      } catch (error) {
        next(error);
      }
    },
  );
  app.get("/api.php", (req, res, next) => {
    try {
      const type = req.query.type || "articles";
      let rows;
      if (type === "articles")
        rows = visibleArticles(req.user ? req.workspace : null).map(
          ({ id, title, content, author, date, image }) => ({
            id,
            title,
            content,
            author,
            date,
            image,
          }),
        );
      else if (type === "users") {
        if (!req.user || req.user.role !== "admin")
          throw new Problem("Administrator access required.", 403);
        rows = req.workspace.users.map(({ id, name, role, image }) => ({
          id,
          name,
          role,
          image,
        }));
      } else throw new Problem("Unknown resource.", 400);
      if (req.query.id) {
        const record = rows.find((r) => r.id === req.query.id);
        if (!record) throw new Problem("Not found.", 404);
        return res.json(record);
      }
      res.json(rows);
    } catch (error) {
      next(error);
    }
  });
  app.get("/export.php", requireUser, (req, res) => {
    res
      .type("text/csv")
      .set(
        "Content-Disposition",
        'attachment; filename="the-edit-articles.csv"',
      )
      .send(csvExport(visibleArticles(req.workspace)));
  });
  app.get("/image.php", (req, res, next) => {
    try {
      if (!req.user) throw new Problem("Image not found.", 404);
      const image = req.workspace.images.find((i) => i.id === req.query.id);
      if (!image) throw new Problem("Image not found.", 404);
      res
        .type(image.mime)
        .set("Content-Disposition", 'inline; filename="editorial-image.jpg"')
        .send(Buffer.from(image.data, "base64"));
    } catch (error) {
      next(error);
    }
  });
  app.get("/", (req, res, next) => {
    try {
      const page = typeof req.query.page === "string" ? req.query.page : "home";
      const protectedPages = [
        "desk",
        "edit",
        "pages",
        "page-edit",
        "import",
        "users",
        "user-edit",
      ];
      if (protectedPages.includes(page) && !req.user)
        return res.redirect(303, "/?page=login");
      if (["users", "user-edit"].includes(page)) mustAdmin(req.user);
      const data = {
        page,
        search:
          typeof req.query.search === "string"
            ? req.query.search.slice(0, 200)
            : "",
        sort: req.query.sort === "oldest" ? "oldest" : "newest",
        item: null,
        rows: [],
        notice: "",
      };
      const workspace = req.user ? req.workspace : null;
      const articles = visibleArticles(workspace, data.search, data.sort);
      data.articles = articles;
      if (page === "desk") {
        data.rows = articles;
        if (/^\d+$/.test(req.query.imported || ""))
          data.notice = "Stories imported successfully.";
      } else if (page === "article") {
        data.item = articles.find((a) => a.id === req.query.id);
        if (!data.item) throw new Problem("Story not found.", 404);
      } else if (page === "content") {
        data.item = [...seeds.pages, ...(workspace?.pages || [])].find(
          (p) => p.slug === req.query.slug,
        );
        if (!data.item) throw new Problem("Page not found.", 404);
      } else if (page === "edit") {
        if (req.query.copy) {
          const seed = seeds.articles.find((a) => a.id === req.query.copy);
          if (!seed) throw new Problem("Sample story not found.", 404);
          data.item = { ...seed, id: "", isSeed: false };
        } else if (req.query.id) {
          data.item = workspace.articles.find((a) => a.id === req.query.id);
          if (!data.item)
            throw new Problem(
              "Only your own stories can be edited. Copy a sample instead.",
              404,
            );
        }
      } else if (page === "pages")
        data.rows = [...seeds.pages, ...workspace.pages];
      else if (page === "page-edit" && req.query.id) {
        data.item = workspace.pages.find((a) => a.id === req.query.id);
        if (!data.item)
          throw new Problem("Only your own pages can be edited.", 404);
      } else if (page === "users") data.rows = workspace.users;
      else if (page === "user-edit" && req.query.id) {
        data.item = workspace.users.find((a) => a.id === req.query.id);
        if (!data.item) throw new Problem("Person not found.", 404);
      } else if (
        ![
          "home",
          "desk",
          "login",
          "start",
          "widget",
          "edit",
          "pages",
          "page-edit",
          "users",
          "user-edit",
          "import",
        ].includes(page)
      )
        throw new Problem("Page not found.", 404);
      res.render("index", data);
    } catch (error) {
      next(error);
    }
  });
  app.use((req, res, next) => next(new Problem("Not found.", 404)));
  app.use((error, req, res, next) => {
    const status =
      error instanceof Problem
        ? error.status
        : error instanceof multer.MulterError ||
            error.type === "entity.too.large"
          ? 413
          : 503;
    const message =
      error instanceof Problem
        ? error.message
        : status === 413
          ? "This upload or form is too large. Use one image under 2 MB or a CSV under 1 MB."
          : "The demo is temporarily unavailable. Please try again.";
    res.status(status);
    if (req.path === "/api.php") return res.json({ error: message });
    if (!res.locals.csrf) return res.type("text").send(message);
    res.render("index", {
      page: "error",
      error: message,
      form: {},
      item: null,
      rows: [],
    });
  });
  return app;
}
module.exports = { createApp, SESSION_MS };
