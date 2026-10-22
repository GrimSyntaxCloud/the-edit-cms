const { randomUUID } = require("node:crypto");
const { parse } = require("csv-parse/sync");
const sharp = require("sharp");
const RETENTION_MS = 96 * 60 * 60 * 1000;
const MAX_DOCUMENT_BYTES = 900 * 1024;
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_BYTES = 150 * 1024;
class Problem extends Error {
  constructor(message, status = 422) {
    super(message);
    this.status = status;
  }
}
const seeds = {
  articles: [
    {
      id: "seed-1",
      title: "Small spaces. Bigger possibilities.",
      content:
        "A neighborhood reading room shows how thoughtful design can turn an overlooked corner into a place to gather.\n\nThis fictional story is sample content for the restored newsroom. Create your own workspace to write a new story, or copy this sample to explore the publishing workflow.",
      author: "Alex Morgan",
      date: "2026-10-21",
      isSeed: true,
    },
    {
      id: "seed-2",
      title: "The art of slowing down",
      content:
        "The most useful ideas often arrive when we make room for them. A fictional essay about daily rituals, shared places and paying closer attention.",
      author: "Taylor Reed",
      date: "2026-10-20",
      isSeed: true,
    },
    {
      id: "seed-3",
      title: "Built to be shared",
      content:
        "A look at tools that make collaboration a little more human. This sample article demonstrates the reusable news widget and article detail view.",
      author: "Casey Lane",
      date: "2026-10-19",
      isSeed: true,
    },
  ],
  pages: [
    {
      id: "seed-about",
      title: "About The Edit",
      keywords: "community,design,stories",
      heading: "A home for considered stories.",
      content:
        "The Edit is a fictional publication built to showcase restored content management coursework. All sample stories and people are fictional. Try an isolated editorial workspace to create stories, pages and staff profiles. Your demo data is automatically removed after 96 hours; these sample stories stay.",
      slug: "about",
      isSeed: true,
    },
  ],
};
function text(value, max, label) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max)
    throw new Problem(
      `${label} is required and must be at most ${max} characters.`,
    );
  return value.trim();
}
function articleData(body) {
  const data = {
    title: text(body.title, 200, "Headline"),
    content: text(body.content, 20000, "Story"),
    author: text(body.author, 100, "Byline"),
    date: text(body.date, 10, "Publication date"),
  };
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(data.date) ||
    Number.isNaN(+new Date(data.date + "T00:00:00Z")) ||
    new Date(data.date + "T00:00:00Z").toISOString().slice(0, 10) !== data.date
  )
    throw new Problem("Choose a valid calendar date.");
  return data;
}
function pageData(body) {
  const data = {
    title: text(body.title, 200, "Page title"),
    keywords: text(body.keywords, 300, "Keywords"),
    heading: text(body.heading, 200, "Heading"),
    content: text(body.content, 20000, "Page content"),
    slug: text(body.slug, 100, "URL key"),
  };
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(data.slug))
    throw new Problem(
      "Use lowercase words separated by hyphens for the URL key.",
    );
  if (data.slug === "about")
    throw new Problem(
      "The sample About URL is reserved; choose a different key.",
    );
  return data;
}
function userData(body, isNew) {
  const name = text(body.name, 60, "Username");
  if (!/^[A-Za-z0-9._-]{3,60}$/.test(name))
    throw new Problem(
      "Use a 3–60 character username with letters, numbers, dots, underscores or hyphens.",
    );
  if (!["admin", "editor"].includes(body.role))
    throw new Problem("Choose a valid role.");
  const password = typeof body.password === "string" ? body.password : "";
  if (
    (isNew || password) &&
    (password.length < 12 || Buffer.byteLength(password) > 256)
  )
    throw new Problem("Passwords need 12–256 characters (up to 256 bytes).");
  return { name, role: body.role, password };
}
function parseCsv(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length > 1024 * 1024)
    throw new Problem("Choose a CSV under 1 MB.");
  let rows;
  try {
    rows = parse(buffer, {
      bom: true,
      skip_empty_lines: true,
      max_record_size: 25000,
    });
  } catch {
    throw new Problem("The CSV is malformed or contains an oversized record.");
  }
  if (
    JSON.stringify(rows.shift()) !==
    JSON.stringify(["title", "content", "author", "date"])
  )
    throw new Problem(
      "CSV columns must be title, content, author, date in that order.",
    );
  if (!rows.length || rows.length > 30)
    throw new Problem("Import between 1 and 30 complete stories.");
  return rows.map((row) => {
    if (row.length !== 4)
      throw new Problem("Each CSV row must contain four fields.");
    return articleData(
      Object.fromEntries(
        ["title", "content", "author", "date"].map((key, i) => [key, row[i]]),
      ),
    );
  });
}
function csvExport(articles) {
  const safe = (value) => {
    let text = String(value ?? "");
    if (/^(?:\s*[=+@-]|[\t\r])/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  };
  return (
    [
      "title,content,author,date",
      ...articles.map((a) =>
        ["title", "content", "author", "date"].map((k) => safe(a[k])).join(","),
      ),
    ].join("\r\n") + "\r\n"
  );
}
async function imageData(file) {
  if (!file) return null;
  if (file.buffer.length > MAX_UPLOAD_BYTES)
    throw new Problem("Choose an image under 2 MB.");
  try {
    const input = sharp(file.buffer, {
      limitInputPixels: 16_000_000,
      failOn: "warning",
    });
    const meta = await input.metadata();
    if (
      !["jpeg", "png"].includes(meta.format) ||
      !meta.width ||
      !meta.height ||
      meta.width > 4000 ||
      meta.height > 4000
    )
      throw new Problem("Use a valid JPEG or PNG up to 4000×4000 pixels.");
    let buffer;
    for (const size of [1200, 900, 600]) {
      buffer = await sharp(file.buffer, {
        limitInputPixels: 16_000_000,
        failOn: "warning",
      })
        .rotate()
        .resize({
          width: size,
          height: size,
          fit: "inside",
          withoutEnlargement: true,
        })
        .flatten({ background: "#f1efe9" })
        .jpeg({ quality: 75, mozjpeg: true })
        .toBuffer();
      if (buffer.length <= MAX_IMAGE_BYTES) break;
    }
    if (buffer.length > MAX_IMAGE_BYTES)
      throw new Problem(
        "This image is too complex for the free demo. Choose a smaller image.",
      );
    return {
      id: randomUUID(),
      mime: "image/jpeg",
      data: buffer.toString("base64"),
      bytes: buffer.length,
    };
  } catch (error) {
    if (error instanceof Problem) throw error;
    throw new Problem("Use a valid JPEG or PNG up to 4000×4000 pixels.");
  }
}
function active(doc, now) {
  return (
    doc &&
    doc.kind === "workspace" &&
    doc.isSeed === false &&
    +new Date(doc.expiresAt) > +now
  );
}
function checkBudget(doc) {
  if (
    doc.articles.length > 30 ||
    doc.pages.length > 10 ||
    doc.users.length > 5 ||
    doc.images.length > 3
  )
    throw new Problem(
      "Demo limit reached: 30 stories, 10 pages, 5 people and 3 images per workspace.",
    );
  if (Buffer.byteLength(JSON.stringify(doc)) > MAX_DOCUMENT_BYTES)
    throw new Problem(
      "This workspace has reached its free demo storage limit. Use shorter text or smaller images.",
    );
}
function attachImage(doc, record, image) {
  if (!image) return;
  const oldId = record.image;
  doc.images.push(image);
  record.image = image.id;
  if (
    oldId &&
    !doc.articles
      .concat(doc.pages, doc.users)
      .some((r) => r !== record && r.image === oldId)
  )
    doc.images = doc.images.filter((i) => i.id !== oldId);
}
function visibleArticles(workspace, query = "", sort = "newest") {
  const q = query.trim().toLocaleLowerCase();
  return [...seeds.articles, ...(workspace?.articles || [])]
    .filter((a) => (a.title + " " + a.author).toLocaleLowerCase().includes(q))
    .sort((a, b) => {
      const d = a.date.localeCompare(b.date) || a.id.localeCompare(b.id);
      return sort === "oldest" ? d : -d;
    });
}
module.exports = {
  Problem,
  seeds,
  RETENTION_MS,
  MAX_DOCUMENT_BYTES,
  MAX_UPLOAD_BYTES,
  articleData,
  pageData,
  userData,
  parseCsv,
  csvExport,
  imageData,
  active,
  checkBudget,
  attachImage,
  visibleArticles,
};
