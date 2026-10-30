"""Change a user's role (RBAC) from the command line.

There is no HTTP endpoint that grants a role on purpose — a self-service
privilege escalation route would be the single worst thing to expose. Roles
are set out-of-band, exactly like the seed script and the e2e tests do it.

Usage:
    python scripts/promote_user.py tushar@tushar.com              # -> admin
    python scripts/promote_user.py tushar@tushar.com --role moderator
    python scripts/promote_user.py someone@example.com --role user

    # account does not exist yet — create it (verified, so no SMTP needed):
    python scripts/promote_user.py me@example.com --create
    python scripts/promote_user.py me@example.com --create --password 'S3cret!pass'

    # account exists but you do not know the password (e.g. after a reseed):
    python scripts/promote_user.py me@example.com --reset-password

Lookup is by ``email_hash`` (sha256 of the lowercased address), not by the
encrypted ``email`` column, so it needs no decryption and no PII in query logs.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from sqlalchemy import select  # noqa: E402

from social_api.core.password import hash_password  # noqa: E402
from social_api.core.security import hash_email  # noqa: E402
from social_api.db.session import get_sessionmaker  # noqa: E402
from social_api.modules.audit.service import AuditService  # noqa: E402
from social_api.modules.auth.models import User, UserRole  # noqa: E402
from social_api.modules.auth.repository import UserRepository  # noqa: E402

# Mirrors the demo seed script so every locally created account is reachable
# with one password. Only ever used by --create.
DEFAULT_PASSWORD = "DemoPass123!"


async def _create_user(email: str, password: str, role: UserRole) -> User:
    """Create a verified account with a profile and a REGISTER audit row.

    Mirrors ``AuthService.register`` minus the outbound verification email:
    the CLI operator has no inbox here, so ``is_verified`` is set directly.
    """
    from social_api.modules.users.service import UsersService

    sm = get_sessionmaker()
    async with sm() as session:
        repo = UserRepository(session)
        user = await repo.create(email=email, password_hash=hash_password(password))
        user.is_verified = True
        user.role = role

        # Eager profile, same as register() — /users/me must never 404.
        await UsersService(session).get_self_profile(user_id=user.id)
        await AuditService(session).write(
            actor_id=user.id,
            action="REGISTER",
            entity="user",
            entity_id=user.id,
            after={"role": role.value, "source": "promote_user.py"},
        )

        await session.commit()
        await session.refresh(user)
        return user


def _hash(email: str) -> str:
    # ``hash_email`` lives in core.security so the app and this script cannot
    # drift on normalisation (lowercase + strip).
    return hash_email(email)


async def set_role(
    email: str,
    role: UserRole,
    *,
    create: bool,
    password: str,
    reset_password: bool = False,
) -> int:
    """Set ``role`` on the account owning ``email``. Returns a process exit code."""
    email_hash = _hash(email)
    sm = get_sessionmaker()

    async with sm() as session:
        user = (
            await session.execute(select(User).where(User.email_hash == email_hash))
        ).scalar_one_or_none()

        if user is None:
            if not create:
                print(f"! no account for {email} (email_hash={email_hash})")
                print("  pass --create to register it first, then promote.")
                return 1

            user = await _create_user(email, password, role)
            print(f">> created {email} (user_id={user.id}) as {user.role.value}")
            print(f"   password: {password}  (change it after the first login)")
            return 0

        # Both flags are reported independently: a caller may only want the
        # password reset on an account whose role is already correct.
        changes: list[str] = []

        if reset_password:
            # hash_password() re-validates the policy, so a weak --password
            # fails here exactly as it would through the HTTP register path.
            user.password_hash = hash_password(password)
            changes.append("password reset")

        previous = user.role
        if previous != role:
            user.role = role
            changes.append(f"{previous.value} -> {role.value}")

        if not changes:
            print(f"= {email} (user_id={user.id}) is already {role.value}; nothing to do")
            return 0

        await session.commit()
        print(f">> {email} (user_id={user.id}): {', '.join(changes)}")
        if reset_password:
            print(f"   password: {password}  (change it after the first login)")
        return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Set a user's RBAC role.")
    parser.add_argument("email", help="Account email address.")
    parser.add_argument(
        "--role",
        choices=[r.value for r in UserRole],
        default=UserRole.ADMIN.value,
        help="Role to assign (default: admin).",
    )
    parser.add_argument(
        "--create",
        action="store_true",
        help="Register the account (verified) when it does not exist yet.",
    )
    parser.add_argument(
        "--password",
        default=DEFAULT_PASSWORD,
        help=f"Password for --create / --reset-password (default: {DEFAULT_PASSWORD}).",
    )
    parser.add_argument(
        "--reset-password",
        action="store_true",
        help=(
            "Also overwrite the password of an existing account with --password. "
            "Used after a database reseed, when the stored hash is unknown."
        ),
    )
    args = parser.parse_args(argv)
    return asyncio.run(
        set_role(
            args.email,
            UserRole(args.role),
            create=args.create,
            password=args.password,
            reset_password=args.reset_password,
        )
    )


if __name__ == "__main__":
    raise SystemExit(main())
