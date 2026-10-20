# Social API — Modular Monolith Backend

Production-grade social media backend (Facebook-like) — Python 3.12 + FastAPI.

**Milestone 0:** Hello-world FastAPI with full infrastructure wired:
structured logging, PII redaction, request IDs, consistent error shape,
i18n (en/bn), health probes, Prometheus metrics endpoint, Docker stack
(MySQL, Redis, Jaeger, Prometheus, Grafana), Alembic stub, CI stub,
API contract export (`contracts/`).

## Quickstart

```powershell
py -3.12 -m venv venv
.\venv\Scripts\Activate.ps1
pip install -e ".[dev]"

copy .env.example .env
# Generate ENCRYPTION_KEY and JWT keys — see M0 chat notes

.\scripts\dev-up.ps1          # start docker services
uvicorn social_api.main:app --reload

# Visit:
#   http://localhost:8000/docs
#   http://localhost:8000/health
#   http://localhost:8000/health/ready
#   http://localhost:8000/metrics

python scripts/export_api_contract.py   # regenerate contracts/
