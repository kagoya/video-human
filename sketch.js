// v1.4.0 — 手で隠れた顔のパーツを描かず、すべての色の凡例を表示します。
const APP_VERSION = "1.4.0";
const BODY_COLOR = "#ff8c00";
const BODY_MODEL_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@0.1.1675465747/";
const MASK_WIDTH = 180;
const MASK_HEIGHT = 135;

let video;
let stream;
let cameraWanted = false;
let cameraGeneration = 0;
let sourceKey = "";
let frameCanvas;
let frameContext;
let maskCanvas;
let maskContext;
let bodyCanvas;
let bodyContext;
let faceMesh;
let faceReady = false;
let faceFailed = false;
let handPose;
let handReady = false;
let handFailed = false;
let handOcclusions = [];
let bodySegmentation;
let bodyFailed = false;
let modelsStarted = false;
let inferenceBusy = false;
let activeBodyFrame;
let faces = [];
let lastDetected = -Infinity;
let lastBodyDetected = -Infinity;
let lastRequest = -Infinity;
let rotationTimer;
let lastOrientation;
let reconnectPending = false;

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


function setStatus(id, message) {
  document.getElementById(id).textContent = message;
}

function setup() {
  createCanvas(360, 270).parent("stage");
  pixelDensity(1);
  frameRate(30);
  fitScreen();
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(fitScreen).observe(document.getElementById("stage"));
  }
  window.visualViewport?.addEventListener("resize", fitScreen);
  const button = document.getElementById("camera-button");
  button.disabled = false;
  button.textContent = "カメラを開始";
  button.addEventListener("click", startCamera);
  setStatus("camera-status", "カメラを開始してください。映像はブラウザ内で処理します。");

  frameCanvas = document.createElement("canvas");
  frameContext = frameCanvas.getContext("2d");
  maskCanvas = document.createElement("canvas");
  maskCanvas.width = MASK_WIDTH;
  maskCanvas.height = MASK_HEIGHT;
  maskContext = maskCanvas.getContext("2d", { willReadFrequently: true });
  bodyCanvas = document.createElement("canvas");
  bodyCanvas.width = MASK_WIDTH;
  bodyCanvas.height = MASK_HEIGHT;
  bodyContext = bodyCanvas.getContext("2d");

  lastOrientation = orientationKey();
  window.addEventListener("orientationchange", orientationChanged);
  window.screen.orientation?.addEventListener("change", orientationChanged);
  window.addEventListener("resize", orientationChanged);
  window.addEventListener("pagehide", () => {
    cameraWanted = false;
    cameraGeneration++;
    stopStream(stream);
  });
}

function stopStream(mediaStream) {
  mediaStream?.getTracks().forEach(track => track.stop());
}

function invalidateResults() {
  faces = [];
  handOcclusions = [];
  lastDetected = -Infinity;
  lastBodyDetected = -Infinity;
}

async function startCamera() {
  cameraWanted = true;
  const generation = ++cameraGeneration;
  invalidateResults();
  sourceKey = "";
  const button = document.getElementById("camera-button");
  button.disabled = true;
  button.textContent = "接続中…";
  setStatus("camera-status", "カメラを準備しています。使用を許可してください。");
  stopStream(stream);
  stream = undefined;
  if (video) {
    video.pause();
    video.srcObject = null;
    video.remove();
    video = undefined;
  }
  let candidateStream;
  let candidateVideo;
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("HTTPSでページを開いてください。");
    }
    // 向きはSafariに任せ、縦横に矛盾する解像度を固定しません。
    candidateStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 640 }, frameRate: { ideal: 20, max: 30 } },
      audio: false
    });
    if (generation !== cameraGeneration) {
      stopStream(candidateStream);
      return;
    }
    candidateVideo = document.createElement("video");
    candidateVideo.muted = true;
    candidateVideo.autoplay = true;
    candidateVideo.playsInline = true;
    candidateVideo.setAttribute("playsinline", "");
    candidateVideo.setAttribute("webkit-playsinline", "");
    // Safariでも映像の更新が続くよう、display:noneを使いません。
    candidateVideo.style.cssText = "position:fixed;left:-2px;top:-2px;width:1px;height:1px;opacity:0;pointer-events:none";
    document.body.appendChild(candidateVideo);
    candidateVideo.srcObject = candidateStream;
    await candidateVideo.play();
    if (generation !== cameraGeneration) {
      stopStream(candidateStream);
      candidateVideo.remove();
      return;
    }
    video = candidateVideo;
    stream = candidateStream;
    button.textContent = "カメラを再接続";
    setStatus("camera-status", "カメラ接続済み");
    loadModels();
  } catch (error) {
    stopStream(candidateStream);
    candidateVideo?.remove();
    if (generation === cameraGeneration) {
      cameraWanted = false;
      button.textContent = "カメラを開始";
      setStatus("camera-status", "カメラを開始できません。許可を確認してください。 " + error.message);
    }
  } finally {
    if (generation === cameraGeneration) button.disabled = false;
  }
}

function loadModels() {
  if (modelsStarted) return;
  modelsStarted = true;
  setStatus("face-status", "顔：モデル読み込み中…");
  setStatus("hand-status", "手：モデル読み込み中…");
  setStatus("body-status", "体：モデル読み込み中…");
  try {
    faceMesh = ml5.faceMesh({ maxFaces: 1, refineLandmarks: false, flipped: false });
    faceMesh.ready.then(() => {
      faceReady = true;
      setStatus("face-status", "顔：認識を開始します");
    }).catch(error => {
      faceFailed = true;
      setStatus("face-status", "顔：モデルを読み込めません。再読み込みしてください。");
      console.error(error);
    });
  } catch (error) {
    faceFailed = true;
    setStatus("face-status", "顔：読み込みエラー。再読み込みしてください。");
    console.error(error);
  }
  try {
    handPose = ml5.handPose({ maxHands: 2, modelType: "lite", flipped: false });
    handPose.ready.then(() => {
      handReady = true;
      setStatus("hand-status", "手：顔の隠れを確認します");
    }).catch(error => {
      handFailed = true;
      setStatus("hand-status", "手：読み込み失敗（隠れ判定は停止中）");
      console.error(error);
    });
  } catch (error) {
    handFailed = true;
    setStatus("hand-status", "手：読み込み失敗（隠れ判定は停止中）");
    console.error(error);
  }
  try {
    bodySegmentation = new SelfieSegmentation({ locateFile: file => BODY_MODEL_URL + file });
    bodySegmentation.setOptions({ modelSelection: 0, selfieMode: false });
    bodySegmentation.onResults(gotBody);
  } catch (error) {
    bodyFailed = true;
    setStatus("body-status", "体：読み込みエラー。再読み込みしてください。");
    console.error(error);
  }
}

function draw() {
  background(20, 30, 50);
  if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight || reconnectPending) return;
  const key = video.videoWidth + "x" + video.videoHeight;
  if (sourceKey !== key) {
    sourceKey = key;
    cameraGeneration++;
    invalidateResults();
  }
  const placement = videoPlacement(video.videoWidth, video.videoHeight, width, height);
  drawingContext.drawImage(video, placement.x, placement.y, placement.width, placement.height);

  if (millis() - lastBodyDetected < 700) {
    drawingContext.drawImage(bodyCanvas, placement.x, placement.y, placement.width, placement.height);
  }
  if (millis() - lastDetected < 700 && faces.length) {
    const points = faces[0].keypoints;
    drawOutline(points, faceOutline, "#00ff88", placement, true);
    drawOutline(points, eyeOutline1, "#00ddff", placement);
    drawOutline(points, eyeOutline2, "#00ddff", placement);
    drawOutline(points, noseOutline, "#ffff00", placement);
    if (!outlineOccluded(points, mouthOuter)) {
      drawOutline(points, mouthOuter, "#ff88cc", placement);
      drawOutline(points, mouthInner, "#ff88cc", placement);
    }
  }
  if (!inferenceBusy && modelsStarted && millis() - lastRequest >= 180) inferFrame();
}

async function inferFrame() {
  inferenceBusy = true;
  lastRequest = millis();
  const generation = cameraGeneration;
  // 画像サイズと画像内容を固定し、認識中に端末が回転しても結果を混ぜません。
  const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
  frameCanvas.width = Math.max(1, Math.round(video.videoWidth * scale));
  frameCanvas.height = Math.max(1, Math.round(video.videoHeight * scale));
  frameContext.drawImage(video, 0, 0, frameCanvas.width, frameCanvas.height);
  const snapshot = { generation, width: frameCanvas.width, height: frameCanvas.height };
  try {
    // 同じ画像から顔と手を検出し、結果を一緒に更新します。
    // モデルは直列で実行して、iPhone/iPadのGPU負荷を抑えます。
    if (faceReady && !faceFailed) {
      try {
        const results = await faceMesh.detect(frameCanvas);
        let occlusions = [];
        if (handReady && !handFailed) {
          try {
            const hands = await handPose.detect(frameCanvas);
            occlusions = hands.filter(hand => (hand.confidence ?? 1) >= 0.5)
              .map(hand => handPolygon(hand.keypoints, snapshot.width, snapshot.height));
          } catch (error) {
            handFailed = true;
            setStatus("hand-status", "手：認識エラー（隠れ判定は停止中）");
            console.error(error);
          }
        }
        if (generation === cameraGeneration) {
          handOcclusions = occlusions;
          faces = results.map(face => ({
            keypoints: face.keypoints.map(point => ({
              x: point.x / snapshot.width, y: point.y / snapshot.height
            }))
          }));
          lastDetected = millis();
          setStatus("face-status", faces.length ? "顔：検出中" : "顔：未検出（正面を向いてください）");
          if (handReady && !handFailed) {
            setStatus("hand-status", occlusions.length ? "手：検出中（重なった輪郭を非表示）" : "手：重なりなし");
          }
        }
      } catch (error) {
        faceFailed = true;
        setStatus("face-status", "顔：認識エラー。再読み込みしてください。");
        console.error(error);
      }
    }
    if (!bodyFailed && generation === cameraGeneration) {
      activeBodyFrame = snapshot;
      try {
        await bodySegmentation.send({ image: frameCanvas });
      } catch (error) {
        bodyFailed = true;
        setStatus("body-status", "体：認識エラー。再読み込みしてください。");
        console.error(error);
      }
    }
  } finally {
    inferenceBusy = false;
  }
}

function drawOutline(points, indices, color, placement, partial = false) {
  if (!partial && outlineOccluded(points, indices)) return;
  noFill();
  stroke(color);
  strokeWeight(2);
  if (partial) {
    // 顔の外周は、手が重なる線分だけ消します。
    for (let i = 0; i < indices.length; i++) {
      const a = points[indices[i]];
      const b = points[indices[(i + 1) % indices.length]];
      if (handOcclusions.some(polygon => segmentInPolygon(a, b, polygon))) continue;
      line(placement.x + a.x * placement.width, placement.y + a.y * placement.height,
        placement.x + b.x * placement.width, placement.y + b.y * placement.height);
    }
    return;
  }
  beginShape();
  for (const index of indices) {
    const point = points[index];
    vertex(placement.x + point.x * placement.width, placement.y + point.y * placement.height);
  }
  endShape(CLOSE);
}

function handPolygon(keypoints, frameWidth, frameHeight) {
  // 指の間も含む保守的な外周を作り、特徴点から指の太さ分だけ広げます。
  const hull = convexHull(keypoints.map(p => ({ x: p.x, y: p.y })));
  if (hull.length < 3) return [];
  const center = hull.reduce((c, p) => ({ x: c.x + p.x / hull.length, y: c.y + p.y / hull.length }), { x: 0, y: 0 });
  return hull.map(p => {
    const dx = p.x - center.x;
    const dy = p.y - center.y;
    const distance = Math.max(1, Math.hypot(dx, dy));
    return { x: (p.x + dx / distance * 12) / frameWidth, y: (p.y + dy / distance * 12) / frameHeight };
  });
}

function convexHull(points) {
  const sorted = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const lower = [];
  const upper = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  for (const p of sorted.slice().reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if ((a.y > point.y) !== (b.y > point.y)
      && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function segmentsIntersect(a, b, c, d) {
  const cross = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  // Bounding boxesも確認し、離れた同一直線上の線分を重なりとしません。
  return Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) <= Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x))
    && Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) <= Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y))
    && cross(a, b, c) * cross(a, b, d) <= 0 && cross(c, d, a) * cross(c, d, b) <= 0;
}

function segmentInPolygon(a, b, polygon) {
  if (pointInPolygon(a, polygon) || pointInPolygon(b, polygon)) return true;
  return polygon.some((p, i) => segmentsIntersect(a, b, p, polygon[(i + 1) % polygon.length]));
}

function outlineOccluded(points, indices) {
  const outline = indices.map(i => points[i]);
  return handOcclusions.some(polygon => {
    if (!polygon.length) return false;
    // 手がパーツの中にすっぽり収まる場合も判定します。
    if (polygon.some(p => pointInPolygon(p, outline))) return true;
    return outline.some((p, i) => segmentInPolygon(p, outline[(i + 1) % outline.length], polygon));
  });
}

function gotBody(results) {
  if (!activeBodyFrame || activeBodyFrame.generation !== cameraGeneration) return;
  maskContext.clearRect(0, 0, MASK_WIDTH, MASK_HEIGHT);
  maskContext.drawImage(results.segmentationMask, 0, 0, MASK_WIDTH, MASK_HEIGHT);
  const pixels = maskContext.getImageData(0, 0, MASK_WIDTH, MASK_HEIGHT).data;
  const segments = maskToSegments(pixels, MASK_WIDTH, MASK_HEIGHT);
  bodyContext.clearRect(0, 0, MASK_WIDTH, MASK_HEIGHT);
  const placement = videoPlacement(video.videoWidth, video.videoHeight, width, height);
  bodyContext.strokeStyle = BODY_COLOR;
  bodyContext.lineWidth = 3 * MASK_WIDTH / placement.width;
  bodyContext.lineCap = "round";
  bodyContext.beginPath();
  for (const [x1, y1, x2, y2] of segments) {
    bodyContext.moveTo(x1, y1);
    bodyContext.lineTo(x2, y2);
  }
  bodyContext.stroke();
  lastBodyDetected = millis();
  setStatus("body-status", segments.length ? "体：検出中" : "体：未検出（明るい場所で映してください）");
}

function orientationKey() {
  return window.screen.orientation?.angle ?? window.orientation ?? (window.innerWidth > window.innerHeight ? 90 : 0);
}

function orientationChanged() {
  fitScreen();
  const orientation = orientationKey();
  if (orientation === lastOrientation) return;
  lastOrientation = orientation;
  if (!cameraWanted) return;
  cameraGeneration++;
  invalidateResults();
  reconnectPending = true;
  setStatus("camera-status", "画面の向きに合わせて再接続しています…");
  clearTimeout(rotationTimer);
  rotationTimer = setTimeout(() => {
    reconnectPending = false;
    if (cameraWanted) startCamera();
  }, 500);
}

function windowResized() { fitScreen(); }

function fitScreen() {
  const stage = document.getElementById("stage");
  const w = Math.max(1, Math.round(stage.clientWidth));
  const h = Math.max(1, Math.round(stage.clientHeight));
  if (width !== w || height !== h) resizeCanvas(w, h);
}

function videoPlacement(sourceWidth, sourceHeight, targetWidth, targetHeight) {
  // 全体を見やすく表示し、周囲に余白が出ても映像を切り取りません。
  const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const displayWidth = sourceWidth * scale;
  const displayHeight = sourceHeight * scale;
  return { scale, x: (targetWidth - displayWidth) / 2, y: (targetHeight - displayHeight) / 2,
    width: displayWidth, height: displayHeight };
}

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
