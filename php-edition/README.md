# The Edit — restored PHP content management coursework

A fictional publication and editorial desk recovered from the final `advancedPHP/week12` project. A slate/red Swiss editorial layout, fine rules, oversized headlines, original CSS artwork and practical admin tables give it a different identity from the salon.

## Run locally

Requires PHP 8.3+ with PDO SQLite, sessions and image metadata support (`getimagesize`). Tested on PHP 8.5.10 via official WordPress `@php-wasm/cli` 3.1.60, isolated from system software.

```sh
export CMS_ADMIN_PASSWORD='choose-a-new-local-password'
php setup.php
mkdir -p storage/uploads
php -d display_errors=0 -d upload_tmp_dir="$PWD/storage/uploads" -S 127.0.0.1:4342 -t public
```

Username: `editor`. The password is the one supplied during setup (minimum 12 characters); it is hashed. Setup refuses to overwrite an existing database. `CMS_DB_PATH` optionally selects a database outside the web root. Serve **only `public/`**. PHP needs writable private `storage/` directories. All sample articles, pages and people are fictional.

## Retained and repaired workflows

- Article listing, title/byline search, newest/oldest sorting, view, creation and editing.
- Title, story, author and publication date fields; valid calendar dates required.
- CMS page listing, view by URL key, create/edit, keywords, heading and content.
- Staff login/logout; administrator/user profile creation and editing, editor/admin roles, optional profile image.
- Optional article and CMS page images. Only valid JPEG/PNG metadata accepted, maximum 2 MB and 4000×4000 pixels, random file names, storage outside the public directory and a controlled image response.
- Working CSV import/export. The old source had a placeholder import controller and misspelled/broken CSV methods; this edition completes that intended workflow. Import validates the whole batch before a transaction (up to 100 rows/1 MB); export protects formula-like strings for spreadsheet use. CSV columns: `title,content,author,date`.
- Reusable latest-article widget (`/?page=widget`).
- Read-only JSON endpoints: `/api.php?type=articles`, `&id=1`; administrators can access `type=users`, including individual records. Password hashes never appear in either user API response.

The original coursework had create/read/update screens, not a complete delete workflow; this edition does not invent destructive delete features.

## Security and modernization

SQLite replaces the legacy hardcoded MySQL connection; no old credentials or database rows were copied. Deprecated `FILTER_SANITIZE_STRING`, plaintext password comparison, arbitrary query identifier interpolation, password exposure on single-user JSON, and unvalidated uploads were replaced. Output is escaped as text; rich HTML is intentionally not accepted. Prepared queries, server validation, CSRF, hashed passwords, regenerated session IDs, login throttling, role checks, security headers and private storage are used. An administrator cannot demote their own account.

This is local review software, not a deployed production service. It has no automatic 96-hour cleanup, public signup, production backups, upload garbage collection, malware scanner or cloud persistence integration. Existing fictional seed rows are marked in the schema. A hosting decision must preserve a real PHP/database backend and add the agreed retention policy before public use. Do not replace it with localStorage and label it a live full-stack CMS.

## Tests

`tests/http_test.py` exercises authentication, CSRF, article create/edit/search/date validation, escaping, rejected and accepted image uploads, image path validation, CMS page/URL key validation, CSV success and atomic invalid-batch rejection, export, password exclusion from both JSON user routes, user creation/role authorization, self-demotion protection, logout, API error statuses and private storage isolation. Use a disposable database; the suite creates fictional test records and expects the review-only credentials.

Desktop/mobile publication and staff desk checked in the browser at 390px. Admin tables scroll inside their container without page overflow. Screenshots are saved in the parent `php/` directory.

## Provenance

Recovered from `GrimSyntaxCloud/advancedPHP`, `week12`, commit `508f7f4844f6fd1ffb60b6ad3da7051539a8b181`.

The original source/history remains in its repository. This is a modernized implementation of the coursework’s feature inventory with a new design and schema, not an untouched historical extraction. No old connection details, database exports or original user photos are included. Credits must continue to describe it as coursework restored with AI assistance.
