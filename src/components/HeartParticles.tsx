/**
 * Settings 爱心粒子
 */

import { useEffect, useRef, type ReactElement } from "react";

const HEART_PRIMARY = "#FDBCDA";
const HEART_SECONDARY = "#FFCDD2";
// 粒子寿命 (秒)
const DURATION = 2.2;
const MAX_PARTICLES = 260;
// 每秒发射量
const PARTICLE_RATE = MAX_PARTICLES / DURATION;
// px/s
const VELOCITY = 100;
// 加速度 = 速度 * effect
const EFFECT = -0.75;
// CSS px
const SPRITE_SIZE = 30;
// 2x 位图, 高 DPI 下依然清晰
const SPRITE_SCALE = 2;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  size: number;
  sprite: number;
}

/** 心形参数曲线, -PI <= t <= PI */
function pointOnHeart(t: number): { x: number; y: number } {
  return {
    x: 160 * Math.pow(Math.sin(t), 3),
    y: 130 * Math.cos(t) - 50 * Math.cos(2 * t) - 20 * Math.cos(3 * t) - 10 * Math.cos(4 * t) + 25
  };
}

/** 预烤一颗心形位图, 每帧只 drawImage, 不重画路径 */
function makeHeartSprite(color: string, outline: boolean): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = SPRITE_SIZE * SPRITE_SCALE;
  canvas.height = SPRITE_SIZE * SPRITE_SCALE;
  const context = canvas.getContext("2d");
  if (context === null) {
    return canvas;
  }
  context.scale(SPRITE_SCALE, SPRITE_SCALE);
  const to = (t: number) => {
    const point = pointOnHeart(t);
    return {
      x: SPRITE_SIZE / 2 + (point.x * SPRITE_SIZE) / 350,
      y: SPRITE_SIZE / 2 - (point.y * SPRITE_SIZE) / 350
    };
  };
  context.beginPath();
  let t = -Math.PI;
  let point = to(t);
  context.moveTo(point.x, point.y);
  while (t < Math.PI) {
    t += 0.01;
    point = to(t);
    context.lineTo(point.x, point.y);
  }
  context.closePath();
  context.fillStyle = color;
  context.fill();
  // 浅色心形在浅色遮罩上容易糊掉, 补一圈极细的同色系描边保住轮廓
  if (outline) {
    context.strokeStyle = "rgb(234 129 176 / 0.42)";
    context.lineWidth = 0.6;
    context.stroke();
  }
  return canvas;
}

export function HeartParticles(): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return undefined;
    }
    const context = canvas.getContext("2d");
    if (context === null) {
      return undefined;
    }

    const sprites = [makeHeartSprite(HEART_PRIMARY, false), makeHeartSprite(HEART_SECONDARY, true)];
    const particles: Particle[] = [];
    let width = 0;
    let height = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    let frame = 0;
    let previous = performance.now() / 1000;
    const render = (now: number) => {
      const time = now / 1000;
      const delta = Math.min(0.05, Math.max(0, time - previous));
      previous = time;
      context.clearRect(0, 0, width, height);

      // 发射: 沿心形轮廓随机取点, 方向取该点的单位径向
      for (let i = 0; i < PARTICLE_RATE * delta; i += 1) {
        const point = pointOnHeart(Math.PI - 2 * Math.PI * Math.random());
        const length = Math.hypot(point.x, point.y) || 1;
        const dx = (point.x / length) * VELOCITY;
        const dy = (point.y / length) * VELOCITY;
        particles.push({
          x: width / 2 + point.x,
          y: height / 2 - point.y,
          vx: dx,
          vy: -dy,
          age: 0,
          size: SPRITE_SIZE * (0.55 + Math.random() * 0.8),
          sprite: Math.random() < 0.64 ? 0 : 1
        });
      }

      for (let i = particles.length - 1; i >= 0; i -= 1) {
        const particle = particles[i];
        particle.x += particle.vx * delta;
        particle.y += particle.vy * delta;
        particle.vx += particle.vx * EFFECT * delta;
        particle.vy += particle.vy * EFFECT * delta;
        particle.age += delta;
        if (particle.age >= DURATION) {
          particles.splice(i, 1);
          continue;
        }
        const progress = particle.age / DURATION;
        // --t*t*t + 1, 0 -> 1 逐渐胀大
        const eased = (progress - 1) ** 3 + 1;
        const size = particle.size * eased;
        context.globalAlpha = 1 - progress;
        context.drawImage(sprites[particle.sprite], particle.x - size / 2, particle.y - size / 2, size, size);
      }
      context.globalAlpha = 1;
      frame = requestAnimationFrame(render);
    };
    frame = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      particles.length = 0;
    };
  }, []);

  return <canvas ref={canvasRef} className="nice-day-particles" aria-hidden="true" />;
}
