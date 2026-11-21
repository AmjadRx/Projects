# Sky data: sources and credits

The sky behind every public page is drawn from real data: a star catalogue, the official star names,
and an all-sky photograph of the Milky Way. This file lists each source, the exact file downloaded,
its licence or terms as read on 2026-11-18 on its official page (or, where that page could not
be read that day, in the archived copy named with it), what was changed, and the credit the footer
prints. It is written by `scripts/build-sky.mjs`.

## Stars: the Yale Bright Star Catalogue

- Title: The Bright Star Catalogue, 5th Revised Ed. (Preliminary Version), CDS VizieR catalogue V/50.
- Authors: Dorrit Hoffleit (Yale University) and Wayne H. Warren Jr. (NASA Goddard Space Flight
  Center, National Space Science Data Center).
- Edition: 5th revised edition, Astronomical Data Center, NSSDC/ADC, 1991 (bibcode
  1991bsc..book.....H); distributed by CDS, Strasbourg, through VizieR.
- Downloaded on 2026-11-18:
  - https://vizier.cfa.harvard.edu/ftp/cats/V/50/catalog.gz (the CDS VizieR mirror at the Center for Astrophysics, Harvard and Smithsonian), 573921 bytes, SHA-256 3dc44b1e90be8fbe5bcc7656032560f51275f985c7e3f783c9028e1838ec7bed
    (uncompressed catalogue: SHA-256 69797549cc1605aad7ff94e9325e29a1661f2a253917faaa056d9bf20b809afd)
  - https://vizier.cfa.harvard.edu/ftp/cats/V/50/notes.gz (the CDS VizieR mirror at the Center for Astrophysics, Harvard and Smithsonian), 161634 bytes, SHA-256 d489d8ceaead65b0af8bce36f2421886782bbe953ecf76b08bc3fd4b84df1405
    (uncompressed remarks: SHA-256 4614517ebb689fdf6e200d2ce7308b111c92272b8d5f7e492c86ec36777f6a0c)
  - https://vizier.cfa.harvard.edu/ftp/cats/V/50/ReadMe (the CDS VizieR mirror at the Center for Astrophysics, Harvard and Smithsonian), 11571 bytes, SHA-256 44fd9c73e2eecad0beb47bdfa3f01c60fd43f93d6964198e31fcd48732de5b33
- Terms: CDS, General Terms and Conditions of the CDS web sites, mirror sites included
  (https://cds.unistra.fr/legals/, last updated January 7, 2026, read 2026-11-18):
  > "All Users must comply with the User licence specific to each Dataset."
  >
  > "The Data Sets must be cited in any work or product that uses them by including - if available -
  > the DOI (Digital Object Identifier), as well as the source by mentioning the CDS service that
  > supplied them [...] and at least: "CDS/SIMBAD", "CDS/VizieR", "CDS/Aladin"."
  >
  > "Datasets containing only Public Information are distributed under an Open Licence or ODbL (see:
  > https://www.data.gouv.fr/licences) or CC-BY."
  >
  > "Datasets subject to a specific licence from the data Contributor are distributed in accordance
  > with the licence rights. This specific licence is provided on the Dataset page."
- Licence of V/50 itself: none is stated. Its ReadMe holds no copyright or licence statement, and the
  catalogue's page at CDS (https://cdsarc.cds.unistra.fr/viz-bin/cat/V/50) lists no licence in the
  copy archived on 2026-10-19. On 2026-11-18 neither that page nor the VizieR rules of usage
  (https://cds.unistra.fr/vizier-org/licences_vizier.html, which CDS names as the rights statement of
  its catalogues) could be read: the archive host did not answer, and the rules page answered "This
  page is currently unavailable". The rules' archived copy of 2026-10-25 reads: "The data retrieved
  with VizieR are free of usage in a scientific context", "The commercial usage of the data is
  subject to rules depending of the origin", and, for data from other producers, "Please refer to
  the ReadMe file associated to the catalogue to verify if a "copyright" exists."
- Citation: Hoffleit D., Warren Jr W.H., 1991, The Bright Star Catalogue, 5th Revised Ed., VizieR
  Online Data Catalog V/50, CDS/VizieR.
- Changed: reduced to the 9,096 entries that are stars with positions (the 14 others are
  novae, star clusters and one galaxy, kept in the catalogue only for their numbers), and to six
  fields per star: right ascension and declination (J2000), V magnitude, B-V, parallax and HR
  number. Positions are quantized to 0.31 arcsec steps
  (the catalogue gives about 1 arcsec); V, B-V and parallax keep the catalogue's own steps. The
  310 stars without B-V get the median B-V of the catalogue stars of the same spectral class and subclass, for example K5 (310 stars); these
  estimates are flagged. The 164 negative trigonometric parallaxes are stored as unknown (0). One
  star takes its values from the catalogue's remarks instead of its main table: T CrB (HR 5958,
  the "Blaze Star"), a recurrent nova that the main table lists at its 1946 outburst maximum
  (V 2.0, B-V +0.1), gets the values its remark gives near its usual brightness
  (V 9.88, B-V +1.40), so it does not shine as a second-magnitude star the sky does not show.
  Sorted brightest first and written in the binary format of `lib/sky/stars.ts` (`stars.bin`,
  109,164 bytes).
- Footer credit: "Stars: Yale Bright Star Catalogue (Hoffleit and Warren)."

## Star names: the IAU Catalog of Star Names

- Title: IAU Catalog of Star Names (IAU-CSN), the list of star names adopted by the International
  Astronomical Union.
- Authors: the IAU Division C Working Group on Star Names (WGSN).
- Edition: the living catalogue as published on 2026-11-18; its newest adoption in the copy used is
  dated 2026-10-15. The IAU's announcement of new star names of 12 February 2026
  (https://iau.org/IAU/News/Ann2026/New-Star-Names-2026.aspx) links this page as the "IAU Star Names
  Catalog".
- Downloaded on 2026-11-18: https://exopla.net/star-names/modern-iau-star-names/, 712257 bytes, SHA-256 b768121ea228ce9d9f0622a2aeb814228161cf814a9dda447960a08c979e6c55 (the page as served
  that day; the page changes as names are added).
- Terms, from the same page, section "CSN Usage (Credits)", read 2026-11-18:
  > "IAU-star names are free to use and not subject to copyright or intellectual property licensing;
  > they are scientific standards (like the unit of measure “meter” or “light-year”), belong to the public
  > domain and are not owned by anybody (neither the IAU nor WGSN). As long as you simply use them to
  > label a star map or write a research paper in English, these are the official names"
  The same section asks for a Creative Commons licence only for the WGSN's texts and images on the
  names' history; none of those are used here.
- Changed: only the names are used, joined to the catalogue by HR or HD number (confirmed by the
  position the page gives) or, for the 15 stars the page designates otherwise (as "* alf Cru"),
  by position, to the brightest catalogue star within 1 arcmin. In 13 rows the page writes right
  ascension with minutes of time read as arcminutes; the join allows for that. 496 names match a
  catalogue star; the names of the 150 brightest of those stars are kept, spelled as published (column
  "proper names"), in `names.json`, keyed by the star's index in `stars.bin`. A star without an
  IAU name has no entry and no label.
- Footer credit: none is required; the names are credited here.

## Milky Way: the ESO all-sky panorama

- Title: The Milky Way panorama (eso0932a), the first image of ESO's GigaGalaxy Zoom project,
  released 14 September 2009.
- Author: Serge Brunier, for ESO. Credit line, as the image page gives it: "ESO/S. Brunier".
- Edition: the 18-million-pixel release on ESO's site, 6000 x 3000 px, in galactic coordinates
  (plate carree, the galactic centre in the middle, longitude increasing to the left), as the image
  page offers it as "Large JPEG", the largest of its JPEG files. Image page:
  https://www.eso.org/public/images/eso0932a/
- Downloaded on 2026-11-18: https://cdn.eso.org/images/large/eso0932a.jpg, 8228817 bytes, SHA-256 60400c92c54b7c1bd12299c69e83b16e5b6256e7dabacc478c021758ecd28179
- Licence: Creative Commons Attribution 4.0 International (CC BY 4.0),
  https://creativecommons.org/licenses/by/4.0/
  - ESO, Usage of images, videos, music and web texts (https://www.eso.org/public/outreach/copyright/,
    read 2026-11-18):
    > "Unless specifically noted, the images, videos, and music distributed on the public ESO
    > website, along with the texts of press releases, announcements, pictures of the week, blog
    > posts and captions, are licensed under a Creative Commons Attribution 4.0 International
    > License, and may on a non-exclusive basis be reproduced without fee provided the credit is
    > clear and visible."
    >
    > "The license allows to modify ESO material, provided that you indicate what those
    > modifications are. In particular, you must clearly indicate if you have used AI to modify our
    > content."
  - The image page (read 2026-11-18): "Crediting this image with the full credit line, in a
    visible way is MANDATORY, if you want to use it without paying a fee."
  - CC BY 4.0, legal code, section 3(a)(1) (https://creativecommons.org/licenses/by/4.0/legalcode.en,
    read 2026-11-18): "indicate if You modified the Licensed Material and retain an indication of
    any previous modifications; and indicate the Licensed Material is licensed under this Public
    License, and include the text of, or the URI or hyperlink to, this Public License."
- Changed: resized from 6000 x 3000 px to 4096 x 2048 px (`milkyway-4k.webp`, 1,319,766 bytes) and
  2048 x 1024 px (`milkyway-2k.webp`, 373,526 bytes) by area averaging in linear light, and
  re-encoded as WebP at quality 75 in Chrome 157.0.8103.51. Nothing else: no crop, no change of
  color or tone, and no AI. On the site the sky renderer shows the picture dimmed and projected onto
  the sky over Santa Clara, behind the catalogue stars.
- Footer credit: "Milky Way: ESO/S. Brunier, CC BY." with "CC BY" linked to
  https://creativecommons.org/licenses/by/4.0/ (rel="license").
