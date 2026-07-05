const menuButton = document.querySelector(".menu-button");
const siteNav = document.querySelector(".site-nav");

if (menuButton && siteNav) {
  menuButton.addEventListener("click", () => {
    const open = siteNav.classList.toggle("is-open");
    menuButton.setAttribute("aria-expanded", String(open));
  });
  siteNav.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => {
    siteNav.classList.remove("is-open");
    menuButton.setAttribute("aria-expanded", "false");
  }));
}

document.querySelector("#year").textContent = `Copyright ${new Date().getFullYear()}`;

const canvas = document.querySelector("#flow-canvas");
const angleInput = document.querySelector("#flow-angle");
const readout = document.querySelector("#flow-readout");

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function interpolateColor(a, b, amount) {
  return a.map((channel, index) => Math.round(channel + (b[index] - channel) * amount));
}

function pressureColor(cp) {
  const stops = [
    [-3.5, [7, 18, 28]],
    [-2.7, [0, 63, 190]],
    [-1.8, [0, 207, 214]],
    [-0.9, [50, 225, 55]],
    [-0.35, [202, 239, 45]],
    [-0.12, [255, 211, 53]],
    [0, [255, 145, 36]],
    [0.45, [234, 52, 13]],
    [1, [30, 3, 2]],
  ];
  const value = clamp(cp, stops[0][0], stops[stops.length - 1][0]);
  for (let i = 1; i < stops.length; i += 1) {
    if (value <= stops[i][0]) {
      const [lowValue, lowColor] = stops[i - 1];
      const [highValue, highColor] = stops[i];
      return interpolateColor(lowColor, highColor, (value - lowValue) / (highValue - lowValue));
    }
  }
  return stops[stops.length - 1][1];
}

function airfoilY(x) {
  return 0.6 * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x ** 2 + 0.2843 * x ** 3 - 0.1015 * x ** 4);
}

function drawAirfoil(ctx, width, height, angle) {
  const chord = width * 0.42;
  const cx = width * 0.5;
  const cy = height * 0.47;
  const radians = angle * Math.PI / 180;
  const points = [];
  for (let i = 0; i <= 50; i += 1) {
    const x = i / 50;
    points.push([x - 0.5, -airfoilY(x)]);
  }
  for (let i = 50; i >= 0; i -= 1) {
    const x = i / 50;
    points.push([x - 0.5, airfoilY(x)]);
  }
  ctx.beginPath();
  points.forEach(([x, y], index) => {
    const px = (x * Math.cos(radians) - y * Math.sin(radians)) * chord + cx;
    const py = (x * Math.sin(radians) + y * Math.cos(radians)) * chord + cy;
    if (index === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  });
  ctx.closePath();
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.strokeStyle = "#182126";
  ctx.lineWidth = 1.25;
  ctx.stroke();
}

function pressureCoefficient(x, y, angle) {
  const alpha = angle * Math.PI / 180;
  const cosA = Math.cos(alpha);
  const sinA = Math.sin(alpha);

  // Rotate the field into the airfoil frame while keeping the freestream horizontal.
  // Canvas y points downward, while the pressure field uses y-up coordinates.
  // This inverse transform matches the screen-space rotation used by drawAirfoil.
  const bodyX = cosA * x - sinA * y;
  const bodyY = sinA * x + cosA * y;
  const chordPosition = clamp(bodyX + 0.5, 0.001, 0.999);
  const surfaceY = airfoilY(chordPosition);
  const upperDistance = Math.max(bodyY - surfaceY, 0);
  const lowerDistance = Math.max(-bodyY - surfaceY, 0);
  const chordOverflow = Math.max(Math.abs(bodyX) - 0.5, 0);
  const chordFade = Math.exp(-chordOverflow * 8);
  const upperWeight = 0.5 + 0.5 * Math.tanh(bodyY * 28);
  const lowerWeight = 1 - upperWeight;

  // Chordwise loading peaks near the leading edge and recovers toward the trailing edge.
  const leadingLoad = Math.exp(-(((chordPosition - 0.1) / 0.2) ** 2));
  const midChordLoad = Math.exp(-(((chordPosition - 0.36) / 0.46) ** 2));
  const suctionStrength = 1.05 + Math.max(angle, 0) * 0.065;
  const pressureStrength = 0.48 + Math.max(angle, 0) * 0.026;
  const suction = -suctionStrength
    * (0.9 * leadingLoad + 0.42 * midChordLoad)
    * Math.exp(-upperDistance / (0.12 + Math.max(angle, 0) * 0.0025))
    * upperWeight
    * chordFade;
  const lowerPressure = pressureStrength
    * (0.88 * leadingLoad + 0.28 * midChordLoad)
    * Math.exp(-lowerDistance / 0.15)
    * lowerWeight
    * chordFade;

  // The stagnation point moves below the nose as positive incidence increases.
  const stagnationY = -0.018 - Math.sin(alpha) * 0.07;
  const stagnation = (0.44 + Math.max(angle, 0) * 0.025) * Math.exp(
    -((bodyX + 0.49) ** 2 / 0.012 + (bodyY - stagnationY) ** 2 / 0.008),
  );

  // A narrow, slowly recovering pressure deficit represents the downstream wake.
  const wakeX = bodyX - 0.5;
  const wakeWidth = 0.025 + Math.max(wakeX, 0) * 0.035;
  const wake = wakeX > 0
    ? -0.12 * Math.exp(-wakeX * 1.15) * Math.exp(-(bodyY ** 2) / (wakeWidth ** 2))
    : 0;

  // Broad pressure lobes produce the far-field contour recovery seen in CFD plots.
  const broadSuction = -(0.28 + Math.max(angle, 0) * 0.012) * Math.exp(
    -((bodyX + 0.05) ** 2 / 0.52 + (bodyY - 0.2) ** 2 / 0.16),
  );
  const broadPressure = (0.16 + Math.max(angle, 0) * 0.007) * Math.exp(
    -((bodyX + 0.03) ** 2 / 0.6 + (bodyY + 0.22) ** 2 / 0.2),
  );

  return suction + lowerPressure + stagnation + wake + broadSuction + broadPressure;
}

function drawField() {
  if (!canvas || !angleInput || !readout) return;
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const angle = Number(angleInput.value);
  const small = document.createElement("canvas");
  small.width = 240;
  small.height = 135;
  const sctx = small.getContext("2d");
  const image = sctx.createImageData(small.width, small.height);

  for (let y = 0; y < small.height; y += 1) {
    for (let x = 0; x < small.width; x += 1) {
      const pixelX = (x / (small.width - 1)) * width;
      const pixelY = (y / (small.height - 1)) * height;
      const chord = width * 0.42;
      const fieldX = (pixelX - width * 0.5) / chord;
      const fieldY = (height * 0.47 - pixelY) / chord;
      const rawCp = pressureCoefficient(fieldX, fieldY, angle);
      const contourCp = Math.round(rawCp * 18) / 18;
      const color = pressureColor(contourCp);
      const offset = (y * small.width + x) * 4;
      image.data[offset] = color[0];
      image.data[offset + 1] = color[1];
      image.data[offset + 2] = color[2];
      image.data[offset + 3] = 255;
    }
  }

  sctx.putImageData(image, 0, 0);
  ctx.drawImage(small, 0, 0, width, height);
  drawAirfoil(ctx, width, height, angle);
  readout.textContent = `${angle} deg`;
}

angleInput?.addEventListener("input", drawField);
drawField();

const grainCanvas = document.querySelector("#grain-canvas");
const grainStep = document.querySelector("#grain-step");
const grainReadout = document.querySelector("#grain-readout");
const grainCount = 64;
const finalGrainCount = 9;
const grainPalette = [
  [46, 226, 211],
  [91, 239, 212],
  [255, 218, 35],
  [155, 245, 38],
  [255, 116, 109],
  [239, 124, 229],
  [174, 25, 245],
  [94, 107, 245],
];

function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function createGrainSeeds(count) {
  const random = createRandom(20260703);
  const candidates = Array.from({ length: count }, (_, index) => ({
    x: random(),
    y: random(),
    color: grainPalette[(index * 5 + Math.floor(random() * 3)) % grainPalette.length],
  }));

  // Farthest-point ordering keeps the surviving grains spread across the field.
  const ordered = [candidates.splice(Math.floor(random() * candidates.length), 1)[0]];
  while (candidates.length) {
    let bestIndex = 0;
    let bestDistance = -1;
    candidates.forEach((candidate, index) => {
      const nearest = Math.min(...ordered.map((seedPoint) => (
        (candidate.x - seedPoint.x) ** 2 + (candidate.y - seedPoint.y) ** 2
      )));
      if (nearest > bestDistance) {
        bestDistance = nearest;
        bestIndex = index;
      }
    });
    ordered.push(candidates.splice(bestIndex, 1)[0]);
  }
  return ordered;
}

const grainSeeds = createGrainSeeds(grainCount);

function drawGrainField() {
  if (!grainCanvas || !grainStep || !grainReadout) return;
  const progress = Number(grainStep.value) / 100;
  const fieldWidth = 190;
  const fieldHeight = 107;
  const cellIds = new Uint8Array(fieldWidth * fieldHeight);
  const small = document.createElement("canvas");
  small.width = fieldWidth;
  small.height = fieldHeight;
  const smallContext = small.getContext("2d");
  const image = smallContext.createImageData(fieldWidth, fieldHeight);

  for (let y = 0; y < fieldHeight; y += 1) {
    for (let x = 0; x < fieldWidth; x += 1) {
      const px = x / (fieldWidth - 1);
      const py = y / (fieldHeight - 1);
      const warpedX = px + 0.014 * Math.sin(py * 17 + progress * 0.8);
      const warpedY = py + 0.011 * Math.sin(px * 19 - progress * 0.7);
      let nearestIndex = 0;
      let nearestDistance = Infinity;

      for (let index = 0; index < grainSeeds.length; index += 1) {
        const seedPoint = grainSeeds[index];
        let shrinkPenalty = 0;
        if (index >= finalGrainCount) {
          const removalOrder = (grainCount - 1 - index) / (grainCount - finalGrainCount - 1);
          const shrinkStart = 0.02 + removalOrder * 0.83;
          const shrinkAmount = clamp((progress - shrinkStart) / 0.15, 0, 1);
          shrinkPenalty = shrinkAmount * shrinkAmount * 0.2;
        }
        const distance = (warpedX - seedPoint.x) ** 2
          + (warpedY - seedPoint.y) ** 2
          + shrinkPenalty;
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = index;
        }
      }
      cellIds[y * fieldWidth + x] = nearestIndex;
    }
  }

  for (let y = 0; y < fieldHeight; y += 1) {
    for (let x = 0; x < fieldWidth; x += 1) {
      const position = y * fieldWidth + x;
      const cellId = cellIds[position];
      const boundary = (x > 0 && cellIds[position - 1] !== cellId)
        || (y > 0 && cellIds[position - fieldWidth] !== cellId);
      const color = boundary ? [30, 116, 126] : grainSeeds[cellId].color;
      const offset = position * 4;
      image.data[offset] = color[0];
      image.data[offset + 1] = color[1];
      image.data[offset + 2] = color[2];
      image.data[offset + 3] = 255;
    }
  }

  smallContext.putImageData(image, 0, 0);
  const context = grainCanvas.getContext("2d");
  context.imageSmoothingEnabled = true;
  context.drawImage(small, 0, 0, grainCanvas.width, grainCanvas.height);
  grainReadout.textContent = `t = ${Math.round(progress * 55)}`;
}

let grainAnimationFrame;
grainStep?.addEventListener("input", () => {
  cancelAnimationFrame(grainAnimationFrame);
  grainAnimationFrame = requestAnimationFrame(drawGrainField);
});
drawGrainField();
