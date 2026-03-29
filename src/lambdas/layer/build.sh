#!/bin/bash
set -euo pipefail

# Lambda Layer のビルドスクリプト
# python/ ディレクトリに依存パッケージをインストールし、zip を作成する

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

rm -rf python/
pip install -r requirements.txt -t python/ --platform manylinux2014_aarch64 --only-binary=:all: --python-version 3.12
zip -r layer.zip python/
echo "Layer built: ${SCRIPT_DIR}/layer.zip"
