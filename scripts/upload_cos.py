#!/usr/bin/env python3
"""Compress and upload SST/attention assets to Tencent Cloud COS.

Required environment variables:
  COS_SECRET_ID, COS_SECRET_KEY, COS_BUCKET, COS_REGION,
  COS_PUBLIC_BASE_URL

Optional:
  COS_SESSION_TOKEN (temporary credential), COS_PREFIX (default: sst-assets)

COS_BUCKET must include the APPID suffix, for example: sst-assets-1250000000.
COS_PUBLIC_BASE_URL must be an anonymously readable HTTPS origin or CDN domain.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import tempfile

from upload_cdn import (
    DEFAULT_GAME,
    DEFAULT_NEUTRAL,
    beep_wav,
    compress_image,
    configure_base_url,
    files_in,
)


def required_environment(names):
    missing = [name for name in names if not os.getenv(name)]
    if missing:
        raise SystemExit(f'Missing environment variables: {", ".join(missing)}')


def create_client():
    try:
        from qcloud_cos import CosConfig, CosS3Client
    except ModuleNotFoundError as error:
        raise SystemExit(
            'Tencent COS SDK is not installed. Run: '
            'python3 -m pip install -r requirements-cos.txt'
        ) from error
    config = CosConfig(
        Region=os.environ['COS_REGION'],
        SecretId=os.environ['COS_SECRET_ID'],
        SecretKey=os.environ['COS_SECRET_KEY'],
        Token=os.getenv('COS_SESSION_TOKEN'),
        Scheme='https',
    )
    return CosS3Client(config)


def object_exists(client, bucket, key):
    try:
        client.head_object(Bucket=bucket, Key=key)
        return True
    except Exception as error:  # SDK exceptions expose the HTTP status via get_status_code.
        status = error.get_status_code() if hasattr(error, 'get_status_code') else None
        if status == 404:
            return False
        raise


def put(client, bucket, key, data, content_type, resume):
    if resume and object_exists(client, bucket, key):
        return 'skipped'
    client.put_object(
        Bucket=bucket,
        Key=key,
        Body=data,
        StorageClass='STANDARD',
        ContentType=content_type,
        CacheControl='public, max-age=31536000, immutable',
    )
    return 'uploaded'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--game-dir', type=Path, default=DEFAULT_GAME)
    parser.add_argument('--neutral-dir', type=Path, default=DEFAULT_NEUTRAL)
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--resume', action='store_true', help='skip objects already present in COS')
    args = parser.parse_args()

    game_files = files_in(args.game_dir)
    neutral_files = files_in(args.neutral_dir)
    prefix = os.getenv('COS_PREFIX', 'sst-assets').strip('/')
    public_root = os.getenv('COS_PUBLIC_BASE_URL', '').rstrip('/')
    summary = {
        'provider': 'tencent-cos',
        'game': len(game_files),
        'neutral': len(neutral_files),
        'prefix': prefix,
        'bucket': os.getenv('COS_BUCKET'),
        'region': os.getenv('COS_REGION'),
        'publicBaseUrl': public_root or None,
    }
    if args.dry_run:
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return

    required_environment([
        'COS_SECRET_ID',
        'COS_SECRET_KEY',
        'COS_BUCKET',
        'COS_REGION',
        'COS_PUBLIC_BASE_URL',
    ])
    bucket = os.environ['COS_BUCKET']
    client = create_client()
    manifest = {'provider': 'tencent-cos', 'game': [], 'neutral': [], 'audio': None}

    with tempfile.TemporaryDirectory(prefix='sst-cos-') as temp:
        temp_dir = Path(temp)
        for kind, sources in [('game', game_files), ('neutral', neutral_files)]:
            for index, source in enumerate(sources, 1):
                key = f'{prefix}/{kind}/{index:04d}'
                data, content_type = compress_image(source, temp_dir / f'{kind}-{index:04d}.jpg')
                action = put(client, bucket, key, data, content_type, args.resume)
                url = f'{public_root}/{key}'
                manifest[kind].append({'index': index - 1, 'source': source.name, 'url': url})
                print(f'[{kind}] {index}/{len(sources)} {action}: {source.name}')

        beep = temp_dir / 'stop-beep.wav'
        beep_wav(beep)
        audio_key = f'{prefix}/audio/stop-beep.wav'
        action = put(client, bucket, audio_key, beep.read_bytes(), 'audio/wav', args.resume)
        manifest['audio'] = f'{public_root}/{audio_key}'
        print(f'[audio] {action}: stop-beep.wav')

    output = Path('cdn-dist')
    output.mkdir(exist_ok=True)
    (output / 'manifest.json').write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding='utf-8',
    )
    configure_base_url(f'{public_root}/{prefix}')
    print('COS upload complete. CDN configuration updated in both task subpackages.')


if __name__ == '__main__':
    main()
