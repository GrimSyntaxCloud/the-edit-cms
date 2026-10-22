<?php
require dirname(__DIR__).'/app/bootstrap.php';
$file=(string)($_GET['file']??'');if(!preg_match('/^[a-f0-9]{32}\.(png|jpg)$/',$file)){http_response_code(404);exit;}
$path=dirname(__DIR__).'/storage/images/'.$file;if(!is_file($path)){http_response_code(404);exit;}
header('X-Content-Type-Options: nosniff');header("Content-Security-Policy: default-src 'none'");header('Content-Type: '.(str_ends_with($file,'.png')?'image/png':'image/jpeg'));header('Cache-Control: public, max-age=86400');readfile($path);
