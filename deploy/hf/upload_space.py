"""저장소 스냅샷 폴더를 Hugging Face Docker Space 로 올린다(Space 가 없으면 생성).
사용: HF_TOKEN=... python deploy/hf/upload_space.py <폴더> [계정/스페이스]
GitHub Actions(hf-space.yml)가 호출하지만, 로컬에서도 같은 방식으로 수동 배포할 수 있다.
"""
import os
import sys

from huggingface_hub import HfApi

folder = sys.argv[1]
repo = sys.argv[2] if len(sys.argv) > 2 else "chrismarspink/ledgermarker"
api = HfApi(token=os.environ["HF_TOKEN"])
api.create_repo(repo, repo_type="space", space_sdk="docker", exist_ok=True)
# delete_patterns="*": Space 를 저장소와 같은 내용으로 맞춘다(지운 파일도 반영).
api.upload_folder(folder_path=folder, repo_id=repo, repo_type="space",
                  commit_message="GitHub master 동기화", delete_patterns=["*"])
print("https://huggingface.co/spaces/" + repo)
