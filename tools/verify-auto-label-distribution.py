from pathlib import Path
import base64,gzip,hashlib,io,json,re,tarfile,zipfile
root=Path(__file__).resolve().parents[1]
sha=lambda b:hashlib.sha256(b).hexdigest()
script=(root/'tools/xclip-auto-labels-mobile-deploy-20261018.sh').read_bytes()
text=script.decode();blob=base64.b64decode(text.split("<<'PAYLOAD'\n",1)[1].split('\nPAYLOAD',1)[0]);declared=re.search("printf '%s  %s\\\\n' '([a-f0-9]{64})'",text).group(1);assert sha(blob)==declared
assert 'H6KQokOwZZcvhnEQnY251' not in text
assert 'BASE=https://xcliprank.com "$NODE" "$STAGE/installer/verify-endpoints.cjs"' not in text
with tarfile.open(fileobj=io.BytesIO(gzip.decompress(blob)),mode='r:') as tf:
 members={m.name:tf.extractfile(m).read() for m in tf.getmembers() if m.isfile()}
 m=json.loads(members['manifest.json'])
 for n,v in m['files'].items():assert sha(members['payload/'+n])==v['after'];assert sha((root/'production/source'/n).read_bytes())==v['after']
 assert members['htaccess.cjs']==(root/'tools/public-labels-pages-v2/htaccess.cjs').read_bytes()
 assert all('label-auto-server' not in n and 'label-auto-service' not in n and 'api/label-auto/' not in n for n in m['files'])
 archive=root/'releases/20261018-auto-labels-mobile-v1/Xclip-全動画自動ラベルとスマホ個別ページ-v1-更新一式-20261018.zip'
 with zipfile.ZipFile(archive) as z:
  assert z.read('xclip-auto-labels-mobile-deploy-20261018.sh')==script
  manifest=json.loads(z.read('Xclip-SHA256-自動ラベルとスマホ個別ページ-20261018.json'))
  for n,h in manifest['files'].items():assert sha(z.read(n))==h
  local=json.loads(z.read('local/manifest.json'))
  for n,v in local['files'].items():assert sha(z.read('local/payload/'+n))==v['after'];assert sha((root/n).read_bytes())==v['after']
  assert not any('/.local-admin/' in n or n.endswith('.env.local') or n.endswith('.dump') for n in z.namelist())
print('AUTO_LABEL_DISTRIBUTION_OK; actual ZIP/tar/source SHA; Linux helper identical; no fixed old build ID or private runtime state; local inference code excluded from production')
