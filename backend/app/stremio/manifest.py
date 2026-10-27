"""Stremio addon manifest schema.

Spec: https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/responses/manifest.md

Validation is deliberately lenient (unknown keys are kept) because real-world
addons add their own fields and Stremio itself accepts them. We only enforce
what the app needs to talk to the addon. The raw manifest is what gets stored.
"""

from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator


class _Lenient(BaseModel):
    model_config = ConfigDict(extra="allow")


class ExtraProperty(_Lenient):
    name: str
    isRequired: bool = False
    options: list[str] | None = None
    optionsLimit: int | None = None


class CatalogDescriptor(_Lenient):
    type: str
    id: str
    name: str | None = None
    extra: list[ExtraProperty] = Field(default_factory=list)
    # Legacy (pre-`extra`) form, still used by some addons.
    extraSupported: list[str] | None = None
    extraRequired: list[str] | None = None


class ResourceDescriptor(_Lenient):
    name: str
    types: list[str] | None = None
    idPrefixes: list[str] | None = None


class BehaviorHints(_Lenient):
    adult: bool = False
    p2p: bool = False
    configurable: bool = False
    configurationRequired: bool = False


class Manifest(_Lenient):
    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    version: str = Field(min_length=1)
    description: str | None = None
    # Each entry is a resource name ("catalog", "meta", "stream", "subtitles",
    # "addon_catalog") or a full descriptor with its own types/idPrefixes.
    resources: list[str | ResourceDescriptor]
    types: list[str] = Field(default_factory=list)
    catalogs: list[CatalogDescriptor] = Field(default_factory=list)
    idPrefixes: list[str] | None = None
    logo: str | None = None
    background: str | None = None
    behaviorHints: BehaviorHints = Field(default_factory=BehaviorHints)

    @field_validator("resources")
    @classmethod
    def _non_empty(cls, v: list[Any]) -> list[Any]:
        if not v:
            raise ValueError("el addon no declara ningún recurso")
        return v

    def resource_names(self) -> list[str]:
        return [r if isinstance(r, str) else r.name for r in self.resources]
