# ADR-004: PII encryption at rest via Fernet TypeDecorator

**Status:** Accepted

## Context

Users' PII — email, phone, date of birth, physical address — must be
protected. GDPR + general privacy best practice.

Threat model:
- **DB dump leak** (backup stolen, replica compromised) — must not
  reveal plaintext PII.
- **Insider access** (DBA can read the DB) — same.
- **Application bug** (logs accidentally printing PII) — must not
  leak.

Out of scope:
- **Full-disk encryption** (protects against hardware theft only —
  compromised credentials bypass it).

## Decision

Encrypt PII columns at the **application layer** using Fernet
(AES-128-CBC + HMAC-SHA256), via a SQLAlchemy `TypeDecorator`.

Implementation: `db/types.py::EncryptedString`.

```python
email: Mapped[str] = mapped_column(EncryptedString)
phone: Mapped[str | None] = mapped_column(EncryptedString)
# ...
