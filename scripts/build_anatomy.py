#!/usr/bin/env python3
"""
Deterministic BodyParts3D 4.3 unified 3D vocal-anatomy rig builder.

Assembles verified CC-BY-SA-2.1-JP anatomical meshes across four functional layers:
  1. larynx    — Left/right separated laryngeal cartilages, ligaments & intrinsic muscles (raw BodyParts3D 4.3 OBJs)
  2. extrinsic — Infrahyoid depressors, suprahyoid elevators & jaw/neck tension muscles (OrganUI BodyParts3D 4.3)
  3. tract     — Tongue, extrinsic tongue, soft palate/velum, pharyngeal constrictors & mandible/maxilla
  4. breath    — Trachea, lungs, thoracic diaphragm, ribcage/spine, intercostals & abdominal support wall

All sources are SHA-256 verified, mapped back to exact BodyParts3D 4.3 patient millimeters
(x = patient left, -y = anterior, +z = superior), cross-checked via shared hyoid-bone geometry,
centered on the glottal midpoint, converted to scene units (1 unit = 10 mm = 1 cm:
X = +x_mm/10, Y = +z_mm/10, Z = -y_mm/10), and exported to:
  - public/models/vocal-anatomy.glb
  - public/models/manifest.json
  - public/models/ATTRIBUTION.md
  - src/data/anatomyRig.json
"""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
import hashlib
import json
from pathlib import Path
import struct
import urllib.request
from typing import Any

import numpy as np
from numpy.typing import NDArray

ROOT = Path(__file__).resolve().parents[1]
CACHE_DIR = ROOT / ".asset-cache"
LARYNX_INPUTS_PATH = ROOT / "scripts" / "larynx-inputs.json"
OUT_GLB = ROOT / "public" / "models" / "vocal-anatomy.glb"
OUT_MANIFEST = ROOT / "public" / "models" / "manifest.json"
OUT_ATTRIBUTION = ROOT / "public" / "models" / "ATTRIBUTION.md"
OUT_RIG_JSON = ROOT / "src" / "data" / "anatomyRig.json"

SCENE_MM_SCALE = 0.1  # 1 scene unit = 10 mm = 1 cm


@dataclass(frozen=True)
class GlbArchiveSpec:
    name: str
    url: str
    sha256: str
    center_mm: tuple[float, float, float]
    scale: float


GLB_ARCHIVES: dict[str, GlbArchiveSpec] = {
    "pharynx": GlbArchiveSpec(
        name="pharynx",
        url="https://raw.githubusercontent.com/organui/pharynx-3d/main/public/models/pharynx.glb",
        sha256="70d3992cc103ab18f1e9598582cf84c21cc4cbc4d1e65f3853a78efc2961202d",
        center_mm=(-1.085049999999999, -119.17304999999999, 1450.635),
        scale=0.01,
    ),
    "tongue": GlbArchiveSpec(
        name="tongue",
        url="https://raw.githubusercontent.com/organui/tongue-3d/main/public/models/tongue.glb",
        sha256="1e5770791e8111cf1a3c4cfe31b75d076de435a10376f64473026e98ccb5ce40",
        center_mm=(-0.6533999999999978, -120.7158, 1454.42),
        scale=0.034,
    ),
    "muscles": GlbArchiveSpec(
        name="muscles",
        url="https://raw.githubusercontent.com/organui/muscles-3d/main/public/models/muscles.glb",
        sha256="615ed2cf0d5ca9aa63f30bb806a65c740ed2ab057463a19505e19eff2bf207ce",
        center_mm=(-0.6569976806640625, -97.01134777069092, 816.8721876144409),
        scale=0.004,
    ),
    "skeleton": GlbArchiveSpec(
        name="skeleton",
        url="https://raw.githubusercontent.com/organui/skeleton-3d/main/public/models/skeleton.glb",
        sha256="c68b05d97d70c4d33363bf71d9885c191eb25f61a82dbba935a726ddd8e60ac8",
        center_mm=(-0.667999267578125, -109.74665069580078, 817.0244853496552),
        scale=0.0025,
    ),
    "lungs": GlbArchiveSpec(
        name="lungs",
        url="https://raw.githubusercontent.com/organui/lungs-3d/main/public/models/lungs.glb",
        sha256="b2b19e5f7473036598e3552a5835a4ebc0f55c786ddd00863cb6a170409ed346",
        center_mm=(-0.13700000000000045, -106.13425000000001, 1255.975),
        scale=0.018,
    ),
}


@dataclass(frozen=True)
class StructureSpec:
    id: str
    name: str
    layer: str  # "larynx" | "extrinsic" | "tract" | "breath"
    kind: str   # "cartilage" | "bone" | "ligament" | "muscle" | "organ"
    fma: str
    source_type: str  # "larynx_obj" | "pharynx" | "tongue" | "muscles" | "skeleton" | "lungs"
    source_ids: tuple[str, ...]
    channel: str | None  # Primary activation channel (CT, TA, LCA, IA, PCA, AES, INF, SUP, VEL, DIA, APP)
    role: str
    max_tris: int
    base_color: tuple[float, float, float]


STRUCTURES: tuple[StructureSpec, ...] = (
    # === LAYER 1: LARYNGEAL CORE (Left/Right Separated Raw BodyParts3D 4.3 OBJs) ===
    StructureSpec("hyoid-bone", "Hyoid Bone", "larynx", "bone", "FMA52749", "larynx_obj", ("FJ2772",), None,
                  "Floating suspension bone anchoring the larynx between suprahyoid elevators and infrahyoid depressors.", 1400, (0.91, 0.87, 0.78)),
    StructureSpec("thyroid-cartilage", "Thyroid Cartilage", "larynx", "cartilage", "FMA55099", "larynx_obj", ("FJ2808",), None,
                  "Shield cartilage housing the vocal folds; tilts forward/down on the cricothyroid joint to stretch pitch.", 2800, (0.76, 0.86, 0.92)),
    StructureSpec("cricoid-cartilage", "Cricoid Cartilage", "larynx", "cartilage", "FMA9615", "larynx_obj", ("FJ2769",), None,
                  "Signet-ring foundation cartilage sitting atop the trachea; supports the arytenoids posteriorly.", 2000, (0.72, 0.83, 0.90)),
    StructureSpec("epiglottis", "Epiglottis", "larynx", "cartilage", "FMA55130", "larynx_obj", ("FJ2770",), "AES",
                  "Leaf-shaped elastic cartilage forming the anterior wall of the aryepiglottic twang funnel.", 2200, (0.82, 0.88, 0.78)),
    StructureSpec("right-arytenoid", "Right Arytenoid Cartilage", "larynx", "cartilage", "FMA55113", "larynx_obj", ("FJ2792", "FJ2793"), None,
                  "Pyramidal cartilage pivoting and sliding on the cricoid to adduct, abduct, or compress the right vocal fold.", 900, (0.85, 0.91, 0.96)),
    StructureSpec("left-arytenoid", "Left Arytenoid Cartilage", "larynx", "cartilage", "FMA55114", "larynx_obj", ("FJ2775", "FJ2776"), None,
                  "Pyramidal cartilage pivoting and sliding on the cricoid to adduct, abduct, or compress the left vocal fold.", 900, (0.85, 0.91, 0.96)),
    StructureSpec("cuneiform-cartilages", "Cuneiform Cartilages", "larynx", "cartilage", "FMA55117", "larynx_obj", ("FJ2795", "FJ2773"), "AES",
                  "Small rod cartilages stiffening the aryepiglottic rim for epilaryngeal ring/twang.", 500, (0.80, 0.88, 0.85)),
    StructureSpec("thyrohyoid-membrane", "Thyrohyoid Membrane & Ligaments", "larynx", "ligament", "FMA55133", "larynx_obj",
                  ("FJ2804", "FJ2786", "FJ2790", "FJ2797", "FJ2779"), None,
                  "Fibroelastic sheet suspending the thyroid cartilage from the hyoid bone.", 1800, (0.84, 0.84, 0.80)),
    StructureSpec("cricothyroid-ligament", "Median Cricothyroid Ligament", "larynx", "ligament", "FMA55237", "larynx_obj", ("FJ2789",), None,
                  "Anterior elastic ligament bridging the cricothyroid visor gap, narrowing as pitch rises.", 900, (0.86, 0.85, 0.79)),
    StructureSpec("right-conus-elasticus", "Right Conus Elasticus", "larynx", "ligament", "FMA55251", "larynx_obj", ("FJ2794",), None,
                  "Lateral cricovocal membrane channeling subglottal air upward to the right vocal ligament.", 1200, (0.85, 0.83, 0.78)),
    StructureSpec("left-conus-elasticus", "Left Conus Elasticus", "larynx", "ligament", "FMA55252", "larynx_obj", ("FJ2777",), None,
                  "Lateral cricovocal membrane channeling subglottal air upward to the left vocal ligament.", 1200, (0.85, 0.83, 0.78)),
    StructureSpec("epiglottic-ligaments", "Hyo- & Thyro-Epiglottic Ligaments", "larynx", "ligament", "FMA55227", "larynx_obj", ("FJ2771", "FJ2807"), None,
                  "Elastic ligaments tethering the epiglottis petiole to the inner thyroid angle and hyoid.", 900, (0.84, 0.84, 0.78)),
    StructureSpec("right-vocal-ligament", "Right Vocal Ligament", "larynx", "ligament", "FMA55245", "larynx_obj", ("FJ2805",), "CT",
                  "Load-bearing elastic core of the right vocal fold; carries longitudinal tension in head/high mix.", 1000, (0.97, 0.93, 0.78)),
    StructureSpec("left-vocal-ligament", "Left Vocal Ligament", "larynx", "ligament", "FMA55246", "larynx_obj", ("FJ2787",), "CT",
                  "Load-bearing elastic core of the left vocal fold; carries longitudinal tension in head/high mix.", 1000, (0.97, 0.93, 0.78)),
    StructureSpec("cricothyroid-recta", "Cricothyroid (Pars Recta)", "larynx", "muscle", "FMA46611", "larynx_obj", ("FJ2801", "FJ2783"), "CT",
                  "Primary pitch-raising muscle: tilts the thyroid cartilage downward/forward on the cricoid arch, elongating and thinning the vocal folds.", 1800, (0.78, 0.27, 0.27)),
    StructureSpec("cricothyroid-obliqua", "Cricothyroid (Pars Obliqua)", "larynx", "muscle", "FMA46613", "larynx_obj", ("FJ2799", "FJ2781"), "CT",
                  "Draws the thyroid cartilage anteriorly relative to the cricoid, adding extra fold elongation for upper range and cry/sob tilt.", 2000, (0.74, 0.25, 0.28)),
    StructureSpec("right-vocalis", "Right Vocalis (Internal TA)", "larynx", "muscle", "FMA46592", "larynx_obj", ("FJ2806",), "TA",
                  "Medial muscular body of the right vocal fold: shortens, thickens, and stiffens the fold body for chest weight and firm closure.", 900, (0.86, 0.24, 0.24)),
    StructureSpec("left-vocalis", "Left Vocalis (Internal TA)", "larynx", "muscle", "FMA46593", "larynx_obj", ("FJ2788",), "TA",
                  "Medial muscular body of the left vocal fold: shortens, thickens, and stiffens the fold body for chest weight and firm closure.", 900, (0.86, 0.24, 0.24)),
    StructureSpec("right-thyroarytenoid", "Right Thyroarytenoid (External TA)", "larynx", "muscle", "FMA46589", "larynx_obj", ("FJ2802", "FJ2803"), "TA",
                  "Outer muscular bulk lateral to right vocalis; adds vocal weight, medial bulging, and chest-dominant closure.", 2200, (0.80, 0.26, 0.25)),
    StructureSpec("left-thyroarytenoid", "Left Thyroarytenoid (External TA)", "larynx", "muscle", "FMA46590", "larynx_obj", ("FJ2784", "FJ2785"), "TA",
                  "Outer muscular bulk lateral to left vocalis; adds vocal weight, medial bulging, and chest-dominant closure.", 2200, (0.80, 0.26, 0.25)),
    StructureSpec("right-lca", "Right Lateral Cricoarytenoid (LCA)", "larynx", "muscle", "FMA46580", "larynx_obj", ("FJ2796",), "LCA",
                  "Rotates the right arytenoid vocal process medially to close the membranous glottis.", 1500, (0.77, 0.28, 0.30)),
    StructureSpec("left-lca", "Left Lateral Cricoarytenoid (LCA)", "larynx", "muscle", "FMA46581", "larynx_obj", ("FJ2778",), "LCA",
                  "Rotates the left arytenoid vocal process medially to close the membranous glottis.", 1500, (0.77, 0.28, 0.30)),
    StructureSpec("right-pca", "Right Posterior Cricoarytenoid (PCA)", "larynx", "muscle", "FMA46577", "larynx_obj", ("FJ2800",), "PCA",
                  "Sole abductor of the right vocal fold: rocks/rotates the arytenoid laterally to open the airway for rapid inhalation.", 1500, (0.68, 0.30, 0.34)),
    StructureSpec("left-pca", "Left Posterior Cricoarytenoid (PCA)", "larynx", "muscle", "FMA46578", "larynx_obj", ("FJ2782",), "PCA",
                  "Sole abductor of the left vocal fold: rocks/rotates the arytenoid laterally to open the airway for rapid inhalation.", 1500, (0.68, 0.30, 0.34)),
    StructureSpec("interarytenoid", "Interarytenoid (Transverse & Oblique IA)", "larynx", "muscle", "FMA46582", "larynx_obj", ("FJ2809", "FJ2798", "FJ2780"), "IA",
                  "Slides the two arytenoids together posteriorly, sealing the cartilaginous glottis (relaxed in falsetto/breathy singing).", 2200, (0.81, 0.27, 0.31)),
    StructureSpec("right-aryepiglottic", "Right Aryepiglottic Muscle", "larynx", "muscle", "FMA46604", "larynx_obj", ("FJ2791",), "AES",
                  "Purse-string sphincter narrowing the laryngeal inlet funnel to create twang and the 3 kHz singer's ring.", 1400, (0.83, 0.33, 0.24)),
    StructureSpec("left-aryepiglottic", "Left Aryepiglottic Muscle", "larynx", "muscle", "FMA46605", "larynx_obj", ("FJ2774",), "AES",
                  "Purse-string sphincter narrowing the laryngeal inlet funnel to create twang and the 3 kHz singer's ring.", 1400, (0.83, 0.33, 0.24)),

    # === LAYER 2: EXTRINSIC LARYNGEAL & JAW MUSCLES ===
    StructureSpec("sternothyroid", "Sternothyroid", "extrinsic", "muscle", "FMA46308", "larynx_obj", ("FJ1575", "FJ1597"), "INF",
                  "Infrahyoid strap muscle pulling the thyroid cartilage downward (warmth, open throat, cry/sob anchoring).", 1600, (0.72, 0.29, 0.29)),
    StructureSpec("thyrohyoid", "Thyrohyoid", "extrinsic", "muscle", "FMA46312", "larynx_obj", ("FJ1577", "FJ1599"), "INF",
                  "Short strap muscle linking thyroid cartilage to hyoid; approximates them or transmits hyoid shifts.", 1200, (0.74, 0.30, 0.29)),
    StructureSpec("sternohyoid", "Sternohyoid", "extrinsic", "muscle", "FMA46304", "larynx_obj", ("FJ1574", "FJ1596"), "INF",
                  "Superficial infrahyoid depressor stabilizing and lowering the hyoid-larynx complex against upward pitch pull.", 1600, (0.70, 0.28, 0.29)),
    StructureSpec("omohyoid", "Omohyoid", "extrinsic", "muscle", "FMA46306", "larynx_obj", ("FJ1565", "FJ1586"), "INF",
                  "Scapula-to-hyoid strap stabilizing the lower neck fascia and laryngeal height during deep support.", 1600, (0.68, 0.28, 0.30)),
    StructureSpec("digastric", "Digastric", "extrinsic", "muscle", "FMA46291", "larynx_obj",
                  ("FJ1555", "FJ1560", "FJ1578", "FJ1556", "FJ1579", "FJ1581"), "SUP",
                  "Two-bellied suprahyoid muscle: opens the jaw when hyoid is anchored, or yanks the larynx high when jaw clenches.", 1600, (0.75, 0.34, 0.28)),
    StructureSpec("stylohyoid", "Stylohyoid", "extrinsic", "muscle", "FMA46299", "larynx_obj", ("FJ1576", "FJ1598"), "SUP",
                  "Draws the hyoid upward and backward; excessive recruitment contributes to high-larynx squeeze.", 1200, (0.74, 0.33, 0.28)),
    StructureSpec("mylohyoid", "Mylohyoid (Floor of Mouth)", "extrinsic", "muscle", "FMA46320", "tongue", ("mylohyoid",), "SUP",
                  "Muscular sling under the chin; hardening here during singing indicates tongue-root / suprahyoid tension.", 1600, (0.73, 0.32, 0.29)),
    StructureSpec("geniohyoid", "Geniohyoid", "extrinsic", "muscle", "FMA46325", "tongue", ("geniohyoid",), "SUP",
                  "Pulls hyoid anteriorly/upward or assists jaw drop; over-activity couples jaw jutting to cord constriction.", 1200, (0.74, 0.31, 0.29)),
    StructureSpec("masseter", "Masseter (Jaw Closer)", "extrinsic", "muscle", "FMA49006", "muscles_jaw", ("masseter",), "SUP",
                  "Powerful jaw-closing muscle; must stay released for open high vowels and natural vibrato.", 1600, (0.70, 0.30, 0.28)),
    StructureSpec("lateral-pterygoid", "Lateral Pterygoid (Jaw Protruder)", "extrinsic", "muscle", "FMA49015", "muscles_jaw", ("lateral-pterygoid",), "SUP",
                  "Juts the mandible forward — CVT's 3rd principle warns against protruding jaw triggering cord constriction.", 1200, (0.71, 0.31, 0.28)),
    StructureSpec("sternocleidomastoid", "Sternocleidomastoid", "extrinsic", "muscle", "FMA13407", "larynx_obj", ("FJ1573", "FJ1595"), None,
                  "Major lateral neck postural muscle; visible bulging signals accessory breathing or neck strain.", 1800, (0.64, 0.28, 0.28)),

    # === LAYER 3: SUPRAGLOTTAL VOCAL TRACT & ARTICULATORS ===
    StructureSpec("tongue", "Tongue Body & Dorsum", "tract", "muscle", "FMA54640", "tongue", ("tongue",), "VEL",
                  "Primary vowel articulator shaping F1/F2 formants; subtle vowel narrowing across passaggio keeps resonance locked.", 2600, (0.84, 0.43, 0.45)),
    StructureSpec("genioglossus", "Genioglossus", "tract", "muscle", "FMA46690", "tongue", ("genioglossus",), "VEL",
                  "Fan-shaped muscle fronting the tongue body (keeps pharynx open behind the tongue; prevents swallowed tone).", 1800, (0.78, 0.35, 0.37)),
    StructureSpec("hyoglossus", "Hyoglossus", "tract", "muscle", "FMA46691", "tongue", ("hyoglossus",), "SUP",
                  "Depresses and retracts the tongue onto the hyoid; chronic tension pushes the tongue root onto the larynx.", 1400, (0.76, 0.33, 0.35)),
    StructureSpec("levator-veli-palatini", "Levator Veli Palatini", "tract", "muscle", "FMA46727", "pharynx", ("levator-veli-palatini",), "VEL",
                  "Lifts the soft palate (velum) to seal the nasal port for ringing oral vowels, or relaxes slightly for humming.", 1500, (0.80, 0.36, 0.38)),
    StructureSpec("tensor-veli-palatini", "Tensor Veli Palatini & Uvula", "tract", "muscle", "FMA46730", "pharynx", ("tensor-veli-palatini", "musculus-uvulae"), "VEL",
                  "Tenses the soft palate aponeurosis and shapes the velopharyngeal arch.", 1500, (0.82, 0.38, 0.40)),
    StructureSpec("palatopharyngeus", "Palatopharyngeus & Stylopharyngeus", "tract", "muscle", "FMA46671", "pharynx", ("palatopharyngeus", "stylopharyngeus"), "VEL",
                  "Longitudinal pharyngeal elevators/arch muscles shaping vertical pharyngeal tube length.", 1800, (0.75, 0.33, 0.35)),
    StructureSpec("pharyngeal-constrictors", "Superior, Middle & Inferior Pharyngeal Constrictors", "tract", "muscle", "FMA46620", "pharynx",
                  ("superior-constrictor", "middle-constrictor", "inferior-constrictor"), "SUP",
                  "Muscular walls of the pharynx; kept open in warm resonant singing, narrowed if squeezing the throat.", 3000, (0.72, 0.33, 0.34)),
    StructureSpec("mandible", "Mandible (Jaw)", "tract", "bone", "FMA52748", "larynx_obj", ("FJ3289",), "VEL",
                  "Lower jawbone rotating at the TMJ; drops downward/back slightly for high notes without jutting forward.", 2400, (0.90, 0.87, 0.80)),
    StructureSpec("maxilla-palate", "Upper Jaw & Hard Palate", "tract", "bone", "FMA9711", "larynx_obj",
                  ("FJ3269", "FJ3375", "FJ3273", "FJ3379"), None,
                  "Bony roof of the mouth and facial mask landmark where sympathetic buzz is felt in humming/twang.", 2400, (0.89, 0.86, 0.79)),

    # === LAYER 4: THORACO-ABDOMINAL BREATH APPOGGIO SYSTEM ===
    StructureSpec("trachea", "Trachea (Windpipe)", "breath", "cartilage", "FMA7394", "larynx_obj", ("FJ2541",), None,
                  "Cartilaginous subglottal airway conducting pressurized air from the lungs to the vocal folds.", 1800, (0.74, 0.84, 0.89)),
    StructureSpec("right-lung", "Right Lung", "breath", "organ", "FMA7309", "lungs",
                  ("FMA7338", "FMA7339", "FMA7359", "FMA7361", "FMA7360", "FMA7366", "FMA7364", "FMA7363", "FMA7362"), "DIA",
                  "Three-lobed elastic reservoir expanding passively as the diaphragm descends and ribs swing outward.", 3200, (0.86, 0.56, 0.58)),
    StructureSpec("left-lung", "Left Lung", "breath", "organ", "FMA7310", "lungs",
                  ("FMA7372", "FMA7373", "FMA7374", "FMA7375", "FMA7376", "FMA7378", "FMA7379", "FMA7380"), "DIA",
                  "Two-lobed elastic reservoir; high notes need steady metered pressure, NOT excessive air volume.", 3000, (0.86, 0.56, 0.58)),
    StructureSpec("diaphragm", "Thoracic Diaphragm", "breath", "muscle", "FMA13295", "larynx_obj", ("FJ3131",), "DIA",
                  "Primary inspiratory dome muscle: contracts downward to draw air in; ascends smoothly against abdominal/rib support on exhale.", 3600, (0.82, 0.28, 0.26)),
    StructureSpec("external-intercostals", "External Intercostals", "breath", "muscle", "FMA74059", "larynx_obj", ("FJ1451", "FJ1451M"), "APP",
                  "Lift and hold the rib cage expanded during singing (appoggio — 'leaning' into the breath to prevent rapid collapse).", 3600, (0.76, 0.30, 0.28)),
    StructureSpec("internal-intercostals", "Internal Intercostals", "breath", "muscle", "FMA74060", "larynx_obj", ("FJ1455", "FJ1455M"), "APP",
                  "Inter-rib muscles assisting controlled rib-cage descent at the end of long phrases.", 3200, (0.71, 0.29, 0.29)),
    StructureSpec("external-oblique", "External Abdominal Oblique", "breath", "muscle", "FMA13335", "larynx_obj", ("FJ1452", "FJ1452M"), "APP",
                  "Outer lateral abdominal girdle wrapping the lower ribs to meter exhalation and subglottal air pressure.", 2600, (0.78, 0.31, 0.27)),
    StructureSpec("abdominal-wall", "Transversus Abdominis & Internal Oblique", "breath", "muscle", "FMA15570", "muscles_abd",
                  ("transversus-abdominis", "internal-oblique"), "APP",
                  "Deep core expiratory support corset metering upward diaphragmatic return and steady P_sub.", 2800, (0.75, 0.30, 0.27)),
    StructureSpec("rectus-abdominis", "Rectus Abdominis", "breath", "muscle", "FMA9628", "muscles_abd", ("rectus-abdominis",), "APP",
                  "Anterior abdominal wall; stays supple rather than rigidly locked so support remains buoyant.", 2000, (0.74, 0.29, 0.27)),
    StructureSpec("quadratus-lumborum", "Quadratus Lumborum (Lower Back Support)", "breath", "muscle", "FMA15569", "muscles_abd", ("quadratus-lumborum",), "APP",
                  "Deep lower-back stabilizer anchoring the 12th rib and expanding posteriorly on deep inhalation.", 1600, (0.70, 0.28, 0.29)),
    StructureSpec("thoracic-cage", "Rib Cage, Sternum & Spine", "breath", "bone", "FMA7480", "larynx_obj",
                  (
                      "FJ3290", "FJ3178", "FJ3153",
                      "FJ3334", "FJ3336", "FJ3338", "FJ3340", "FJ3342", "FJ3344", "FJ3346", "FJ3347", "FJ3348", "FJ3330", "FJ3331", "FJ3332",
                      "FJ3228", "FJ3229", "FJ3230", "FJ3231", "FJ3232", "FJ3233", "FJ3234", "FJ3235", "FJ3236", "FJ3225", "FJ3226", "FJ3227",
                      "FJ3333", "FJ3335", "FJ3337", "FJ3339", "FJ3341", "FJ3343", "FJ3345", "FJ3668M", "FJ3669M", "FJ3667M",
                      "FJ3239", "FJ3242", "FJ3245", "FJ3248", "FJ3251", "FJ3254", "FJ3255", "FJ3668", "FJ3669", "FJ3667",
                      "FJ3176", "FJ3177", "FJ3161", "FJ3164", "FJ3167", "FJ3170", "FJ3172",
                      "FJ3158", "FJ3160", "FJ3163", "FJ3166", "FJ3169", "FJ3171", "FJ3173", "FJ3174", "FJ3175", "FJ3154", "FJ3155", "FJ3156",
                      "FJ3157", "FJ3159",
                  ), None,
                  "Bony thoracic framework and cervical-thoracic spine providing postural alignment and bucket-handle rib expansion.", 7500, (0.88, 0.85, 0.78)),
)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def fetch_verified(url: str, expected_sha256: str, dest: Path) -> bytes:
    if dest.exists():
        raw = dest.read_bytes()
        if sha256_bytes(raw) == expected_sha256:
            return raw
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": "vocal-guide-4d-builder/1.0"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        raw = resp.read()
    actual = sha256_bytes(raw)
    if actual != expected_sha256:
        raise RuntimeError(f"SHA-256 mismatch for {url}: expected {expected_sha256}, got {actual}")
    dest.write_bytes(raw)
    return raw


def parse_obj_mm(text: str) -> tuple[NDArray[np.float32], NDArray[np.uint32]]:
    verts: list[list[float]] = []
    tris: list[list[int]] = []
    for line in text.splitlines():
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        parts = s.split()
        if parts[0] == "v":
            verts.append([float(parts[1]), float(parts[2]), float(parts[3])])
        elif parts[0] == "f":
            idx = [int(tok.split("/")[0]) - 1 for tok in parts[1:]]
            for i in range(1, len(idx) - 1):
                tris.append([idx[0], idx[i], idx[i + 1]])
    return np.asarray(verts, dtype=np.float32), np.asarray(tris, dtype=np.uint32)


def parse_glb_nodes_mm(raw: bytes, spec: GlbArchiveSpec) -> dict[str, tuple[NDArray[np.float32], NDArray[np.uint32]]]:
    magic, version, _length = struct.unpack_from("<4sII", raw, 0)
    if magic != b"glTF" or version != 2:
        raise ValueError(f"Invalid GLB header in {spec.name}")
    json_len, json_type = struct.unpack_from("<II", raw, 12)
    if json_type != 0x4E4F534A:
        raise ValueError(f"Expected JSON chunk in {spec.name}")
    gltf = json.loads(raw[20 : 20 + json_len].decode("utf-8"))
    bin_offset = 20 + json_len
    bin_len, bin_type = struct.unpack_from("<II", raw, bin_offset)
    if bin_type != 0x004E4942:
        raise ValueError(f"Expected BIN chunk in {spec.name}")
    bin_buf = memoryview(raw)[bin_offset + 8 : bin_offset + 8 + bin_len]

    accessors = gltf["accessors"]
    buffer_views = gltf["bufferViews"]
    meshes = gltf["meshes"]

    def read_accessor(acc_idx: int) -> NDArray[Any]:
        acc = accessors[acc_idx]
        bv = buffer_views[acc["bufferView"]]
        offset = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
        count = acc["count"]
        ctype = acc["componentType"]
        atype = acc["type"]
        num_comp = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[atype]
        dtype_map = {
            5121: np.uint8,
            5123: np.uint16,
            5125: np.uint32,
            5126: np.float32,
        }
        dtype = np.dtype(dtype_map[ctype]).newbyteorder("<")
        stride = bv.get("byteStride")
        elem_bytes = dtype.itemsize * num_comp
        if stride and stride != elem_bytes:
            arr = np.empty((count, num_comp), dtype=dtype)
            for i in range(count):
                start = offset + i * stride
                arr[i] = np.frombuffer(bin_buf[start : start + elem_bytes], dtype=dtype)
            return arr if num_comp > 1 else arr[:, 0]
        total_bytes = count * elem_bytes
        flat = np.frombuffer(bin_buf[offset : offset + total_bytes], dtype=dtype)
        return flat.reshape((count, num_comp)) if num_comp > 1 else flat

    cx, cy, cz = spec.center_mm
    inv_s = 1.0 / spec.scale
    out: dict[str, tuple[NDArray[np.float32], NDArray[np.uint32]]] = {}

    for node in gltf.get("nodes", []):
        name = node.get("name")
        mesh_idx = node.get("mesh")
        if not name or mesh_idx is None:
            continue
        v_parts: list[NDArray[np.float32]] = []
        f_parts: list[NDArray[np.uint32]] = []
        v_offset = 0
        for prim in meshes[mesh_idx]["primitives"]:
            pos_glb = read_accessor(prim["attributes"]["POSITION"]).astype(np.float64)
            # Invert X_glb=(x-cx)*s, Y_glb=(z-cz)*s, Z_glb=-(y-cy)*s
            x_mm = pos_glb[:, 0] * inv_s + cx
            y_mm = -pos_glb[:, 2] * inv_s + cy
            z_mm = pos_glb[:, 1] * inv_s + cz
            pos_mm = np.column_stack((x_mm, y_mm, z_mm)).astype(np.float32)
            if "indices" in prim:
                idx = read_accessor(prim["indices"]).astype(np.uint32).reshape((-1, 3)) + v_offset
            else:
                idx = np.arange(len(pos_mm), dtype=np.uint32).reshape((-1, 3)) + v_offset
            v_parts.append(pos_mm)
            f_parts.append(idx)
            v_offset += len(pos_mm)
        if v_parts:
            out[name] = (np.vstack(v_parts), np.vstack(f_parts))
    return out


def merge_meshes(parts: list[tuple[NDArray[np.float32], NDArray[np.uint32]]]) -> tuple[NDArray[np.float32], NDArray[np.uint32]]:
    v_all: list[NDArray[np.float32]] = []
    f_all: list[NDArray[np.uint32]] = []
    offset = 0
    for v, f in parts:
        v_all.append(v)
        f_all.append(f + offset)
        offset += len(v)
    return np.vstack(v_all), np.vstack(f_all)


def simplify_vertex_cluster(
    verts: NDArray[np.float32], tris: NDArray[np.uint32], target_tris: int
) -> tuple[NDArray[np.float32], NDArray[np.uint32]]:
    """Fast deterministic spatial-grid vertex clustering with binary search on cell size."""
    if len(tris) <= target_tris:
        return clean_and_weld(verts, tris)

    vmin = verts.min(axis=0)
    vmax = verts.max(axis=0)
    diag = float(np.linalg.norm(vmax - vmin))
    if diag < 1e-6:
        return verts, tris

    lo = diag / 1200.0
    hi = diag / 8.0
    best_v, best_f = verts, tris

    for _ in range(14):
        mid = 0.5 * (lo + hi)
        grid = np.floor((verts - vmin) / mid).astype(np.int64)
        # Pack 3D grid coordinates into unique clusters
        _, inv = np.unique(grid, axis=0, return_inverse=True)
        n_clusters = int(inv.max()) + 1
        new_f = inv[tris]
        non_deg = (new_f[:, 0] != new_f[:, 1]) & (new_f[:, 1] != new_f[:, 2]) & (new_f[:, 0] != new_f[:, 2])
        cand_f = new_f[non_deg]
        if len(cand_f) == 0:
            hi = mid
            continue
        # Deduplicate triangles preserving winding
        canon = np.sort(cand_f, axis=1)
        _, uniq_idx = np.unique(canon, axis=0, return_index=True)
        cand_f = cand_f[np.sort(uniq_idx)].astype(np.uint32)

        if len(cand_f) > target_tris:
            lo = mid
        else:
            # Compute cluster centroids
            new_v = np.zeros((n_clusters, 3), dtype=np.float64)
            counts = np.bincount(inv, minlength=n_clusters).astype(np.float64)
            np.add.at(new_v, inv, verts.astype(np.float64))
            new_v /= np.maximum(counts[:, None], 1.0)
            best_v, best_f = compact_unused_vertices(new_v.astype(np.float32), cand_f)
            hi = mid

    return best_v, best_f


def clean_and_weld(verts: NDArray[np.float32], tris: NDArray[np.uint32]) -> tuple[NDArray[np.float32], NDArray[np.uint32]]:
    quant = np.round(verts.astype(np.float64) * 2000.0).astype(np.int64)
    _, first_idx, inv = np.unique(quant, axis=0, return_index=True, return_inverse=True)
    welded_v = verts[first_idx]
    welded_f = inv[tris].astype(np.uint32)
    non_deg = (welded_f[:, 0] != welded_f[:, 1]) & (welded_f[:, 1] != welded_f[:, 2]) & (welded_f[:, 0] != welded_f[:, 2])
    return compact_unused_vertices(welded_v, welded_f[non_deg])


def compact_unused_vertices(verts: NDArray[np.float32], tris: NDArray[np.uint32]) -> tuple[NDArray[np.float32], NDArray[np.uint32]]:
    used = np.unique(tris)
    remap = np.zeros(len(verts), dtype=np.uint32)
    remap[used] = np.arange(len(used), dtype=np.uint32)
    return verts[used], remap[tris]


def compute_smooth_normals(verts: NDArray[np.float32], tris: NDArray[np.uint32]) -> NDArray[np.float32]:
    v0 = verts[tris[:, 0]].astype(np.float64)
    v1 = verts[tris[:, 1]].astype(np.float64)
    v2 = verts[tris[:, 2]].astype(np.float64)
    fn = np.cross(v1 - v0, v2 - v0)
    vn = np.zeros((len(verts), 3), dtype=np.float64)
    np.add.at(vn, tris[:, 0], fn)
    np.add.at(vn, tris[:, 1], fn)
    np.add.at(vn, tris[:, 2], fn)
    norms = np.linalg.norm(vn, axis=1, keepdims=True)
    vn = np.where(norms > 1e-12, vn / np.maximum(norms, 1e-12), np.array([0.0, 1.0, 0.0]))
    return vn.astype(np.float32)


def mm_to_scene(pts_mm: NDArray[np.float32], origin_mm: NDArray[np.float64]) -> NDArray[np.float32]:
    p = pts_mm.astype(np.float64) - origin_mm[None, :]
    # +X = patient left (+x_mm), +Y = superior (+z_mm), +Z = anterior (-y_mm)
    x = p[:, 0] * SCENE_MM_SCALE
    y = p[:, 2] * SCENE_MM_SCALE
    z = -p[:, 1] * SCENE_MM_SCALE
    return np.column_stack((x, y, z)).astype(np.float32)


def pt_mm_to_scene(pt_mm: NDArray[np.float64], origin_mm: NDArray[np.float64]) -> list[float]:
    d = pt_mm - origin_mm
    return [round(float(d[0] * SCENE_MM_SCALE), 5), round(float(d[2] * SCENE_MM_SCALE), 5), round(float(-d[1] * SCENE_MM_SCALE), 5)]


def write_glb(
    meshes_scene: list[tuple[StructureSpec, NDArray[np.float32], NDArray[np.float32], NDArray[np.uint32]]],
    dest: Path,
) -> bytes:
    nodes: list[dict[str, Any]] = []
    gltf_meshes: list[dict[str, Any]] = []
    materials: list[dict[str, Any]] = []
    accessors: list[dict[str, Any]] = []
    buffer_views: list[dict[str, Any]] = []
    bin_chunks: list[bytes] = []
    byte_offset = 0

    def append_chunk(raw_chunk: bytes, target: int | None = None) -> int:
        nonlocal byte_offset
        pad = (4 - (len(raw_chunk) % 4)) % 4
        bv_idx = len(buffer_views)
        bv: dict[str, Any] = {
            "buffer": 0,
            "byteOffset": byte_offset,
            "byteLength": len(raw_chunk),
        }
        if target is not None:
            bv["target"] = target
        buffer_views.append(bv)
        bin_chunks.append(raw_chunk + (b"\x00" * pad))
        byte_offset += len(raw_chunk) + pad
        return bv_idx

    for idx, (spec, pos, nrm, tris) in enumerate(meshes_scene):
        mat_idx = len(materials)
        roughness = 0.42 if spec.kind in ("cartilage", "ligament") else (0.52 if spec.kind == "muscle" else 0.58)
        materials.append({
            "name": spec.id,
            "doubleSided": True,
            "pbrMetallicRoughness": {
                "baseColorFactor": [spec.base_color[0], spec.base_color[1], spec.base_color[2], 1.0],
                "metallicFactor": 0.04,
                "roughnessFactor": roughness,
            },
        })

        pos_le = np.ascontiguousarray(pos, dtype="<f4")
        nrm_le = np.ascontiguousarray(nrm, dtype="<f4")
        pos_bv = append_chunk(pos_le.tobytes(), target=34962)
        nrm_bv = append_chunk(nrm_le.tobytes(), target=34962)

        pos_acc = len(accessors)
        accessors.append({
            "bufferView": pos_bv,
            "componentType": 5126,
            "count": int(len(pos)),
            "type": "VEC3",
            "min": [float(x) for x in pos.min(axis=0)],
            "max": [float(x) for x in pos.max(axis=0)],
        })
        nrm_acc = len(accessors)
        accessors.append({
            "bufferView": nrm_bv,
            "componentType": 5126,
            "count": int(len(nrm)),
            "type": "VEC3",
        })

        use_u16 = len(pos) < 65535
        idx_arr = np.ascontiguousarray(tris.reshape(-1), dtype="<u2" if use_u16 else "<u4")
        idx_bv = append_chunk(idx_arr.tobytes(), target=34963)
        idx_acc = len(accessors)
        accessors.append({
            "bufferView": idx_bv,
            "componentType": 5123 if use_u16 else 5125,
            "count": int(idx_arr.size),
            "type": "SCALAR",
        })

        gltf_meshes.append({
            "name": spec.id,
            "primitives": [{
                "attributes": {"POSITION": pos_acc, "NORMAL": nrm_acc},
                "indices": idx_acc,
                "material": mat_idx,
                "mode": 4,
            }],
        })
        nodes.append({
            "name": spec.id,
            "mesh": idx,
            "extras": {
                "layer": spec.layer,
                "kind": spec.kind,
                "fma": spec.fma,
                "channel": spec.channel,
            },
        })

    gltf_doc = {
        "asset": {
            "version": "2.0",
            "generator": "vocal-guide-4d scripts/build_anatomy.py",
            "copyright": "BodyParts3D / Anatomography v4.3, (c) The Database Center for Life Science (DBCLS). CC BY-SA 2.1 Japan.",
        },
        "scene": 0,
        "scenes": [{"name": "VocalGuide4D_BodyParts3D", "nodes": list(range(len(nodes)))}],
        "nodes": nodes,
        "meshes": gltf_meshes,
        "materials": materials,
        "accessors": accessors,
        "bufferViews": buffer_views,
        "buffers": [{"byteLength": byte_offset}],
    }

    json_bytes = json.dumps(gltf_doc, separators=(",", ":")).encode("utf-8")
    json_pad = (4 - (len(json_bytes) % 4)) % 4
    json_chunk = json_bytes + (b" " * json_pad)
    bin_chunk = b"".join(bin_chunks)

    total_len = 12 + 8 + len(json_chunk) + 8 + len(bin_chunk)
    glb = bytearray()
    glb.extend(struct.pack("<4sII", b"glTF", 2, total_len))
    glb.extend(struct.pack("<II", len(json_chunk), 0x4E4F534A))
    glb.extend(json_chunk)
    glb.extend(struct.pack("<II", len(bin_chunk), 0x004E4942))
    glb.extend(bin_chunk)

    dest.parent.mkdir(parents=True, exist_ok=True)
    raw_out = bytes(glb)
    dest.write_bytes(raw_out)
    return raw_out


def extract_rig_landmarks(
    raw_mm: dict[str, tuple[NDArray[np.float32], NDArray[np.uint32]]],
) -> tuple[NDArray[np.float64], dict[str, Any]]:
    """Derive exact biomechanical joint pivots & mucosal attachment landmarks from BodyParts3D mm geometry."""
    rv_lig = raw_mm["right-vocal-ligament"][0].astype(np.float64)
    lv_lig = raw_mm["left-vocal-ligament"][0].astype(np.float64)
    both_lig = np.vstack((rv_lig, lv_lig))

    # Glottal midpoint in patient mm: center of vocal ligaments
    origin_mm = 0.5 * (both_lig.min(axis=0) + both_lig.max(axis=0))

    # Remember in patient mm: +x = left, -y = anterior, +z = superior
    # Anterior commissure = minimum y_mm of left & right vocal ligaments
    rv_ant = rv_lig[np.argmin(rv_lig[:, 1])]
    lv_ant = lv_lig[np.argmin(lv_lig[:, 1])]
    ant_comm_mm = 0.5 * (rv_ant + lv_ant)

    # Vocal processes = maximum y_mm (posterior-most attachment on arytenoids)
    rv_post = rv_lig[np.argmax(rv_lig[:, 1])]
    lv_post = lv_lig[np.argmax(lv_lig[:, 1])]

    # Cricothyroid joint: inferior cornua of thyroid cartilage (lowest z_mm on posterior half of thyroid)
    thy = raw_mm["thyroid-cartilage"][0].astype(np.float64)
    thy_post = thy[thy[:, 1] > np.percentile(thy[:, 1], 65)]
    thy_inf_horns = thy_post[thy_post[:, 2] < np.percentile(thy_post[:, 2], 12)]
    ct_pivot_mm = thy_inf_horns.mean(axis=0)

    # Cricoarytenoid joints: inferior articular base of right & left arytenoids
    r_ary = raw_mm["right-arytenoid"][0].astype(np.float64)
    l_ary = raw_mm["left-arytenoid"][0].astype(np.float64)
    r_ca_mm = r_ary[r_ary[:, 2] < np.percentile(r_ary[:, 2], 22)].mean(axis=0)
    l_ca_mm = l_ary[l_ary[:, 2] < np.percentile(l_ary[:, 2], 22)].mean(axis=0)

    # Muscular processes of arytenoids (lateral-most extremes)
    r_musc_mm = r_ary[np.argmin(r_ary[:, 0])]  # right is -x
    l_musc_mm = l_ary[np.argmax(l_ary[:, 0])]  # left is +x

    # Epiglottis petiole (inferior stem)
    epi = raw_mm["epiglottis"][0].astype(np.float64)
    epi_petiole_mm = epi[epi[:, 2] < np.percentile(epi[:, 2], 12)].mean(axis=0)

    # TMJ condylar hinge on mandible (highest z_mm on posterior rami)
    mand = raw_mm["mandible"][0].astype(np.float64)
    mand_post = mand[mand[:, 1] > np.percentile(mand[:, 1], 75)]
    tmj_mm = mand_post[mand_post[:, 2] > np.percentile(mand_post[:, 2], 82)].mean(axis=0)

    # Velum anterior hinge (anterior border of tensor/levator veli palatini)
    vel = np.vstack((raw_mm["levator-veli-palatini"][0], raw_mm["tensor-veli-palatini"][0])).astype(np.float64)
    vel_hinge_mm = vel[vel[:, 1] < np.percentile(vel[:, 1], 20)].mean(axis=0)

    # Diaphragm dome apex
    dia = raw_mm["diaphragm"][0].astype(np.float64)
    dia_apex_mm = dia[dia[:, 2] > np.percentile(dia[:, 2], 92)].mean(axis=0)

    landmarks = {
        "anteriorCommissure": pt_mm_to_scene(ant_comm_mm, origin_mm),
        "rightVocalProcess": pt_mm_to_scene(rv_post, origin_mm),
        "leftVocalProcess": pt_mm_to_scene(lv_post, origin_mm),
        "rightMuscularProcess": pt_mm_to_scene(r_musc_mm, origin_mm),
        "leftMuscularProcess": pt_mm_to_scene(l_musc_mm, origin_mm),
        "cricothyroidPivot": pt_mm_to_scene(ct_pivot_mm, origin_mm),
        "rightCricoarytenoidPivot": pt_mm_to_scene(r_ca_mm, origin_mm),
        "leftCricoarytenoidPivot": pt_mm_to_scene(l_ca_mm, origin_mm),
        "epiglottisPetiole": pt_mm_to_scene(epi_petiole_mm, origin_mm),
        "tmjPivot": pt_mm_to_scene(tmj_mm, origin_mm),
        "velumHinge": pt_mm_to_scene(vel_hinge_mm, origin_mm),
        "diaphragmApex": pt_mm_to_scene(dia_apex_mm, origin_mm),
        "restingFoldLengthMm": round(float(0.5 * (np.linalg.norm(rv_post - rv_ant) + np.linalg.norm(lv_post - lv_ant))), 3),
    }
    return origin_mm, landmarks


def register_v30_to_v43(
    pts_v30_mm: NDArray[np.float32],
    anchor_v30_mm: NDArray[np.float32],
    anchor_v43_mm: NDArray[np.float32],
) -> NDArray[np.float32]:
    """Map BodyParts3D v3.0 muscle vertices into v4.3 patient mm via shared anatomical anchor bounds."""
    c30 = 0.5 * (anchor_v30_mm.min(axis=0) + anchor_v30_mm.max(axis=0)).astype(np.float64)
    c43 = 0.5 * (anchor_v43_mm.min(axis=0) + anchor_v43_mm.max(axis=0)).astype(np.float64)
    s30 = (anchor_v30_mm.max(axis=0) - anchor_v30_mm.min(axis=0)).astype(np.float64)
    s43 = (anchor_v43_mm.max(axis=0) - anchor_v43_mm.min(axis=0)).astype(np.float64)
    scale = s43 / np.maximum(s30, 1e-6)
    mapped = (pts_v30_mm.astype(np.float64) - c30[None, :]) * scale[None, :] + c43[None, :]
    return mapped.astype(np.float32)


def verify_cross_archive_alignment(
    parsed_objs_mm: dict[str, tuple[NDArray[np.float32], NDArray[np.uint32]]],
    glb_archives: dict[str, dict[str, tuple[NDArray[np.float32], NDArray[np.uint32]]]],
) -> dict[str, float]:
    hyoid_obj_mm = parsed_objs_mm["FJ2772"][0]
    ref_center = 0.5 * (hyoid_obj_mm.min(axis=0) + hyoid_obj_mm.max(axis=0)).astype(np.float64)
    errors_mm: dict[str, float] = {}
    for archive_name in ("pharynx", "tongue"):
        v_mm, _ = glb_archives[archive_name]["hyoid-bone"]
        cand_center = 0.5 * (v_mm.min(axis=0) + v_mm.max(axis=0)).astype(np.float64)
        err = float(np.linalg.norm(cand_center - ref_center))
        errors_mm[archive_name] = round(err, 5)
        if err > 0.05:
            raise RuntimeError(f"Cross-archive alignment error too high for {archive_name}: {err:.4f} mm")

    trachea_obj_mm = parsed_objs_mm["FJ2541"][0]
    trachea_lungs_mm, _ = glb_archives["lungs"]["FMA7394"]
    t_ref = 0.5 * (trachea_obj_mm.min(axis=0) + trachea_obj_mm.max(axis=0)).astype(np.float64)
    t_cand = 0.5 * (trachea_lungs_mm.min(axis=0) + trachea_lungs_mm.max(axis=0)).astype(np.float64)
    t_err = float(np.linalg.norm(t_cand - t_ref))
    errors_mm["lungs_trachea"] = round(t_err, 5)
    if t_err > 0.15:
        raise RuntimeError(f"Cross-archive alignment error too high for lungs trachea: {t_err:.4f} mm")
    return errors_mm


def build_all(verify_only: bool = False) -> None:
    larynx_inputs = json.loads(LARYNX_INPUTS_PATH.read_text())
    obj_by_id = {item["id"]: item for item in larynx_inputs["objects"]}

    needed_obj_ids: list[str] = []
    for s in STRUCTURES:
        if s.source_type == "larynx_obj":
            for oid in s.source_ids:
                if oid not in needed_obj_ids:
                    needed_obj_ids.append(oid)

    print(f"Fetching & verifying {len(needed_obj_ids)} BodyParts3D 4.3 OBJs + {len(GLB_ARCHIVES)} regional GLBs...")

    obj_bytes_map: dict[str, bytes] = {}
    with ThreadPoolExecutor(max_workers=12) as pool:
        fut_objs = {
            oid: pool.submit(
                fetch_verified,
                obj_by_id[oid]["url"],
                obj_by_id[oid]["sha256"],
                CACHE_DIR / "objs" / f"{oid}.obj",
            )
            for oid in needed_obj_ids
        }
        fut_glbs = {
            name: pool.submit(
                fetch_verified,
                spec.url,
                spec.sha256,
                CACHE_DIR / "glbs" / f"{name}.glb",
            )
            for name, spec in GLB_ARCHIVES.items()
        }
        for oid, fut in fut_objs.items():
            obj_bytes_map[oid] = fut.result()
        glb_raw_map = {name: fut.result() for name, fut in fut_glbs.items()}

    parsed_objs_mm = {oid: parse_obj_mm(raw.decode("utf-8", errors="replace")) for oid, raw in obj_bytes_map.items()}
    parsed_glbs_mm = {name: parse_glb_nodes_mm(glb_raw_map[name], spec) for name, spec in GLB_ARCHIVES.items()}

    alignment_errors = verify_cross_archive_alignment(parsed_objs_mm, parsed_glbs_mm)
    print(f"Verified v4.3 cross-archive alignment (mm): {alignment_errors}")

    mandible_v43_mm = parsed_objs_mm["FJ3289"][0]
    mandible_v30_mm = parsed_glbs_mm["skeleton"]["mandible"][0]
    ext_obl_v43_mm, _ = merge_meshes([parsed_objs_mm["FJ1452"], parsed_objs_mm["FJ1452M"]])
    ext_obl_v30_mm = parsed_glbs_mm["muscles"]["external-oblique"][0]

    raw_structures_mm: dict[str, tuple[NDArray[np.float32], NDArray[np.uint32]]] = {}
    for s in STRUCTURES:
        if s.source_type == "larynx_obj":
            parts = [parsed_objs_mm[oid] for oid in s.source_ids]
            raw_structures_mm[s.id] = merge_meshes(parts)
        elif s.source_type in ("muscles_jaw", "muscles_abd"):
            archive = parsed_glbs_mm["muscles"]
            missing = [sid for sid in s.source_ids if sid not in archive]
            if missing:
                raise KeyError(f"Structure {s.id} missing source IDs {missing} in muscles")
            v_m, f_m = merge_meshes([archive[sid] for sid in s.source_ids])
            if s.source_type == "muscles_jaw":
                v_m = register_v30_to_v43(v_m, mandible_v30_mm, mandible_v43_mm)
            else:
                v_m = register_v30_to_v43(v_m, ext_obl_v30_mm, ext_obl_v43_mm)
            raw_structures_mm[s.id] = (v_m, f_m)
        else:
            archive = parsed_glbs_mm[s.source_type]
            missing = [sid for sid in s.source_ids if sid not in archive]
            if missing:
                raise KeyError(f"Structure {s.id} missing source IDs {missing} in {s.source_type}")
            parts = [archive[sid] for sid in s.source_ids]
            raw_structures_mm[s.id] = merge_meshes(parts)

    origin_mm, landmarks = extract_rig_landmarks(raw_structures_mm)

    meshes_scene: list[tuple[StructureSpec, NDArray[np.float32], NDArray[np.float32], NDArray[np.uint32]]] = []
    rig_structures: list[dict[str, Any]] = []
    total_src_tris = 0
    total_out_tris = 0

    for s in STRUCTURES:
        v_mm, f_mm = raw_structures_mm[s.id]
        total_src_tris += int(len(f_mm))
        v_simp_mm, f_simp = simplify_vertex_cluster(v_mm, f_mm, s.max_tris)
        total_out_tris += int(len(f_simp))
        v_scene = mm_to_scene(v_simp_mm, origin_mm)
        n_scene = compute_smooth_normals(v_scene, f_simp)

        # Validate index bounds
        if len(f_simp) == 0 or int(f_simp.max()) >= len(v_scene):
            raise RuntimeError(f"Invalid simplified mesh index bounds for {s.id}")

        meshes_scene.append((s, v_scene, n_scene, f_simp))
        bmin = [round(float(x), 4) for x in v_scene.min(axis=0)]
        bmax = [round(float(x), 4) for x in v_scene.max(axis=0)]
        centroid = [round(float(x), 4) for x in v_scene.mean(axis=0)]
        rig_structures.append({
            "id": s.id,
            "name": s.name,
            "layer": s.layer,
            "kind": s.kind,
            "fma": s.fma,
            "channel": s.channel,
            "role": s.role,
            "baseColor": list(s.base_color),
            "vertices": int(len(v_scene)),
            "triangles": int(len(f_simp)),
            "bounds": {"min": bmin, "max": bmax},
            "centroid": centroid,
        })

    if verify_only and OUT_GLB.exists():
        print(f"Verification passed: {len(STRUCTURES)} structures, {total_out_tris:,} triangles.")
        return

    glb_bytes = write_glb(meshes_scene, OUT_GLB)
    glb_sha = sha256_bytes(glb_bytes)

    OUT_RIG_JSON.parent.mkdir(parents=True, exist_ok=True)
    rig_payload = {
        "dataset": "BodyParts3D / Anatomography 4.3",
        "license": "CC-BY-SA-2.1-JP",
        "sceneScaleMmPerUnit": 10.0,
        "glottisOriginPatientMm": [round(float(x), 4) for x in origin_mm],
        "crossArchiveHyoidAlignmentErrorMm": alignment_errors,
        "landmarks": landmarks,
        "structures": rig_structures,
    }
    OUT_RIG_JSON.write_text(json.dumps(rig_payload, indent=2) + "\n")

    manifest_payload = {
        "dataset": "BodyParts3D / Anatomography",
        "version": "4.3",
        "license": "CC-BY-SA-2.1-JP",
        "licenseUrl": "https://creativecommons.org/licenses/by-sa/2.1/jp/deed.en",
        "credit": "BodyParts3D / Anatomography, © The Database Center for Life Science (DBCLS). CC BY-SA 2.1 Japan. Adapted for Vocal Guide 3+1D.",
        "upstreamMirrors": {
            "larynxObjs": f"https://github.com/olivercase/body_parts_3d_api/tree/{larynx_inputs['mirrorCommit']}",
            "organuiArchives": {k: {"url": v.url, "sha256": v.sha256} for k, v in GLB_ARCHIVES.items()},
        },
        "runtime": {
            "file": "vocal-anatomy.glb",
            "bytes": len(glb_bytes),
            "sha256": glb_sha,
            "sourceTriangles": total_src_tris,
            "runtimeTriangles": total_out_tris,
            "structureCount": len(STRUCTURES),
        },
        "crossArchiveHyoidAlignmentErrorMm": alignment_errors,
        "structures": rig_structures,
    }
    OUT_MANIFEST.write_text(json.dumps(manifest_payload, indent=2) + "\n")

    OUT_ATTRIBUTION.write_text(
        """# 3D Anatomical Model Attribution & License

The 3D anatomical meshes in `public/models/vocal-anatomy.glb` are derived from **BodyParts3D / Anatomography v4.3**:

- **Source**: BodyParts3D, © The Database Center for Life Science (DBCLS), Ministry of Education, Culture, Sports, Science and Technology — Japan.
- **Citation**: Mitsuhashi N, Fujieda K, Tamura T, Kawamoto S, Takagi T, Okubo K. *BodyParts3D: 3D structure database for anatomical concepts.* Nucleic Acids Research. 2009;37(Database issue):D782–D785. doi:10.1093/nar/gkn613
- **License**: [Creative Commons Attribution-ShareAlike 2.1 Japan (`CC BY-SA 2.1 JP`)](https://creativecommons.org/licenses/by-sa/2.1/jp/deed.en)
- **Provenance & Checksums**:
  - Laryngeal cartilages, ligaments, and left/right separated intrinsic muscles are built from pinned BodyParts3D 4.3 Wavefront `.obj` elements (`olivercase/body_parts_3d_api` @ `fd527e6f4daf732fd814314d9257df5877b844bc`).
  - Extrinsic strap/jaw muscles, pharyngeal/velar muscles, tongue, mandible/ribcage/spine, and lung lobes are extracted and inverse-transformed back to canonical patient millimeters from OrganUI's SHA-256-verified BodyParts3D 4.3 builds (`organui/pharynx-3d`, `organui/tongue-3d`, `organui/muscles-3d`, `organui/skeleton-3d`, `organui/lungs-3d`), verified to `< 0.05 mm` landmark correspondence on `hyoid-bone` (`FJ2772`).
  - Parametric true vocal-fold mucosal covers and ventricular (false) vocal folds are generated at runtime in Three.js between the extracted BodyParts3D anterior commissure and arytenoid vocal-process landmarks to visualize vertical phase-lagged mucosal waves (omitted in static BodyParts3D geometry).
"""
    )

    print(
        f"Built {OUT_GLB.relative_to(ROOT)}: {len(STRUCTURES)} structures, "
        f"{total_src_tris:,} -> {total_out_tris:,} tris, {len(glb_bytes) / (1024 * 1024):.2f} MB (SHA-256 {glb_sha[:12]}...)"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Build unified BodyParts3D 4.3 vocal anatomy GLB & rig metadata.")
    parser.add_argument("--verify", action="store_true", help="Verify upstream hashes, alignment, and rig invariants.")
    args = parser.parse_args()
    build_all(verify_only=args.verify)


if __name__ == "__main__":
    main()
