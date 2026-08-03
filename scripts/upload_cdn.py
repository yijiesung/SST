#!/usr/bin/env python3
"""Compress and upload task assets to an S3-compatible CDN (AWS S3/R2/MinIO).

Required environment variables:
  CDN_ENDPOINT, CDN_BUCKET, CDN_ACCESS_KEY_ID, CDN_SECRET_ACCESS_KEY,
  CDN_PUBLIC_BASE_URL
Optional:
  CDN_REGION (default: auto), CDN_PREFIX (default: sst-assets)
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import hmac
import json
import math
import mimetypes
import os
from pathlib import Path
import re
import struct
import subprocess
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import wave

DEFAULT_GAME = Path('/Users/songyijie/Documents/创业/陆静-游戏成瘾训练/游戏图片')
DEFAULT_NEUTRAL = Path('/Users/songyijie/Documents/创业/陆静-游戏成瘾训练/中性图片')


def natural_key(path: Path):
    return [int(part) if part.isdigit() else part.lower() for part in re.split(r'(\d+)', path.name)]


def files_in(folder: Path):
    return sorted((p for p in folder.iterdir() if p.is_file() and p.name != '.DS_Store'), key=natural_key)


def sign(key: bytes, message: str) -> bytes:
    return hmac.new(key, message.encode('utf-8'), hashlib.sha256).digest()


class S3Client:
    def __init__(self):
        self.endpoint = os.environ['CDN_ENDPOINT'].rstrip('/')
        self.bucket = os.environ['CDN_BUCKET']
        self.access_key = os.environ['CDN_ACCESS_KEY_ID']
        self.secret_key = os.environ['CDN_SECRET_ACCESS_KEY']
        self.region = os.getenv('CDN_REGION', 'auto')
        self.host = urllib.parse.urlparse(self.endpoint).netloc

    def put(self, key: str, data: bytes, content_type: str):
        now = dt.datetime.now(dt.timezone.utc)
        amz_date = now.strftime('%Y%m%dT%H%M%SZ')
        date_stamp = now.strftime('%Y%m%d')
        payload_hash = hashlib.sha256(data).hexdigest()
        encoded_key = '/'.join(urllib.parse.quote(part, safe='-_.~') for part in key.split('/'))
        canonical_uri = f'/{urllib.parse.quote(self.bucket, safe="-_.~")}/{encoded_key}'
        canonical_headers = (
            f'content-type:{content_type}\n'
            f'host:{self.host}\n'
            f'x-amz-content-sha256:{payload_hash}\n'
            f'x-amz-date:{amz_date}\n'
        )
        signed_headers = 'content-type;host;x-amz-content-sha256;x-amz-date'
        canonical_request = '\n'.join(['PUT', canonical_uri, '', canonical_headers, signed_headers, payload_hash])
        algorithm = 'AWS4-HMAC-SHA256'
        scope = f'{date_stamp}/{self.region}/s3/aws4_request'
        string_to_sign = '\n'.join([
            algorithm,
            amz_date,
            scope,
            hashlib.sha256(canonical_request.encode('utf-8')).hexdigest(),
        ])
        k_date = sign(('AWS4' + self.secret_key).encode('utf-8'), date_stamp)
        k_region = sign(k_date, self.region)
        k_service = sign(k_region, 's3')
        k_signing = sign(k_service, 'aws4_request')
        signature = hmac.new(k_signing, string_to_sign.encode('utf-8'), hashlib.sha256).hexdigest()
        authorization = f'{algorithm} Credential={self.access_key}/{scope}, SignedHeaders={signed_headers}, Signature={signature}'
        request = urllib.request.Request(
            f'{self.endpoint}{canonical_uri}',
            data=data,
            method='PUT',
            headers={
                'Authorization': authorization,
                'Content-Type': content_type,
                'Host': self.host,
                'X-Amz-Content-Sha256': payload_hash,
                'X-Amz-Date': amz_date,
                'Cache-Control': 'public, max-age=31536000, immutable',
            },
        )
        with urllib.request.urlopen(request, timeout=120) as response:
            if response.status not in (200, 201, 204):
                raise RuntimeError(f'upload failed: HTTP {response.status}')


def compress_image(source: Path, output: Path) -> tuple[bytes, str]:
    try:
        subprocess.run(
            ['sips', '-Z', '1600', '-s', 'format', 'jpeg', '-s', 'formatOptions', '78', str(source), '--out', str(output)],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )
        return output.read_bytes(), 'image/jpeg'
    except (FileNotFoundError, subprocess.CalledProcessError):
        content_type = mimetypes.guess_type(source.name)[0] or 'application/octet-stream'
        return source.read_bytes(), content_type


def beep_wav(path: Path):
    sample_rate = 44100
    duration = 0.08
    frames = int(sample_rate * duration)
    with wave.open(str(path), 'wb') as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(sample_rate)
        for index in range(frames):
            t = index / sample_rate
            envelope = min(1.0, index / 160) * min(1.0, (frames - index) / 300)
            value = int(0.42 * envelope * 32767 * math.sin(2 * math.pi * 880 * t))
            audio.writeframesraw(struct.pack('<h', value))


def configure_base_url(public_base: str):
    for relative in [
        'miniprogram/packages/sst/common/cdn.js',
        'miniprogram/packages/attention/common/cdn.js',
    ]:
        path = Path(relative)
        text = path.read_text(encoding='utf-8')
        text = re.sub(r"const CDN_BASE_URL = '[^']+'", f"const CDN_BASE_URL = '{public_base}'", text)
        path.write_text(text, encoding='utf-8')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--game-dir', type=Path, default=DEFAULT_GAME)
    parser.add_argument('--neutral-dir', type=Path, default=DEFAULT_NEUTRAL)
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    game_files = files_in(args.game_dir)
    neutral_files = files_in(args.neutral_dir)
    prefix = os.getenv('CDN_PREFIX', 'sst-assets').strip('/')
    public_root = os.getenv('CDN_PUBLIC_BASE_URL', '').rstrip('/')
    if args.dry_run:
        print(json.dumps({'game': len(game_files), 'neutral': len(neutral_files), 'prefix': prefix}, ensure_ascii=False, indent=2))
        return
    required = ['CDN_ENDPOINT', 'CDN_BUCKET', 'CDN_ACCESS_KEY_ID', 'CDN_SECRET_ACCESS_KEY', 'CDN_PUBLIC_BASE_URL']
    missing = [name for name in required if not os.getenv(name)]
    if missing:
        raise SystemExit(f'Missing environment variables: {", ".join(missing)}')
    client = S3Client()
    manifest = {'game': [], 'neutral': [], 'audio': None}
    with tempfile.TemporaryDirectory(prefix='sst-cdn-') as tmp:
        tmp_dir = Path(tmp)
        for kind, sources in [('game', game_files), ('neutral', neutral_files)]:
            for index, source in enumerate(sources, 1):
                key = f'{prefix}/{kind}/{index:04d}'
                data, content_type = compress_image(source, tmp_dir / f'{kind}-{index:04d}.jpg')
                client.put(key, data, content_type)
                manifest[kind].append({'index': index - 1, 'source': source.name, 'url': f'{public_root}/{prefix}/{kind}/{index:04d}'})
                print(f'[{kind}] {index}/{len(sources)} {source.name}')
        beep = tmp_dir / 'stop-beep.wav'
        beep_wav(beep)
        audio_key = f'{prefix}/audio/stop-beep.wav'
        client.put(audio_key, beep.read_bytes(), 'audio/wav')
        manifest['audio'] = f'{public_root}/{audio_key}'
    output = Path('cdn-dist')
    output.mkdir(exist_ok=True)
    (output / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    configure_base_url(f'{public_root}/{prefix}')
    print('Upload complete. CDN configuration updated in both task subpackages.')


if __name__ == '__main__':
    try:
        main()
    except urllib.error.HTTPError as error:
        body = error.read().decode('utf-8', errors='replace')
        raise SystemExit(f'CDN upload failed: HTTP {error.code}\n{body}') from error

