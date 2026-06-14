#!/usr/bin/env python3
"""Rename the modified pinyin TTFs off the OFL Reserved Font Names.

Phase 8 §I (plan/overhaul/prep/phase8-shell-pwa.md): the shipped pinyin
overlay fonts are Modified Versions of ParaType's PT Sans Narrow Web
2.003W (OFL-1.1) with five pinyin tone glyphs injected (U+01CE, U+01D0,
U+01D2, U+01D4, U+01DA — acaron/icaron/ocaron/ucaron/udieresiscaron).
OFL-1.1 forbids Modified Versions from using the Reserved Font Names
("PT Sans" et al.); this script produces the renamed derivative:

    Versicle Sans Narrow  (files public/fonts/VersicleSansNarrow-*.ttf)

PROVENANCE (closes the inventory.json "unreproducible derivative" gap as
far as it can be closed): the INPUTS to this script are the
previously-shipped glyph-injected binaries — the original glyph-injection
fonttools script predates the repo and is lost, so the injected binaries
are the canonical source artifacts. Their hashes:

  PT_Sans-Narrow-Web-Regular.ttf (git history, deleted at the rename)
    sha256 35a9cce169015258e452d8c55402865efc64bedb4c816ad8a721e01556d29955
  PT_Sans-Narrow-Web-Bold.ttf
    sha256 5e6e50f5ec2138a31ad97dfad8881d69ccc386fcbb3308c0a1f5377de743b543

What changes (name table ONLY — the script asserts glyf/cmap byte
equality so the injected tone glyphs cannot drift):
  - IDs 1/4/16/18 (family/full names)  -> Versicle Sans Narrow [Bold]
  - ID 3 (unique ID)                   -> Versicle: ... : 2026
  - ID 6 (PostScript)                  -> VersicleSansNarrow-{Regular,Bold}
  - ID 7 (trademark)                   -> DELETED (the renamed font no
    longer trades on ParaType's mark)
  - ID 10 (description)                -> derivative description, RFN-free
  - ID 0 (copyright)                   -> ParaType notice RETAINED (OFL
    requirement) + modification note appended
  - ID 5 (version)                     -> suffixed with the rename marker
  - IDs 13/14 (OFL license text/URL)   -> RETAINED VERBATIM — the license
    text itself declares the RFNs; that is required provenance, recorded
    in third-party/inventory.json.

Usage:
    python3 scripts/build-pinyin-font.py INPUT.ttf OUTPUT.ttf

Requires: fontTools (any recent version; developed against 4.60).
"""
from __future__ import annotations

import hashlib
import sys
from pathlib import Path

from fontTools.ttLib import TTFont

PINYIN_CODEPOINTS = (0x01CE, 0x01D0, 0x01D2, 0x01D4, 0x01DA)

NEW_FAMILY = "Versicle Sans Narrow"


def rename(input_path: Path, output_path: Path) -> None:
    src_bytes = input_path.read_bytes()
    print(f"input  {input_path}  sha256 {hashlib.sha256(src_bytes).hexdigest()}")

    font = TTFont(str(input_path))
    name = font["name"]

    subfamily = name.getDebugName(2) or "Regular"  # 'Regular' | 'Bold'
    bold = subfamily.strip().lower() == "bold"
    full_name = NEW_FAMILY + (" Bold" if bold else "")
    ps_name = "VersicleSansNarrow-" + ("Bold" if bold else "Regular")

    glyf_before = font.reader["glyf"] if "glyf" in font.reader.tables else None
    cmap_before = font.reader["cmap"]

    replacements = {
        1: NEW_FAMILY,
        3: f"Versicle: {full_name}: 2026",
        4: full_name,
        6: ps_name,
        10: (
            f"{NEW_FAMILY} is a Modified Version (SIL OFL-1.1) of a ParaType "
            "narrow sans-serif, renamed off the Reserved Font Names with five "
            "pinyin tone glyphs (a/i/o/u-caron, u-dieresis-caron) injected for "
            "the Versicle reader's pinyin overlay."
        ),
        16: NEW_FAMILY,
        18: full_name,
    }

    for record in list(name.names):
        nid = record.nameID
        if nid == 7:
            # Trademark: the renamed font must not carry ParaType's mark.
            name.removeNames(
                nameID=7,
                platformID=record.platformID,
                platEncID=record.platEncID,
                langID=record.langID,
            )
        elif nid in replacements:
            record.string = replacements[nid]
        elif nid == 0:
            record.string = (
                record.toUnicode()
                + " Modified Version renamed to "
                + NEW_FAMILY
                + " under SIL OFL-1.1 (pinyin tone glyphs injected; Versicle project, 2026)."
            )
        elif nid == 5:
            record.string = record.toUnicode() + "; Versicle rename 2026"
        # 2 (subfamily), 8/9 (vendor/designer), 11/12 (URLs), 13/14 (OFL
        # license text + URL) are retained verbatim.

    font.save(str(output_path))

    # ── Verification: glyph data untouched, RFNs gone from naming IDs ──────
    out = TTFont(str(output_path))
    if glyf_before is not None and out.reader["glyf"] != glyf_before:
        raise SystemExit("FAIL: glyf table changed — the rename must not touch outlines.")
    if out.reader["cmap"] != cmap_before:
        raise SystemExit("FAIL: cmap table changed — the rename must not touch mappings.")
    cmap = out.getBestCmap()
    missing = [hex(cp) for cp in PINYIN_CODEPOINTS if cp not in cmap]
    if missing:
        raise SystemExit(f"FAIL: pinyin tone glyphs missing from cmap: {missing}")
    for record in out["name"].names:
        if record.nameID == 7:
            raise SystemExit("FAIL: trademark record (nameID 7) must be deleted.")
        # Naming + description IDs must be free of the Reserved Font Name.
        # (ParaType ATTRIBUTION stays — IDs 0/8/13 retain it per OFL.)
        if record.nameID in (1, 3, 4, 6, 10, 16, 17, 18):
            text = record.toUnicode()
            if "PT Sans" in text:
                raise SystemExit(
                    f"FAIL: nameID {record.nameID} still carries the Reserved "
                    f"Font Name: {text!r}"
                )
    out_bytes = output_path.read_bytes()
    print(f"output {output_path}  sha256 {hashlib.sha256(out_bytes).hexdigest()}")
    print(f"OK: renamed to '{full_name}' (PostScript {ps_name}); glyf/cmap byte-identical.")


def main(argv: list[str]) -> None:
    if len(argv) != 3:
        raise SystemExit(__doc__)
    rename(Path(argv[1]), Path(argv[2]))


if __name__ == "__main__":
    main(sys.argv)
