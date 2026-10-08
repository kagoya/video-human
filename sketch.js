let camera;
let faceMesh;
let faces = [];
let lastDetected = 0;
let detectionStarted = false;
let startButton;
let bodySegmentation;
let bodyBusy = false;
let bodyFailed = false;
let lastBodyRequest = -Infinity;
let lastBodyDetected = -Infinity;
let maskCanvas;
let maskContext;
let bodyCanvas;
let bodyContext;
let bodyStatus;

const BODY_COLOR = "#ff8c00";
const BODY_MODEL_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@0.1.1675465747/";
// 小さなマスクで処理し、iPadでも負荷を抑えます。
const MASK_WIDTH = 180;
const MASK_HEIGHT = 135;

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
  pixelDensity(1);

  startButton = createButton("カメラを開始");
  startButton.mousePressed(startCamera);
  bodyStatus = createP("カメラを開始すると、体の認識モデルを読み込みます。");
  bodyStatus.attribute("role", "status");

  maskCanvas = document.createElement("canvas");
  maskCanvas.width = MASK_WIDTH;
  maskCanvas.height = MASK_HEIGHT;
  maskContext = maskCanvas.getContext("2d", { willReadFrequently: true });
  bodyCanvas = document.createElement("canvas");
  bodyCanvas.width = MASK_WIDTH;
  bodyCanvas.height = MASK_HEIGHT;
  bodyContext = bodyCanvas.getContext("2d");

  try {
    bodySegmentation = new SelfieSegmentation({
      locateFile: file => BODY_MODEL_URL + file
    });
    bodySegmentation.setOptions({ modelSelection: 0, selfieMode: false });
    bodySegmentation.onResults(gotBody);
  } catch (error) {
    reportBodyError(error);
  }
}

function startCamera() {
  startButton.attribute("disabled", "");
  if (!bodyFailed) bodyStatus.html("カメラを許可してください。初回は体の認識モデルの読み込みに時間がかかります。");

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

  // 顔が見つからない場合でも、体の輪郭を独立して描きます。
  if (millis() - lastBodyDetected < 800) {
    drawingContext.drawImage(bodyCanvas, 0, 0, width, height);
  }
  if (!bodyBusy && !bodyFailed && millis() - lastBodyRequest >= 150) {
    detectBody();
  }

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

async function detectBody() {
  bodyBusy = true;
  lastBodyRequest = millis();
  try {
    await bodySegmentation.send({ image: camera.elt });
  } catch (error) {
    reportBodyError(error);
  } finally {
    bodyBusy = false;
  }
}

function reportBodyError(error) {
  bodyFailed = true;
  bodyStatus.html("体の認識を開始できませんでした。通信を確認してページを再読み込みしてください。顔の輪郭は引き続き表示します。");
  console.error("Body segmentation failed:", error);
}

function gotBody(results) {
  maskContext.clearRect(0, 0, MASK_WIDTH, MASK_HEIGHT);
  maskContext.drawImage(results.segmentationMask, 0, 0, MASK_WIDTH, MASK_HEIGHT);
  const pixels = maskContext.getImageData(0, 0, MASK_WIDTH, MASK_HEIGHT).data;
  // MediaPipeのマスクは透明度に人物の確率を持ちます。
  const segments = maskToSegments(pixels, MASK_WIDTH, MASK_HEIGHT);

  bodyContext.clearRect(0, 0, MASK_WIDTH, MASK_HEIGHT);
  bodyContext.strokeStyle = BODY_COLOR;
  bodyContext.lineWidth = 1.5;
  bodyContext.lineJoin = "round";
  bodyContext.lineCap = "round";
  bodyContext.beginPath();
  for (const [x1, y1, x2, y2] of segments) {
    bodyContext.moveTo(x1, y1);
    bodyContext.lineTo(x2, y2);
  }
  bodyContext.stroke();
  lastBodyDetected = millis();
  bodyStatus.html(segments.length
    ? "体の輪郭を表示中です。全身を画面に入れると、脚まで輪郭が描かれます。"
    : "人物を探しています。明るい場所で体を画面に入れてください。");
}

// 人物と背景の境界を追うMarching Squares。
// 骨格ではなく、髪や服も含めた人物の外周を描きます。
function maskToSegments(pixels, maskWidth, maskHeight) {
  const cases = [
    [], [3, 0], [0, 1], [3, 1],
    [1, 2], [3, 0, 1, 2], [0, 2], [3, 2],
    [2, 3], [0, 2], [0, 1, 2, 3], [1, 2],
    [1, 3], [0, 1], [3, 0], []
  ];
  const segments = [];
  const inside = (x, y) => pixels[(y * maskWidth + x) * 4 + 3] >= 128;

  for (let y = 0; y < maskHeight - 1; y++) {
    for (let x = 0; x < maskWidth - 1; x++) {
      const code = (inside(x, y) ? 1 : 0)
        | (inside(x + 1, y) ? 2 : 0)
        | (inside(x + 1, y + 1) ? 4 : 0)
        | (inside(x, y + 1) ? 8 : 0);
      const edges = cases[code];
      if (!edges.length) continue;

      const midpoints = [
        [x + 0.5, y], [x + 1, y + 0.5],
        [x + 0.5, y + 1], [x, y + 0.5]
      ];
      for (let i = 0; i < edges.length; i += 2) {
        segments.push([...midpoints[edges[i]], ...midpoints[edges[i + 1]]]);
      }
    }
  }
  return segments;
}
