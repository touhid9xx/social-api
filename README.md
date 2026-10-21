# Social API — Modular Monolith Backend

[![CI](https://github.com/touhid9xx/social-api/actions/workflows/ci.yml/badge.svg)](https://github.com/<YOUR_GH_USER>/<YOUR_REPO>/actions/workflows/ci.yml)
![Python 3.12](https://img.shields.io/badge/python-3.12-blue)
![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688)
![Coverage](https://img.shields.io/badge/coverage-%E2%89%A585%25-brightgreen)
![License](https://img.shields.io/badge/license-MIT-lightgrey)

Production-grade social media backend (Facebook-like) — Python 3.12 + FastAPI,
modular monolith, backend-only.

**Status:** M2 — CI hardened, contract drift enforced end-to-end.

## Quickstart

```powershell
py -3.12 -m venv venv
.\venv\Scripts\Activate.ps1
pip install -e ".[dev]"

copy .env.example .env
# Generate ENCRYPTION_KEY and JWT keys — see docs/setup.md (added M26)

.\scripts\dev-up.ps1                     # docker services
uvicorn social_api.main:app --reload     # API on :8000

python scripts/export_api_contract.py    # regenerate contracts/
.\scripts\check_all.ps1                  # mirror CI locally
