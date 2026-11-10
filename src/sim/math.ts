// Basic arithmetic has specified IEEE-754 results; native trig/hypot can differ across JS engines.
export function sin(angle: number) {
  let x = angle % (2 * Math.PI);
  if (x > Math.PI) x -= 2 * Math.PI;
  if (x < -Math.PI) x += 2 * Math.PI;
  if (x > Math.PI / 2) x = Math.PI - x;
  if (x < -Math.PI / 2) x = -Math.PI - x;
  let term = x, sum = x;
  for (let i = 1; i <= 10; i++) { term *= -x * x / ((2 * i) * (2 * i + 1)); sum += term; }
  return sum;
}
export const cos = (angle: number) => sin(angle + Math.PI / 2);
export const hypot = (x: number, y: number) => Math.sqrt(x * x + y * y);
export function atan2(y: number, x: number) {
  const ax = Math.abs(x), ay = Math.abs(y);
  if (ax === 0 && ay === 0) return 0;
  let z = Math.min(ax, ay) / Math.max(ax, ay), base = 0;
  if (z > .41421356237309503) { z = (z - 1) / (z + 1); base = Math.PI / 4; }
  let term = z, angle = z;
  for (let i = 1; i <= 20; i++) { term *= -z * z; angle += term / (2 * i + 1); }
  angle += base;
  if (ay > ax) angle = Math.PI / 2 - angle;
  if (x < 0) angle = Math.PI - angle;
  return y < 0 ? -angle : angle;
}
