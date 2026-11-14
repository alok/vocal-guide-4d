# 3D Anatomical Model Attribution & License

The 3D anatomical meshes in `public/models/vocal-anatomy.glb` are derived from **BodyParts3D / Anatomography v4.3**:

- **Source**: BodyParts3D, © The Database Center for Life Science (DBCLS), Ministry of Education, Culture, Sports, Science and Technology — Japan.
- **Citation**: Mitsuhashi N, Fujieda K, Tamura T, Kawamoto S, Takagi T, Okubo K. *BodyParts3D: 3D structure database for anatomical concepts.* Nucleic Acids Research. 2009;37(Database issue):D782–D785. doi:10.1093/nar/gkn613
- **License**: [Creative Commons Attribution-ShareAlike 2.1 Japan (`CC BY-SA 2.1 JP`)](https://creativecommons.org/licenses/by-sa/2.1/jp/deed.en)
- **Provenance & Checksums**:
  - Laryngeal cartilages, ligaments, and left/right separated intrinsic muscles are built from pinned BodyParts3D 4.3 Wavefront `.obj` elements (`olivercase/body_parts_3d_api` @ `fd527e6f4daf732fd814314d9257df5877b844bc`).
  - Extrinsic strap/jaw muscles, pharyngeal/velar muscles, tongue, mandible/ribcage/spine, and lung lobes are extracted and inverse-transformed back to canonical patient millimeters from OrganUI's SHA-256-verified BodyParts3D 4.3 builds (`organui/pharynx-3d`, `organui/tongue-3d`, `organui/muscles-3d`, `organui/skeleton-3d`, `organui/lungs-3d`), verified to `< 0.05 mm` landmark correspondence on `hyoid-bone` (`FJ2772`).
  - Parametric true vocal-fold mucosal covers and ventricular (false) vocal folds are generated at runtime in Three.js between the extracted BodyParts3D anterior commissure and arytenoid vocal-process landmarks to visualize vertical phase-lagged mucosal waves (omitted in static BodyParts3D geometry).
