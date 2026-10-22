<?php
declare(strict_types=1);if(PHP_SAPI!=='cli')exit;
$path=getenv('CMS_DB_PATH')?:__DIR__.'/storage/newsroom.sqlite';$password=getenv('CMS_ADMIN_PASSWORD');
if(!$password||strlen($password)<12)exit("Set CMS_ADMIN_PASSWORD with at least 12 characters.\n");if(is_file($path))exit("Database exists; refusing to overwrite.\n");
$db=new PDO('sqlite:'.$path);$db->setAttribute(PDO::ATTR_ERRMODE,PDO::ERRMODE_EXCEPTION);
$db->exec("CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('admin','editor')),image TEXT);
CREATE TABLE articles(id INTEGER PRIMARY KEY,title TEXT NOT NULL,content TEXT NOT NULL,author TEXT NOT NULL,date TEXT NOT NULL,image TEXT,is_seed INTEGER NOT NULL DEFAULT 0);
CREATE TABLE pages(id INTEGER PRIMARY KEY,title TEXT NOT NULL,keywords TEXT NOT NULL,heading TEXT NOT NULL,content TEXT NOT NULL,slug TEXT NOT NULL UNIQUE,image TEXT,is_seed INTEGER NOT NULL DEFAULT 0);
CREATE TABLE attempts(ip_hash TEXT PRIMARY KEY,failures INTEGER NOT NULL,last_at INTEGER NOT NULL);");
$db->prepare('INSERT INTO users(name,password_hash,role) VALUES(?,?,?)')->execute(['editor',password_hash($password,PASSWORD_DEFAULT),'admin']);
$s=$db->prepare('INSERT INTO articles(title,content,author,date,is_seed) VALUES(?,?,?,?,1)');
$s->execute(['Small spaces. Bigger possibilities.','A neighborhood reading room shows how thoughtful design can turn an overlooked corner into a place to gather.\n\nThis fictional story is sample content for the restored PHP newsroom. Edit it, export it or use the JSON endpoint to explore the publishing workflow.','Alex Morgan','2026-10-21']);
$s->execute(['The art of slowing down','The most useful ideas often arrive when we make room for them. A fictional essay about daily rituals, shared places and paying closer attention.','Taylor Reed','2026-10-20']);
$s->execute(['Built to be shared','A look at tools that make collaboration a little more human. This sample article demonstrates the reusable news widget and article detail view.','Casey Lane','2026-10-19']);
$db->prepare('INSERT INTO pages(title,keywords,heading,content,slug,is_seed) VALUES(?,?,?,?,?,1)')->execute(['About The Edit','community,design,stories','A home for considered stories.','The Edit is a fictional publication built to showcase a restored PHP content management system. All stories and people are sample data.','about']);
chmod($path,0600);echo "Created fictional newsroom database.\n";
