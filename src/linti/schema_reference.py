"""Versioned URLs of the linti.yaml JSON Schema, and the upgrade check for them.

Each release tag (``v<version>``) carries the ``linti.schema.json`` matching
that version's config models, so a ``linti.yaml`` pins its schema with the
YAML language server modeline::

    # yaml-language-server: $schema=https://raw.githubusercontent.com/onefloid/linti/v0.8.0/linti.schema.json

After an upgrade that pin is stale. :func:`check_schema_reference` spots that
when the config is loaded and warns with the line to use instead.

Deliberately free of heavy imports: it runs on every config load, while the
schema itself is only built by ``linti schema`` and the generator script.
"""

from __future__ import annotations

import json
import re
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Optional

SCHEMA_URL_TEMPLATE = (
    "https://raw.githubusercontent.com/onefloid/linti/{ref}/linti.schema.json"
)

_MODELINE = re.compile(r"^\s*#\s*yaml-language-server:\s*\$schema=(\S+)", re.MULTILINE)
# The git ref in a raw.githubusercontent.com URL of the linti schema.
_URL_REF = re.compile(
    r"^https?://raw\.githubusercontent\.com/onefloid/linti/([^/]+)/linti\.schema\.json$"
)
_VERSION_TAG = re.compile(r"^v(\d+(?:\.\d+)*\S*)$")


def installed_version() -> Optional[str]:
    """The installed linti version, or ``None`` when it cannot be determined."""
    try:
        return version("linti")
    except PackageNotFoundError:
        return None


def schema_url(linti_version: str) -> str:
    """The schema URL pinned to the release tag of *linti_version*."""
    return SCHEMA_URL_TEMPLATE.format(ref=f"v{linti_version}")


def modeline(linti_version: str) -> str:
    """The ``linti.yaml`` comment that binds editors to *linti_version*'s schema."""
    return f"# yaml-language-server: $schema={schema_url(linti_version)}"


def _referenced_version(reference: str, config_path: Path) -> Optional[str]:
    """The linti version a ``$schema`` reference pins, if it pins one.

    A release-tag URL names the version directly. A local file (written by
    ``linti schema``) names it through its ``$id``. Anything else — a branch
    such as ``main``, a foreign schema, an unreadable file — pins nothing.
    """
    url_match = _URL_REF.match(reference)
    if url_match is None and "://" not in reference:
        schema_file = (config_path.parent / reference).resolve()
        try:
            schema_id = json.loads(schema_file.read_text()).get("$id", "")
        except (OSError, ValueError, AttributeError):
            return None
        url_match = _URL_REF.match(str(schema_id))
    if url_match is None:
        return None
    tag_match = _VERSION_TAG.match(url_match.group(1))
    return tag_match.group(1) if tag_match else None


def check_schema_reference(
    config_text: str, config_path: Path, current_version: Optional[str] = None
) -> Optional[str]:
    """A warning when *config_text* pins the schema of another linti version.

    Returns ``None`` when there is no modeline, it pins no version, it pins the
    installed one, or the installed version is unknown.
    """
    current = current_version or installed_version()
    match = _MODELINE.search(config_text)
    if current is None or match is None:
        return None
    referenced = _referenced_version(match.group(1), config_path)
    if referenced is None or referenced == current:
        return None
    return (
        f"{config_path}: the JSON Schema referenced for editor support belongs to "
        f"linti {referenced}, but linti {current} is installed. Replace the "
        f"'yaml-language-server' comment with:\n    {modeline(current)}\n"
        "(or regenerate a local copy with 'linti schema > linti.schema.json')."
    )
