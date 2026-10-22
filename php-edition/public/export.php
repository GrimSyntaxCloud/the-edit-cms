<?php
require dirname(__DIR__).'/app/bootstrap.php';initWeb();requireEditor();header('Content-Type: text/csv; charset=utf-8');header('Content-Disposition: attachment; filename="the-edit-articles.csv"');
$f=fopen('php://output','w');fputcsv($f,['title','content','author','date'],',','"','');
foreach(q('SELECT title,content,author,date FROM articles ORDER BY id')->fetchAll() as $row){$safe=array_map(fn($v)=>preg_match('/^(?:\s*[=+@-]|[\t\r])/',$v)?"'".$v:$v,$row);fputcsv($f,$safe,',','"','');}fclose($f);
