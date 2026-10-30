"""Guard the audit filter enums against drift from the write sites.

`GET /audit` and `GET /audit/me` only accept actions/entities that appear in
`AuditActionLiteral` / `AuditEntityLiteral` (modules/audit/router.py). Because
those sets are closed `Literal`s, anything a service writes but forgets to
list still lands in the table and still shows in the unfiltered list — yet no
filter can ever retrieve it, so the admin screen silently hides that class of
event. That is exactly the bug this test prevents.

The scan is token-based (not regex) so a value mentioned inside a comment or a
docstring never counts as an emission.
"""

from __future__ import annotations

import ast
import io
import tokenize
from pathlib import Path
from typing import Literal, get_args

import pytest

from social_api.modules.audit.router import AuditActionLiteral, AuditEntityLiteral

pytestmark = pytest.mark.unit

SRC_ROOT = Path(__file__).resolve().parents[2] / "src" / "social_api"


def _emitted_values(keyword: str) -> set[str]:
    """Every `keyword="<literal>"` keyword argument in the application source."""
    found: set[str] = set()
    for path in SRC_ROOT.rglob("*.py"):
        source = path.read_text(encoding="utf-8")
        tokens = list(tokenize.generate_tokens(io.StringIO(source).readline))
        # Sliding window over adjacent triplets; short tails are expected.
        for first, second, third in zip(tokens, tokens[1:], tokens[2:], strict=False):
            if (
                first.type == tokenize.NAME
                and first.string == keyword
                and second.type == tokenize.OP
                and second.string == "="
                and third.type == tokenize.STRING
            ):
                value = ast.literal_eval(third.string)
                if isinstance(value, str):
                    found.add(value)
    return found


def _literal_values(literal: object) -> set[str]:
    return {str(v) for v in get_args(literal)}


def test_source_tree_is_discoverable() -> None:
    """The scan target must exist, else the checks below pass vacuously."""
    assert SRC_ROOT.is_dir()
    assert list(SRC_ROOT.rglob("*.py"))


def test_every_emitted_action_is_filterable() -> None:
    missing = sorted(_emitted_values("action") - _literal_values(AuditActionLiteral))
    assert not missing, f"actions written but not filterable via /audit: {missing}"


def test_every_emitted_entity_is_filterable() -> None:
    missing = sorted(_emitted_values("entity") - _literal_values(AuditEntityLiteral))
    assert not missing, f"entities written but not filterable via /audit: {missing}"


def test_no_dead_filter_options() -> None:
    """A member nothing ever writes is a dropdown option that yields zero rows."""
    dead_actions = sorted(_literal_values(AuditActionLiteral) - _emitted_values("action"))
    dead_entities = sorted(_literal_values(AuditEntityLiteral) - _emitted_values("entity"))
    assert not dead_actions, f"filterable actions never written: {dead_actions}"
    assert not dead_entities, f"filterable entities never written: {dead_entities}"


def test_enums_have_no_duplicates() -> None:
    for literal in (AuditActionLiteral, AuditEntityLiteral):
        args = get_args(literal)
        assert len(args) == len(set(args))


def test_action_and_entity_sets_are_disjoint_in_shape() -> None:
    """Actions are SCREAMING_CASE, entities are lowercase — keeps selects readable."""
    assert all(a.isupper() for a in get_args(AuditActionLiteral))
    assert all(e.islower() for e in get_args(AuditEntityLiteral))


def test_literal_alias_is_still_a_literal() -> None:
    assert getattr(AuditActionLiteral, "__origin__", None) is Literal
    assert getattr(AuditEntityLiteral, "__origin__", None) is Literal
