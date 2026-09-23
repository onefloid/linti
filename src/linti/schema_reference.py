"""Versioned URLs of the linti.yaml JSON Schema, and the upgrade check for them.

The schema carries its own version, :data:`SCHEMA_VERSION`: the linti release
in which the config last changed. Releases that leave the config alone keep
it, so a ``linti.yaml`` pinned with the YAML language server modeline::

    # yaml-language-server: $schema=https://raw.githubusercontent.com/onefloid/linti/v0.8.0/linti.schema.json

stays valid across upgrades until the config actually changes. Only then
does :func:`check_schema_reference` warn, when the config is loaded.

Deliberately free of heavy imports: it runs on every config load, while the
schema itself is only built by ``linti schema`` and the generator script.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Optional

from linti._schema_version import SCHEMA_VERSION

SCHEMA_URL_TEMPLATE = (
    "https://raw.githubusercontent.com/onefloid/linti/{ref}/linti.schema.json"
)

_MODELINE = re.compile(r"^\s*#\s*yaml-language-server:\s*\$schema=(\S+)", re.MULTILINE)
# The git ref in a raw.githubusercontent.com URL of the linti schema.
_URL_REF = re.compile(
    r"^https?://raw\.githubusercontent\.com/onefloid/linti/([^/]+)/linti\.schema\.json$"
)
_VERSION_TAG = re.compile(r"^v(\d+(?:\.\d+)*)$")


def schema_url(schema_version: str = SCHEMA_VERSION) -> str:
    """The schema URL pinned to the release tag of *schema_version*."""
    return SCHEMA_URL_TEMPLATE.format(ref=f"v{schema_version}")


def modeline(schema_version: str = SCHEMA_VERSION) -> str:
    """The ``linti.yaml`` comment that binds editors to *schema_version*'s schema."""
    return f"# yaml-language-server: $schema={schema_url(schema_version)}"


def version_key(linti_version: str) -> tuple[int, ...]:
    """Numeric sort key of a plain ``X.Y.Z`` version."""
    return tuple(int(part) for part in linti_version.split("."))


def schema_version_of(schema: dict) -> Optional[str]:
    """The version a schema's ``$id`` names, or ``None`` if it names none."""
    url_match = _URL_REF.match(str(schema.get("$id", "")))
    tag_match = _VERSION_TAG.match(url_match.group(1)) if url_match else None
    return tag_match.group(1) if tag_match else None


def _referenced_version(reference: str, config_path: Path) -> Optional[str]:
    """The schema version a ``$schema`` reference pins, if it pins one.

    A release-tag URL names the version directly. A local file (written by
    ``linti schema``) names it through its ``$id``. Anything else — a branch
    such as ``main``, a foreign schema, an unreadable file — pins nothing.
    """
    url_match = _URL_REF.match(reference)
    if url_match is not None:
        tag_match = _VERSION_TAG.match(url_match.group(1))
        return tag_match.group(1) if tag_match else None
    if "://" in reference:
        return None
    try:
        schema = json.loads((config_path.parent / reference).read_text())
    except (OSError, ValueError):
        return None
    return schema_version_of(schema) if isinstance(schema, dict) else None


def check_schema_reference(
    config_text: str, config_path: Path, current: str = SCHEMA_VERSION
) -> Optional[str]:
    """A warning when *config_text* pins a schema older than the *current* one.

    Pinning an older release is fine as long as the config has not changed
    since: its schema version is then still *current*. Returns ``None`` when
    there is no modeline, it pins no version, or the pinned version is at
    least *current*.
    """
    match = _MODELINE.search(config_text)
    if match is None:
        return None
    referenced = _referenced_version(match.group(1), config_path)
    if referenced is None or version_key(referenced) >= version_key(current):
        return None
    return (
        f"{config_path}: the linti config changed in linti {current}, but the "
        f"JSON Schema referenced for editor support is the one of linti "
        f"{referenced}. Replace the 'yaml-language-server' comment with:\n"
        f"    {modeline(current)}\n"
        "(or regenerate a local copy with 'linti schema > linti.schema.json')."
    )
