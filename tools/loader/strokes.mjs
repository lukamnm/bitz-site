// strokes.mjs - the hand-writing paths of the Bitz logo (the write-on loader). Each shape of assets/img/logo.svg gets one or more centre-line
// strokes, drawn in the order and direction a hand would write it; a wide round-capped stroke grows along each line (Trim Paths) and works as
// the shape's alpha matte, so the real lettering appears as if written. Coordinates: logo viewBox units (345.87 x 255.4).
// t0 / t1: when the stroke starts / finishes writing, in seconds (several strokes write at once, like the reference video).
// Shape index = order of the <path> elements in logo.svg: 0 B, 1 i stem, 2 i dot, 3 t, 4 z.
const P = pts => pts.map(([x, y]) => [x / 4, y / 4]);   // authored on a 4x render (1384 x 1022)
export const STROKES = [
  // B: the entry swash over the top bowl to the waist, the stem, then the lower bowl round to the foot
  { shape: 0, w: 40, t0: 0.00, t1: 0.42, pts: P([[30, 296], [95, 205], [190, 120], [300, 70], [410, 60], [468, 118], [462, 225], [408, 318], [345, 385]]) },
  { shape: 0, w: 44, t0: 0.10, t1: 0.40, pts: P([[296, 150], [222, 330], [152, 520], [102, 720], [45, 878]]) },
  { shape: 0, w: 46, t0: 0.32, t1: 0.68, pts: P([[232, 468], [330, 418], [405, 462], [418, 580], [372, 700], [262, 798], [130, 852], [25, 885]]) },
  // i: the stem down and the little turn up at its foot, then the dot
  { shape: 1, w: 40, t0: 0.24, t1: 0.54, pts: P([[672, 262], [630, 440], [592, 590], [578, 680], [598, 712], [645, 670], [690, 588]]) },
  { shape: 2, w: 30, t0: 0.52, t1: 0.66, pts: P([[655, 205], [672, 112], [735, 72], [778, 108], [740, 192], [690, 214]]) },
  // t: the stem from the top down into its hook, the slanted cross bar, the long leg down to the left
  { shape: 3, w: 36, t0: 0.36, t1: 0.66, pts: P([[962, 22], [938, 200], [922, 360], [915, 480], [890, 580], [830, 632], [778, 612]]) },
  { shape: 3, w: 30, t0: 0.58, t1: 0.74, pts: P([[778, 315], [900, 270], [1052, 205]]) },
  { shape: 3, w: 32, t0: 0.48, t1: 0.70, pts: P([[840, 300], [808, 450], [752, 580], [698, 664]]) },
  // z: the top bar, the diagonal, the middle bar turning into the upper swash, the lower bowl running into the long tail
  { shape: 4, w: 30, t0: 0.56, t1: 0.70, pts: P([[1092, 205], [1240, 145], [1372, 88]]) },
  { shape: 4, w: 40, t0: 0.64, t1: 0.82, pts: P([[1290, 160], [1180, 310], [1070, 460], [985, 548]]) },
  { shape: 4, w: 26, t0: 0.76, t1: 1.12, pts: P([[972, 594], [1100, 556], [1200, 540], [1195, 570], [1060, 625], [880, 700], [620, 790], [380, 880], [262, 962]]) },
  { shape: 4, w: 44, t0: 0.82, t1: 1.30, pts: P([[1150, 420], [1250, 408], [1318, 448], [1315, 530], [1280, 592], [1310, 652], [1282, 712], [1180, 716], [1000, 742], [760, 815], [520, 905], [300, 1005]]) },
];
