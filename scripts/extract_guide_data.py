#!/usr/bin/env python3
"""
Deterministic extractor for Jesper Ordrup's MIT-licensed Vocal Guide (EN + DA).

Parses all 5 categories, 21 vocal techniques (descriptions, character, artist examples,
how-to guidance, exercises, CVT notes, safety warnings, difficulty, prerequisites, and
YouTube tutorial links) plus all 6 educational guide modals (Intro, Beginner Guide,
Warm-Up Routine, Anatomy & Prep, 10 Vocal Myths, and Complete Vocal Technique [CVT])
into `src/data/vocalGuideData.json`.
"""

from __future__ import annotations

import argparse
import copy
import json
from pathlib import Path
import urllib.request
from typing import Any

from bs4 import BeautifulSoup, Tag

ROOT = Path(__file__).resolve().parents[1]
UPSTREAM_URL = "https://raw.githubusercontent.com/jesperordrup/vocal-guide/main/index.html"
DEFAULT_CACHE = ROOT / ".asset-cache" / "upstream-vocal-guide-index.html"
OUT_JSON = ROOT / "src" / "data" / "vocalGuideData.json"

CATEGORIES: tuple[dict[str, Any], ...] = (
    {
        "slug": "registers",
        "name": {"en": "Vocal Registers", "da": "Vokale Registre"},
        "description": {
            "en": "Foundation voice modes every singer must master.",
            "da": "Grundlæggende stemmefunktioner enhver sanger bør mestre.",
        },
    },
    {
        "slug": "styles",
        "name": {"en": "Vocal Styles & Techniques", "da": "Vokale Stilarter & Teknikker"},
        "description": {
            "en": "Characteristic vocal approaches that define genre and expression.",
            "da": "Karakteristiske vokale tilgange der definerer genre og udtryk.",
        },
    },
    {
        "slug": "effects",
        "name": {"en": "Vocal Effects", "da": "Vokale Effekter"},
        "description": {
            "en": "Extended techniques that add texture and emotion.",
            "da": "Udvidede teknikker der tilføjer tekstur og følelse.",
        },
    },
    {
        "slug": "ornaments",
        "name": {"en": "Embellish", "da": "Udsmykning"},
        "description": {
            "en": "Melodic embellishments that add flair and sophistication.",
            "da": "Melodiske udsmykninger der tilføjer finesse og karakter.",
        },
    },
    {
        "slug": "dynamics",
        "name": {"en": "Dynamics", "da": "Dynamik"},
        "description": {
            "en": "The art of contrast and expression through volume control.",
            "da": "Kunsten at skabe kontrast og udtryk gennem volumenkontrol.",
        },
    },
)


def norm_ws(text: str) -> str:
    return " ".join(text.split())


def lang_text(container: Tag | None, lang: str) -> str:
    if container is None:
        return ""
    clone = copy.copy(container)
    other = "da" if lang == "en" else "en"
    for el in clone.select(f'[data-lang="{other}"]'):
        el.decompose()
    for svg in clone.select("svg"):
        svg.decompose()
    return norm_ws(clone.get_text(" ", strip=True))


def own_title(el: Tag | None) -> str:
    if el is None:
        return ""
    parts: list[str] = []
    for child in el.contents:
        if isinstance(child, str):
            s = child.strip()
            if s:
                parts.append(s)
    return norm_ws(" ".join(parts))


def extract_how_block(td_how: Tag, lang: str) -> dict[str, Any]:
    span = td_how.find("span", attrs={"data-lang": lang}, recursive=False)
    target = span if span is not None else td_how
    clone = BeautifulSoup(str(target), "html.parser")
    other = "da" if lang == "en" else "en"
    for el in clone.select(f'[data-lang="{other}"]'):
        el.decompose()

    exercises = [norm_ws(ex.get_text(" ", strip=True)) for ex in clone.select(".exercise")]
    for ex in clone.select(".exercise"):
        ex.decompose()

    # Extract CVT note from td_how
    cvt_el = td_how.select_one(f'.cvt-note [data-lang="{lang}"]') or td_how.select_one(f'.cvt-note[data-lang="{lang}"]')
    if cvt_el is None:
        cvt_wrap = td_how.select_one(".cvt-note")
        if cvt_wrap:
            cclone = copy.copy(cvt_wrap)
            for a in cclone.find_all("a"):
                a.decompose()
            cvt_note = lang_text(cclone, lang)
        else:
            cvt_note = ""
    else:
        cclone = copy.copy(cvt_el)
        for a in cclone.find_all("a"):
            a.decompose()
        cvt_note = norm_ws(cclone.get_text(" ", strip=True))

    warnings = [norm_ws(w.get_text(" ", strip=True)) for w in td_how.select(f'.danger-note[data-lang="{lang}"]')]
    if not warnings:
        for w in td_how.select(".danger-note"):
            if not w.get("data-lang"):
                warnings.append(lang_text(w, lang))

    for rem in clone.select(".cvt-note, .danger-note, .difficulty"):
        rem.decompose()

    lead_strong = clone.find("strong")
    headline = norm_ws(lead_strong.get_text(" ", strip=True)) if lead_strong else ""
    if lead_strong:
        lead_strong.decompose()
    body = norm_ws(clone.get_text(" ", strip=True))
    return {
        "headline": headline,
        "body": body,
        "exercises": [e for e in exercises if e],
        "cvtNote": cvt_note,
        "warnings": [w for w in warnings if w],
    }


def parse_modal_sections(modal: Tag, lang: str) -> dict[str, Any]:
    lang_div = modal.select_one(f'div[data-lang="{lang}"]')
    if lang_div is None:
        return {"title": "", "sections": []}
    h3 = lang_div.find("h3")
    title = norm_ws(h3.get_text(" ", strip=True)) if h3 else ""
    sections: list[dict[str, Any]] = []
    for sec in lang_div.select(".readme-section"):
        sec_heading = ""
        paragraphs: list[str] = []
        bullets: list[str] = []
        table_rows: list[list[str]] = []
        table_headers: list[str] = []

        for child in sec.children:
            if not isinstance(child, Tag):
                continue
            if child.name == "p":
                txt = norm_ws(child.get_text(" ", strip=True))
                only_strong = child.find("strong")
                if (
                    not sec_heading
                    and only_strong is not None
                    and norm_ws(only_strong.get_text(" ", strip=True)) == txt
                ):
                    sec_heading = txt
                elif txt:
                    paragraphs.append(txt)
            elif child.name in ("ul", "ol"):
                for li in child.find_all("li", recursive=False):
                    t = norm_ws(li.get_text(" ", strip=True))
                    if t:
                        bullets.append(t)
            elif child.name == "table":
                for th in child.select("thead th"):
                    table_headers.append(norm_ws(th.get_text(" ", strip=True)))
                for tr in child.select("tbody tr"):
                    row = [norm_ws(td.get_text(" ", strip=True)) for td in tr.find_all(["td", "th"], recursive=False)]
                    if any(row):
                        table_rows.append(row)

        entry: dict[str, Any] = {"heading": sec_heading, "paragraphs": paragraphs}
        if bullets:
            entry["bullets"] = bullets
        if table_rows:
            entry["table"] = {"headers": table_headers, "rows": table_rows}
        sections.append(entry)
    return {"title": title, "sections": sections}


def load_html(input_path: Path | None) -> str:
    if input_path and input_path.exists():
        return input_path.read_text(encoding="utf-8")
    if DEFAULT_CACHE.exists():
        return DEFAULT_CACHE.read_text(encoding="utf-8")
    DEFAULT_CACHE.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(UPSTREAM_URL, headers={"User-Agent": "vocal-guide-4d-extractor/1.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        html_text = resp.read().decode("utf-8")
    DEFAULT_CACHE.write_text(html_text, encoding="utf-8")
    return html_text


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract bilingual Vocal Guide content to JSON.")
    parser.add_argument("--input", type=Path, default=None, help="Path to upstream index.html")
    args = parser.parse_args()

    html_text = load_html(args.input)
    soup = BeautifulSoup(html_text, "html.parser")

    techniques: list[dict[str, Any]] = []
    for cat in CATEGORIES:
        cat_slug = cat["slug"]
        sec = soup.find(id=cat_slug)
        if sec is None:
            raise RuntimeError(f"Missing category section #{cat_slug}")
        table = sec.find_next("table")
        if table is None:
            raise RuntimeError(f"Missing table after #{cat_slug}")
        for tr in table.select('tr[id^="tech-"]'):
            tds = tr.find_all("td", recursive=False)
            slug = str(tr["id"]).replace("tech-", "", 1)
            name = own_title(tds[0].select_one(".technique-name"))
            desc_en = lang_text(tds[0].select_one('.desc-tip[data-lang="en"]'), "en")
            desc_da = lang_text(tds[0].select_one('.desc-tip[data-lang="da"]'), "da")

            prereqs: list[dict[str, str]] = []
            for a in tds[0].select(".prereq-chip"):
                href = str(a.get("href", ""))
                pslug = href.replace("techniques/", "").replace("#tech-", "").strip("/")
                prereqs.append({
                    "slug": pslug,
                    "name": norm_ws(a.get_text(" ", strip=True)),
                })

            char_en = lang_text(tds[1], "en")
            char_da = lang_text(tds[1], "da")
            examples = norm_ws(tds[2].get_text(" ", strip=True))
            difficulty = len(tds[3].select(".difficulty .active"))

            how_en = extract_how_block(tds[3], "en")
            how_da = extract_how_block(tds[3], "da")

            resources: list[dict[str, str]] = []
            if len(tds) > 4:
                for link in tds[4].select("a[href]"):
                    lclone = copy.copy(link)
                    for svg in lclone.select("svg"):
                        svg.decompose()
                    resources.append({
                        "label": norm_ws(lclone.get_text(" ", strip=True)),
                        "url": str(link["href"]),
                    })

            techniques.append({
                "slug": slug,
                "id": f"tech-{slug}",
                "name": name,
                "category": cat_slug,
                "difficulty": difficulty,
                "examples": examples,
                "prerequisites": prereqs,
                "description": {"en": desc_en, "da": desc_da or desc_en},
                "character": {"en": char_en, "da": char_da or char_en},
                "howTo": {"en": how_en, "da": how_da},
                "resources": resources,
                "upstreamUrl": f"https://jesperordrup.github.io/vocal-guide/techniques/{slug}/",
            })

    if len(techniques) != 21:
        raise RuntimeError(f"Expected 21 techniques, extracted {len(techniques)}")

    modal_map = {
        "intro": "introGuideModal",
        "beginner": "beginnerGuideModal",
        "warmup": "warmupModal",
        "anatomy": "anatomyModal",
        "myths": "mythsModal",
        "cvt": "cvtModal",
    }
    guides: dict[str, dict[str, Any]] = {}
    for key, mid in modal_map.items():
        m = soup.find(id=mid)
        if m is None:
            raise RuntimeError(f"Missing modal #{mid}")
        guides[key] = {
            "en": parse_modal_sections(m, "en"),
            "da": parse_modal_sections(m, "da"),
        }

    payload = {
        "attribution": {
            "title": "Vocal Guide — Vocal Techniques Reference",
            "author": "Jesper Ordrup",
            "license": "MIT",
            "upstreamUrl": "https://jesperordrup.github.io/vocal-guide/",
            "repoUrl": "https://github.com/jesperordrup/vocal-guide",
        },
        "categories": list(CATEGORIES),
        "techniques": techniques,
        "guides": guides,
    }

    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        f"Extracted {len(techniques)} bilingual techniques across {len(CATEGORIES)} categories + "
        f"{len(guides)} bilingual guide modals -> {OUT_JSON.relative_to(ROOT)}"
    )


if __name__ == "__main__":
    main()
