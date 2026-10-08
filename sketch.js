let camera;
let faceMesh;
let faces = [];
let lastDetected = 0;
let detectionStarted = false;
let startButton;

// 輪郭に沿って並べた特徴点の番号
const faceOutline = [
  10, 338, 297, 332, 284, 251, 389, 356,
  454, 323, 361, 288, 397, 365, 379, 378,
  400, 377, 152, 148, 176, 149, 150, 136,
  172, 58, 132, 93, 234, 127, 162, 21,
  54, 103, 67, 109
];

const eyeOutline1 = [
  33, 7, 163, 144, 145, 153, 154, 155,
  133, 173, 157, 158, 159, 160, 161, 246
];

const eyeOutline2 = [
  263, 249, 390, 373, 374, 380, 381, 382,
  362, 398, 384, 385, 386, 387, 388, 466
];

const noseOutline = [
  168, 193, 122, 196, 3, 51, 115, 131,
  134, 102, 48, 64, 98, 97, 2, 326,
  327, 294, 278, 331, 363, 360, 344,
  281, 248, 419, 351, 417
];

const mouthOuter = [
  61, 185, 40, 39, 37, 0, 267, 269,
  270, 409, 291, 375, 321, 405, 314,
  17, 84, 181, 91, 146
];

const mouthInner = [
  78, 191, 80, 81, 82, 13, 312, 311,
  310, 415, 308, 324, 318, 402, 317,
  14, 87, 178, 88, 95
];

function preload() {
  faceMesh = ml5.faceMesh({
    maxFaces: 1,
    refineLandmarks: false,
    flipped: false
  });
}

function setup() {
  createCanvas(360, 270);

  startButton = createButton("カメラを開始");
  startButton.mousePressed(startCamera);
}

function startCamera() {
  startButton.attribute("disabled", "");

  camera = createCapture({
    video: {
      facingMode: "user",
      width: { ideal: 640 },
      height: { ideal: 480 }
    },
    audio: false
  });

  camera.elt.setAttribute("playsinline", "");
  camera.elt.muted = true;
  camera.hide();
}

function draw() {
  background(20, 30, 50);

  if (!camera || camera.elt.readyState < 2) return;

  image(camera, 0, 0, width, height);

  if (!detectionStarted) {
    detectionStarted = true;

    camera.size(
      camera.elt.videoWidth,
      camera.elt.videoHeight
    );

    faceMesh.detectStart(camera, gotFaces);
  }

  // 検出が一瞬途切れても、0.8秒間は輪郭を残します。
  if (faces.length === 0 || millis() - lastDetected > 800) {
    return;
  }

  const points = faces[0].keypoints;

  drawOutline(points, faceOutline, "#00ff88");
  drawOutline(points, eyeOutline1, "#00ddff");
  drawOutline(points, eyeOutline2, "#00ddff");
  drawOutline(points, noseOutline, "#ffff00");
  drawOutline(points, mouthOuter, "#ff88cc");
  drawOutline(points, mouthInner, "#ff88cc");
}

function gotFaces(results) {
  if (results.length > 0) {
    faces = results;
    lastDetected = millis();
  }
}

// 特徴点を順番につなぎ、閉じた輪郭を描きます。
function drawOutline(points, indices, lineColor) {
  const scaleX = width / camera.elt.videoWidth;
  const scaleY = height / camera.elt.videoHeight;

  noFill();
  stroke(lineColor);
  strokeWeight(2);

  beginShape();

  for (const index of indices) {
    const point = points[index];

    vertex(
      point.x * scaleX,
      point.y * scaleY
    );
  }

  endShape(CLOSE);
}
