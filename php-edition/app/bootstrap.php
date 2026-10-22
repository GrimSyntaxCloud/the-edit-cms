<?php
declare(strict_types=1);
function e(mixed $v):string{return htmlspecialchars((string)$v,ENT_QUOTES|ENT_SUBSTITUTE,'UTF-8');}
function db():PDO{static $db;if($db)return $db;$path=getenv('CMS_DB_PATH')?:dirname(__DIR__).'/storage/newsroom.sqlite';if(!is_file($path))throw new RuntimeException('Run setup.php first.');$db=new PDO('sqlite:'.$path,null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);$db->exec('PRAGMA busy_timeout=5000');return $db;}
function q(string $sql,array $args=[]):PDOStatement{$s=db()->prepare($sql);$s->execute($args);return $s;}
function initWeb():void{header("Content-Security-Policy: default-src 'self'; style-src 'self'; img-src 'self' data:; form-action 'self'; frame-ancestors 'self'; base-uri 'self'");header('X-Content-Type-Options: nosniff');header('Referrer-Policy: no-referrer');header('Cache-Control: no-store');$path=dirname(__DIR__).'/storage/sessions';if(!is_dir($path))mkdir($path,0700,true);session_name('newsroom_session');session_save_path($path);session_set_cookie_params(['httponly'=>true,'samesite'=>'Lax','secure'=>(!empty($_SERVER['HTTPS'])&&$_SERVER['HTTPS']!=='off'),'path'=>'/']);ini_set('session.use_strict_mode','1');session_start();$_SESSION['csrf']??=bin2hex(random_bytes(32));}
function csrf():string{return '<input type="hidden" name="csrf" value="'.e($_SESSION['csrf']).'">';}
function user():array|false{return isset($_SESSION['user'])?q('SELECT id,name,role,image FROM users WHERE id=?',[$_SESSION['user']])->fetch():false;}
function requireEditor():void{if(!user()){header('Location: /?page=login',true,303);exit;}}
function requireAdmin():void{requireEditor();if(user()['role']!=='admin'){http_response_code(403);exit('Administrator access required.');}}
function redirect(string $url):never{header('Location: '.$url,true,303);exit;}
function articleData(array $p):array{$data=[];foreach(['title'=>200,'content'=>20000,'author'=>100,'date'=>10] as $key=>$max){$v=trim((string)($p[$key]??''));if(!$v||strlen($v)>$max)throw new DomainException('Complete the title, story, byline and date within the field limits.');$data[$key]=$v;}$d=DateTimeImmutable::createFromFormat('!Y-m-d',$data['date']);if(!$d||$d->format('Y-m-d')!==$data['date'])throw new DomainException('Choose a valid publication date.');return $data;}
function saveArticle(array $p):int{$data=articleData($p);$id=(int)($p['id']??0);if($id){if(!q('SELECT id FROM articles WHERE id=?',[$id])->fetch())throw new DomainException('Article not found.');q('UPDATE articles SET title=?,content=?,author=?,date=? WHERE id=?',[...array_values($data),$id]);}else{q('INSERT INTO articles(title,content,author,date) VALUES(?,?,?,?)',array_values($data));$id=(int)db()->lastInsertId();}return $id;}
function uploadImage(array $file):?string{
 if(($file['error']??UPLOAD_ERR_NO_FILE)===UPLOAD_ERR_NO_FILE)return null;
 if($file['error']!==UPLOAD_ERR_OK || $file['size']>2*1024*1024)throw new DomainException('Choose a JPEG or PNG image under 2 MB.');
 $info=@getimagesize($file['tmp_name']);if(!$info||!in_array($info['mime'],['image/jpeg','image/png'],true)||$info[0]>4000||$info[1]>4000)throw new DomainException('Use a valid JPEG or PNG, at most 4000 pixels on each side.');
 $dir=dirname(__DIR__).'/storage/images';if(!is_dir($dir))mkdir($dir,0700,true);
 $name=bin2hex(random_bytes(16)).($info['mime']==='image/png'?'.png':'.jpg');
 if(!move_uploaded_file($file['tmp_name'],$dir.'/'.$name))throw new RuntimeException('Image upload failed.');chmod($dir.'/'.$name,0600);return $name;
}
function importArticles(string $path):int{
 $f=fopen($path,'r');if(!$f)throw new DomainException('Unable to open CSV.');
 try{$header=fgetcsv($f,0,',','"','');if($header!==['title','content','author','date'])throw new DomainException('CSV columns must be title, content, author, date in that order.');
 $rows=[];while(($row=fgetcsv($f,0,',','"',''))!==false){if($row===[null])continue;if(count($row)!==4||count($rows)>=100)throw new DomainException('Use up to 100 complete article rows.');$rows[]=articleData(array_combine($header,$row));}
 db()->beginTransaction();try{foreach($rows as $row)saveArticle($row);db()->commit();}catch(Throwable $e){db()->rollBack();throw $e;}return count($rows);
 }finally{fclose($f);}
}
