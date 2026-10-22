"""Users schema validation."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from social_api.modules.users.schemas import ProfileUpdate

pytestmark = pytest.mark.unit


def test_update_requires_version() -> None:
    with pytest.raises(ValidationError):
        ProfileUpdate.model_validate({})


def test_update_version_must_be_ge_1() -> None:
    with pytest.raises(ValidationError):
        ProfileUpdate.model_validate({"version": 0})


def test_update_rejects_unknown_field() -> None:
    with pytest.raises(ValidationError):
        ProfileUpdate.model_validate({"version": 1, "hacker_field": "x"})


def test_update_dob_iso() -> None:
    u = ProfileUpdate.model_validate({"version": 1, "dob": "1990-05-15"})
    assert u.dob == "1990-05-15"


def test_update_dob_invalid() -> None:
    with pytest.raises(ValidationError):
        ProfileUpdate.model_validate({"version": 1, "dob": "not-a-date"})


def test_public_profile_has_no_pii_fields() -> None:
    from social_api.modules.users.schemas import ProfilePublic

    fields = set(ProfilePublic.model_fields.keys())
    for forbidden in ("dob", "phone", "address", "version"):
        assert forbidden not in fields
