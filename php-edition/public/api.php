<?php
require dirname(__DIR__).'/app/bootstrap.php';initWeb();header('Content-Type: application/json; charset=utf-8');
if($_SERVER['REQUEST_METHOD']!=='GET'){http_response_code(405);header('Allow: GET');echo json_encode(['error'=>'Read-only API.']);exit;}
$type=$_GET['type']??'articles';$id=filter_var($_GET['id']??null,FILTER_VALIDATE_INT);
if($type==='users'){
 if(!user()||user()['role']!=='admin'){http_response_code(403);echo json_encode(['error'=>'Administrator access required.']);exit;}
 $sql='SELECT id,name,role,image FROM users';
}else if($type==='articles')$sql='SELECT id,title,content,author,date,image FROM articles';else{http_response_code(400);echo json_encode(['error'=>'Unknown resource.']);exit;}
if($id){$result=q($sql.' WHERE id=?',[$id])->fetch();if(!$result){http_response_code(404);$result=['error'=>'Not found.'];}}
else{$result=q($sql.' ORDER BY id DESC')->fetchAll();}
echo json_encode($result,JSON_UNESCAPED_SLASHES|JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR);
