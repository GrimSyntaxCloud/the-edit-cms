import urllib.request,urllib.parse,http.cookiejar,re,json,uuid,base64
BASE='http://127.0.0.1:4342'
j=http.cookiejar.CookieJar();o=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(j))
def request(path,values=None,files=None):
 headers={};body=None
 if files:
  boundary='----Test'+uuid.uuid4().hex;parts=[]
  for k,v in values.items():parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
  for key,name,content,typ in files:parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"; filename="{name}"\r\nContent-Type: {typ}\r\n\r\n'.encode()+content+b'\r\n')
  body=b''.join(parts)+f'--{boundary}--\r\n'.encode();headers['Content-Type']='multipart/form-data; boundary='+boundary
 elif values is not None:body=urllib.parse.urlencode(values).encode()
 try:
  r=o.open(urllib.request.Request(BASE+path,body,headers));return r.status,r.read().decode(errors='replace')
 except urllib.error.HTTPError as e:return e.code,e.read().decode(errors='replace')
def token(html):return re.search(r'name="csrf" value="([a-f0-9]+)"',html)[1]
assert request('/')[0]==200
assert request('/api.php?type=users')[0]==403
assert 'Good stories' in request('/?page=desk')[1]
_,html=request('/?page=login');csrf=token(html)
assert request('/?page=login',dict(csrf='bad',action='login'))[0]==403
assert request('/?page=login',dict(csrf=csrf,action='login',name='editor',password='bad'))[0]==422
status,html=request('/?page=login',dict(csrf=csrf,action='login',name='editor',password='LocalNewsroomDemo2026!'));assert status==200 and 'Editorial' in html;csrf=token(html)
article=dict(csrf=csrf,action='article',title="A test <script>alert(1)</script>",content='A fictional test story.',author='Demo Writer',date='2026-10-21')
assert request('/?page=edit',{**article,'date':'2026-02-30'})[0]==422
status,html=request('/?page=edit',article);assert status==200 and '&lt;script&gt;' in html and '<script>alert' not in html
newid=re.search(r'page=edit&id=(\d+)',html)[1]
assert request('/?page=edit',{**article,'id':newid,'title':'Updated test story'})[0]==200
assert 'Updated test story' in request('/?page=desk&search=Updated')[1]
assert 'No stories match' in request('/?page=desk&search=nonexistent-zxy')[1]
# Invalid uploads cannot be stored as executable files.
status,html=request('/?page=edit',article,[('image','bad.php',b'<?php echo "bad";','image/png')]);assert status==422
png=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jwioAAAAASUVORK5CYII=')
status,html=request('/?page=edit',{**article,'title':'Image test'},[('image','tiny.png',png,'image/png')]);assert status==200, (status,html[:1000]);image=re.search(r'/image.php\?file=([a-f0-9]+\.png)',html)[1]
assert request('/image.php?file='+image)[0]==200
assert request('/image.php?file=../setup.php')[0]==404
page=dict(csrf=csrf,action='page',title='Test page',heading='Test heading',keywords='demo,test',slug='test-page-'+uuid.uuid4().hex[:6],content='A sample page.')
assert request('/?page=page-edit',{**page,'slug':'../../bad'})[0]==422
assert request('/?page=page-edit',page)[0]==200
assert 'Test heading' in request('/?page=content&slug='+page['slug'])[1]
assert request('/?page=page-edit',page)[0]==422
csv=b'title,content,author,date\nImported story,Demo content,Demo Author,2026-10-21\n'
status,html=request('/?page=import',dict(csrf=csrf,action='import'),[('csv','stories.csv',csv,'text/csv')]);assert status==200 and '1 articles imported.' in html,(status,html[:1000])
assert request('/?page=import',dict(csrf=csrf,action='import'),[('csv','bad.csv',b'bad,columns\n1,2','text/csv')])[0]==422
count=len(json.loads(request('/api.php?type=articles')[1]))
invalid=b'title,content,author,date\nShould not insert,Content,Author,2026-10-21\nInvalid,Content,Author,2026-02-30\n'
assert request('/?page=import',dict(csrf=csrf,action='import'),[('csv','invalid.csv',invalid,'text/csv')])[0]==422
assert len(json.loads(request('/api.php?type=articles')[1]))==count
assert 'Imported story' in request('/export.php')[1]
assert 'password' not in request('/api.php?type=users')[1]
assert 'password' not in request('/api.php?type=users&id=1')[1]
username='writer'+uuid.uuid4().hex[:6]
assert request('/?page=user-edit',dict(csrf=csrf,action='user',name=username,password='LocalWriterDemo2026!',role='editor'))[0]==200
assert request('/?page=user-edit',dict(csrf=csrf,action='user',id=1,name='editor',password='',role='editor'))[0]==422
request('/',dict(csrf=csrf,action='logout'))
_,html=request('/?page=login');csrf=token(html)
status,html=request('/?page=login',dict(csrf=csrf,action='login',name=username,password='LocalWriterDemo2026!'));assert status==200
assert request('/?page=users')[0]==403 and request('/api.php?type=users')[0]==403
assert request('/?page=edit')[0]==200
csrf=token(html);request('/',dict(csrf=csrf,action='logout'))
assert request('/api.php?type=articles&id=999999')[0]==404
assert request('/api.php?type=articles',dict(dummy='x'))[0]==405
assert request('/storage/newsroom.sqlite')[0]==404
print('PASS: authentication; CSRF; article create/edit/search; date validation; escaping; valid/rejected uploads; safe image serving; CMS page/slug; CSV import/export and atomic rejection; password exclusion; user creation; role authorization; self-demotion protection; logout; API statuses; storage isolation')
