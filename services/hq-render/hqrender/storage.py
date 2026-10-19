"""Where rendered files live. The app only ever sees `<public base>/v1/scores/<sha256>/<file>`,
so moving between backends is a configuration change.

    HQ_STORAGE=local  HQ_STORAGE_DIR=/var/lib/hq/files     (served by server.py)
    HQ_STORAGE=s3     HQ_S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com
                      HQ_S3_BUCKET=... HQ_S3_KEY_ID=... HQ_S3_SECRET=...
                      (Cloudflare R2, AWS S3, Backblaze B2, MinIO: any S3-compatible store)
"""
import os, shutil

PREFIX = 'v1/scores'
TYPES = {'.json': 'application/json', '.m4a': 'audio/mp4'}


class LocalStorage:
    def __init__(self, root):
        self.root = root; os.makedirs(root, exist_ok=True)

    def path(self, sha, name):
        return os.path.join(self.root, PREFIX, sha, name)

    def has(self, sha):
        return os.path.exists(self.path(sha, 'manifest.json'))

    def publish(self, sha, src_dir):
        """Copy a finished render; the manifest goes last so a reader never sees a partial set."""
        dst = os.path.join(self.root, PREFIX, sha); tmp = dst + '.partial'
        shutil.rmtree(tmp, ignore_errors=True); shutil.copytree(src_dir, tmp)
        shutil.rmtree(dst, ignore_errors=True); os.rename(tmp, dst)

    def used_bytes(self):
        return sum(os.path.getsize(os.path.join(d, f)) for d, _, fs in os.walk(self.root) for f in fs)


class S3Storage:
    def __init__(self, endpoint, bucket, key_id, secret):
        import boto3  # only needed for this backend
        self.bucket = bucket
        self.s3 = boto3.client('s3', endpoint_url=endpoint, aws_access_key_id=key_id, aws_secret_access_key=secret, region_name='auto')

    def has(self, sha):
        try: self.s3.head_object(Bucket=self.bucket, Key=f'{PREFIX}/{sha}/manifest.json'); return True
        except self.s3.exceptions.ClientError: return False

    def publish(self, sha, src_dir):
        names = sorted(os.listdir(src_dir), key=lambda n: n == 'manifest.json')  # manifest last
        for n in names:
            self.s3.upload_file(os.path.join(src_dir, n), self.bucket, f'{PREFIX}/{sha}/{n}', ExtraArgs={
                'ContentType': TYPES.get(os.path.splitext(n)[1], 'application/octet-stream'),
                # renders are immutable per score hash and chain; the manifest may be replaced by a newer chain
                'CacheControl': 'public, max-age=300' if n == 'manifest.json' else 'public, max-age=31536000, immutable'})

    def used_bytes(self):
        total = 0
        for page in self.s3.get_paginator('list_objects_v2').paginate(Bucket=self.bucket, Prefix=PREFIX):
            total += sum(o['Size'] for o in page.get('Contents', []))
        return total


def from_env():
    kind = os.environ.get('HQ_STORAGE', 'local')
    if kind == 'local': return LocalStorage(os.environ.get('HQ_STORAGE_DIR', os.path.expanduser('~/tabrender/files')))
    if kind == 's3':
        e = os.environ
        return S3Storage(e['HQ_S3_ENDPOINT'], e['HQ_S3_BUCKET'], e['HQ_S3_KEY_ID'], e['HQ_S3_SECRET'])
    raise ValueError(f'unknown HQ_STORAGE {kind!r}')
