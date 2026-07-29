// Run with: node --test
const test = require("node:test");
const assert = require("node:assert/strict");
const { classifyGesture } = require("./gestureengine.js");

test("a quick, nearly-motionless touch classifies as tap", () => {
  const r = classifyGesture([{ x: 100, y: 100, t: 0 }, { x: 102, y: 101, t: 80 }]);
  assert.equal(r.type, "tap");
});

test("a stationary hold past the tap window but under long-press classifies as press", () => {
  const r = classifyGesture([{ x: 100, y: 100, t: 0 }, { x: 101, y: 100, t: 350 }]);
  assert.equal(r.type, "press");
});

test("a stationary hold past 550ms classifies as longPress", () => {
  const r = classifyGesture([{ x: 100, y: 100, t: 0 }, { x: 100, y: 101, t: 700 }]);
  assert.equal(r.type, "longPress");
});

test("a fast, straight, short movement classifies as swipe with the correct direction", () => {
  const r = classifyGesture([{ x: 0, y: 0, t: 0 }, { x: 100, y: 2, t: 150 }]);
  assert.equal(r.type, "swipe");
  assert.equal(r.direction, "right");
});

test("swipe direction correctly distinguishes all four cardinal directions", () => {
  assert.equal(classifyGesture([{ x: 0, y: 0, t: 0 }, { x: -100, y: 0, t: 100 }]).direction, "left");
  assert.equal(classifyGesture([{ x: 0, y: 0, t: 0 }, { x: 0, y: 100, t: 100 }]).direction, "down");
  assert.equal(classifyGesture([{ x: 0, y: 0, t: 0 }, { x: 0, y: -100, t: 100 }]).direction, "up");
});

test("a slow, straight, long movement classifies as drag, not swipe", () => {
  const r = classifyGesture([{ x: 0, y: 0, t: 0 }, { x: 200, y: 0, t: 1000 }]);
  assert.equal(r.type, "drag");
});

test("back-and-forth movement with little net displacement classifies as rub", () => {
  const path = [
    { x: 0, y: 0, t: 0 }, { x: 30, y: 0, t: 50 }, { x: 0, y: 0, t: 100 },
    { x: 30, y: 0, t: 150 }, { x: 0, y: 0, t: 200 }, { x: 25, y: 0, t: 250 },
  ];
  const r = classifyGesture(path);
  assert.equal(r.type, "rub");
});

test("a large, curling, low-straightness path classifies as circle", () => {
  const path = [];
  const steps = 24;
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * 2 * Math.PI;
    path.push({ x: 50 + 40 * Math.cos(angle), y: 50 + 40 * Math.sin(angle), t: i * 20 });
  }
  const r = classifyGesture(path);
  assert.equal(r.type, "circle");
});

test("empty or missing path returns null instead of throwing", () => {
  assert.equal(classifyGesture([]), null);
  assert.equal(classifyGesture(null), null);
});

test("higher sensitivity makes a small movement register as a gesture sooner (smaller effective tap threshold)", () => {
  // A movement just past the default tap threshold, classified differently at low vs high sensitivity.
  const path = [{ x: 0, y: 0, t: 0 }, { x: 7, y: 0, t: 50 }];
  const lowSensitivity = classifyGesture(path, 0);
  const highSensitivity = classifyGesture(path, 1);
  // At low sensitivity the wider tap threshold still counts this as a tap;
  // at high sensitivity the narrower threshold pushes it into a movement gesture.
  assert.equal(lowSensitivity.type, "tap");
  assert.notEqual(highSensitivity.type, "tap");
});

test("higher sensitivity makes a shorter hold count as longPress sooner", () => {
  // At sensitivity=1 the effective longPress threshold drops to 400ms; at
  // sensitivity=0 it rises to 700ms — 450ms falls between the two.
  const path = [{ x: 0, y: 0, t: 0 }, { x: 1, y: 0, t: 450 }];
  const lowSensitivity = classifyGesture(path, 0);
  const highSensitivity = classifyGesture(path, 1);
  assert.notEqual(lowSensitivity.type, "longPress");
  assert.equal(highSensitivity.type, "longPress");
});
