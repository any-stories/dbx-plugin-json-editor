/**
 * 品牌字标: 可逐字点击的渐变文字
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactElement } from "react";

const LABEL = "JSON Editor";
/** 无后续点击多久后开始级联恢复 */
const RESTORE_AFTER_MS = 1800;
/** 级联恢复的收场时长 (最后一个字符弹回后再撤掉延迟状态) */
const RESTORE_SETTLE_MS = 1000;
/** 全部消隐后先停顿一个间隔, 再泛泡沫/级联恢复 */
const FINALE_PAUSE_MS = 850;
/** 泡沫开始后再等待多久  */
const FINALE_EGG_DELAY_MS = 1100;
/** Dock 式指针跟随: 悬浮字符的最大放大倍率. 衰减宽度只取约一个字符间距 */
const DOCK_MAX_SCALE = 1.5;
const DOCK_SIGMA_PX = 9;
/** 字符内容盒宽的这一比例作为"指针位于本字符上"的容差: 距离先减掉它
    再进高斯, 指针在字符内偏一侧时该字符仍保持最大倍率 */
const DOCK_EDGE_RELIEF = 0.2;
/** 相邻字符间隙随局部放大最多再加宽多少 px */
const DOCK_GAP_EXTRA_PX = 4;
/** 左缘渐隐: 被推出玻璃栏内容区 (application-menu__nav) 左缘的字符, 在
    越界多少 px 内平滑淡到全透 (越界越多越透, 到 0 完全隐藏),
    渐进隐没而非硬裁剪. 取 13px ≈ nav 左缘到
    玻璃栏外缘的 padding (14px), 让字符恰好在栏外缘前淡完, 不穿出玻璃栏.
    鼠标左移锚点跟随后, 淡掉的字符连续恢复 */
const DOCK_EDGE_FADE_PX = 13;
/** 每字符一条标量弹簧: 刚度 / 阻尼 */
const SPRING_K = 170;
const SPRING_C = 23;
/** 指针平滑跟随时间常数 (秒): pointermove 的原始 clientX 逐事件跳变 (高刷
    鼠标一帧可触发多次, 且带 1-2px 微跳), 而 σ=9 的窄高斯对这个 x 极敏感,
    直接驱动会让 scale 目标剧烈波动, 滑动时字符左右抖动.
    用一阶低通 (时间常数 35ms) 平滑后再驱动高斯与锚点, 放大峰连续跟随 */
const POINTER_TAU_S = 0.035;
/** 可点击的字符下标 (空格不可点, 也不计入"全部点完") */
const CLICKABLE = LABEL.split("").flatMap((ch, i) => (ch === " " ? [] : [i]));
const REDUCED =
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

/** 逐字静态度量 (自然布局, transform 不影响这些布局值):
    slot 盒与字符盒相对容器的位置/尺寸 */
interface Metrics {
  slotLefts: number[];
  slotWs: number[];
  slotTops: number[];
  slotHs: number[];
  charLefts: number[];
  charTops: number[];
  charWs: number[];
  charHs: number[];
  /** 字符 font-size (碎片按 Dock 放大同步缩放字号用) */
  fs: number;
  /** 玻璃栏内容区 (application-menu__nav) 左缘相对容器左缘的 x: 左缘渐隐的边界 */
  navLeft: number;
}

/** 逐帧布局快照: 供点击碎片取"当前可视盒"与当前渐变切片 */
interface FrameLayout {
  /** 每字符相对自然位置的水平位移 */
  dx: number[];
  /** 每字符当前 scale */
  s: number[];
  /** 首字符可视左缘 (渐变切片原点) */
  l0: number;
  /** 整词可视宽度 (渐变 background-size) */
  w: number;
}

/** 一片字符碎片: 原字符可视盒的位置/尺寸 + 当前渐变切片 + 径向飞散参数 */
interface Shard {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  bgW: number;
  bgX: number;
  scale: number;
  fs: number;
  char: string;
  dx: number;
  dy: number;
  rot: number;
  dur: number;
  delay: number;
}

type BubbleForm = "pop" | "foam";

/** 一颗泡泡: 起点 (容器内坐标) + 迸开/横漂/上升/尺寸/时长/形态 */
interface Bubble {
  id: number;
  x: number;
  y: number;
  size: number;
  burstX: number;
  burstY: number;
  drift: number;
  rise: number;
  dur: number;
  delay: number;
  form: BubbleForm;
}

interface BrandLogoProps {
  /** 可点击字符全部点完 (泡沫阶段开始) 时触发 */
  onAllClicked?: () => void;
}

export function BrandLogo({ onAllClicked }: BrandLogoProps): ReactElement {
  const containerRef = useRef<HTMLSpanElement>(null);
  const slotRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const charRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const nextIdRef = useRef(0);
  const lastClickRef = useRef(0);

  const [gone, setGone] = useState<ReadonlySet<number>>(new Set());
  const [restoring, setRestoring] = useState(false);
  const [shards, setShards] = useState<Shard[]>([]);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);

  /** 逐字静态度量 (自然布局); Dock 帧循环只读它, 不再碰 DOM 布局 */
  const metricsRef = useRef<Metrics | null>(null);
  /** 每字符一条标量弹簧: s = 当前 scale, v = 速度 */
  const springRef = useRef<{ s: number[]; v: number[] }>({ s: [], v: [] });
  /** 指针在容器内的原始 x (pointermove 直写, 可能一帧跳变多次) */
  const pointerXRef = useRef<number | null>(null);
  /** 平滑后的指针 x: 帧循环里一阶低通跟随 pointerXRef, 高斯与锚点都用它,
      scale 目标随指针连续滑动, 消除逐事件跳变引发的抖动 */
  const smoothXRef = useRef<number | null>(null);
  /** 布局锚点 x: 指针所在的基准位置, 该点映射回它自己 = 指针下的字符不动.
      指针离开后刻意保留最后一个值 (不清空), 弹簧收回时 shift 自然衰减
      到 0, 字符不会突然跳回左对齐 */
  const anchorXRef = useRef<number | null>(null);
  /** Dock 帧循环 raf 句柄 + 上一帧时间戳 */
  const rafRef = useRef(0);
  const lastTRef = useRef(0);
  /** 最近一帧布局快照 (点击碎片取当前可视盒用) */
  const frameRef = useRef<FrameLayout | null>(null);
  /** NiceDay 回调走 ref, 父组件重渲染不会重置收尾定时器 */
  const onAllClickedRef = useRef(onAllClicked);
  /** NiceDay 卡片定时器: 独立于收尾 effect 的 cleanup (见 all-gone 分支) */
  const eggTimerRef = useRef(0);

  /** 逐字测量: 字体晚解析/窄屏字号变化都要复测. 只在静止值变化时读一次
      DOM 布局, 把结果存进 metricsRef, 并把静止渐变切片写回 CSS 变量
      (Dock 帧循环随后会覆盖这些变量) */
  const measure = useCallback(() => {
    const box = containerRef.current;
    if (!box) return;
    const n = LABEL.length;
    const slotLefts: number[] = [];
    const slotWs: number[] = [];
    const slotTops: number[] = [];
    const slotHs: number[] = [];
    const charLefts: number[] = [];
    const charTops: number[] = [];
    const charWs: number[] = [];
    const charHs: number[] = [];
    let fs = 15;
    for (let i = 0; i < n; i += 1) {
      const slot = slotRefs.current[i];
      const char = charRefs.current[i];
      if (!slot || !char) return;
      if (i === 0) fs = parseFloat(getComputedStyle(char).fontSize) || 15;
      slotLefts.push(slot.offsetLeft);
      slotWs.push(slot.offsetWidth);
      slotTops.push(slot.offsetTop);
      slotHs.push(slot.offsetHeight);
      charLefts.push(slot.offsetLeft + char.offsetLeft);
      charTops.push(slot.offsetTop + char.offsetTop);
      charWs.push(char.offsetWidth);
      charHs.push(char.offsetHeight);
    }
    // 玻璃栏左缘 (左缘渐隐的边界): 容器在栏内, 取相对坐标, 窗口变化由
    // resize measure
    const boxLeft = box.getBoundingClientRect().left;
    const nav = box.closest(".application-menu__nav");
    const navLeft = nav ? nav.getBoundingClientRect().left - boxLeft : -Infinity;
    metricsRef.current = {
      slotLefts,
      slotWs,
      slotTops,
      slotHs,
      charLefts,
      charTops,
      charWs,
      charHs,
      fs,
      navLeft
    };
    const sp = springRef.current;
    if (sp.s.length !== n) {
      sp.s = new Array(n).fill(1);
      sp.v = new Array(n).fill(0);
    }
    // 静止渐变: 整词宽 = 首字符左缘到末字符右缘, 逐字反向平移拼连续渐变
    const l0 = charLefts[0];
    const w = charLefts[n - 1] + charWs[n - 1] - l0;
    box.style.setProperty("--brand-word-w", `${w}px`);
    for (let i = 0; i < n; i += 1) {
      const slot = slotRefs.current[i];
      if (!slot) return;
      slot.style.setProperty("--brand-bgw", `${w}px`);
      slot.style.setProperty("--brand-bgx", `${-(charLefts[i] - l0)}px`);
    }
  }, []);

  /** 一帧布局: 由弹簧 scale 推出每字符可视宽度/位置 (指针锚定, 见下),
      直写 transform 与渐变切片变量, 并给越出玻璃栏左缘的字符写渐隐透明度 */
  const layoutPass = useCallback((): FrameLayout => {
    const m = metricsRef.current;
    const sp = springRef.current;
    const n = LABEL.length;
    const dx: number[] = new Array(n).fill(0);
    if (!m) return { dx, s: sp.s.slice(), l0: 0, w: 0 };

    // 1) 每字符可视宽度 + 相邻字符之间被放大撑开的间隙
    const visWs: number[] = new Array(n);
    for (let i = 0; i < n; i += 1) visWs[i] = m.slotWs[i] * sp.s[i];
    const gaps: number[] = new Array(Math.max(0, n - 1)).fill(0);
    for (let i = 0; i < n - 1; i += 1) {
      const baseGap = m.slotLefts[i + 1] - (m.slotLefts[i] + m.slotWs[i]);
      const mag = Math.min(1, Math.max(0, (sp.s[i] + sp.s[i + 1]) / 2 - 1) / (DOCK_MAX_SCALE - 1));
      gaps[i] = baseGap + DOCK_GAP_EXTRA_PX * mag;
    }

    // 2) 基准 x -> 可视 x 的单调分段线性映射: 字符段按宽度比拉伸, 间隙段
    //    按间隙比拉伸. basePts/visPts 成对给出每个折点 (槽左缘/右缘)
    const basePts: number[] = [];
    const visPts: number[] = [];
    let vx = 0;
    for (let i = 0; i < n; i += 1) {
      basePts.push(m.slotLefts[i]);
      visPts.push(vx);
      vx += visWs[i];
      basePts.push(m.slotLefts[i] + m.slotWs[i]);
      visPts.push(vx);
      if (i < n - 1) vx += gaps[i];
    }

    // 3) 指针锚定: 整体平移 shift, 让"指针所在的基准位置"映射回它自己,
    //    指针下的字符向两侧变宽时自己不动, 两侧字符被推开; 指针落在间隙
    //    里时映射按间隙比连续过渡, 不会跳变. 指针还没进入 (anchor 为 null)
    //    时锚在整词右端 (末字符中心): 放大向左生长, 左侧越界字自然淡掉;
    //    也消掉了"enter 时无锚 / move 时突然设锚"造成的位移抖动.
    //    不设左缘硬限位: 鼠标左移时锚点跟随左移, 被隐藏的左侧字符自然恢复.
    const ax = anchorXRef.current ?? m.slotLefts[n - 1] + m.slotWs[n - 1] / 2;
    const a = Math.min(basePts[basePts.length - 1], Math.max(basePts[0], ax));
    let k = 0;
    while (k < basePts.length - 2 && a > basePts[k + 1]) k += 1;
    const span = basePts[k + 1] - basePts[k];
    const t = span > 0.001 ? (a - basePts[k]) / span : 0;
    const shift = a - (visPts[k] + (visPts[k + 1] - visPts[k]) * t);

    const visLefts: number[] = new Array(n);
    for (let i = 0; i < n; i += 1) visLefts[i] = visPts[i * 2] + shift;

    // 渐变切片: 字符可视盒 (不含热区 padding) 映射到整词可视渐变
    const charVisLeft = (i: number): number => {
      const cbx = m.slotLefts[i] + m.slotWs[i] / 2;
      const cvis = visLefts[i] + (m.slotWs[i] * sp.s[i]) / 2;
      return cvis + (m.charLefts[i] - cbx) * sp.s[i];
    };
    const l0 = charVisLeft(0);
    const w = charVisLeft(n - 1) + m.charWs[n - 1] * sp.s[n - 1] - l0;

    for (let i = 0; i < n; i += 1) {
      const slot = slotRefs.current[i];
      if (!slot) continue;
      const s = sp.s[i];
      const cbx = m.slotLefts[i] + m.slotWs[i] / 2;
      const cvis = visLefts[i] + (m.slotWs[i] * s) / 2;
      dx[i] = cvis - cbx;
      slot.style.transform = `translate3d(${dx[i].toFixed(2)}px,0,0) scale(${s.toFixed(4)})`;
      slot.style.setProperty("--brand-bgw", `${w.toFixed(2)}px`);
      slot.style.setProperty("--brand-bgx", `${(-(charVisLeft(i) - l0)).toFixed(2)}px`);
      // 左缘渐隐: 字符可视左缘越过玻璃栏左缘的量, 在 DOCK_EDGE_FADE_PX 内
      // 逐字符平滑淡到全透明, 越界越多越透, 渐进隐没而非硬裁剪; 渐隐带约等于 nav
      // 到玻璃栏外缘的距离, 字符在栏外缘前就淡完, 不穿出. 越界随弹簧收回
      // 连续消退, 恢复后清掉 inline opacity
      const ov = m.navLeft - charVisLeft(i);
      slot.style.opacity = ov > 0 ? Math.max(0, 1 - ov / DOCK_EDGE_FADE_PX).toFixed(3) : "";
    }
    const frame: FrameLayout = { dx, s: sp.s.slice(), l0, w };
    frameRef.current = frame;
    return frame;
  }, []);

  /** Dock 帧循环: 高斯衰减目标 -> 每字符弹簧积分 -> 布局直写. 能量耗尽
      (且指针不在字标上) 后停在自然布局, 循环结束 */
  const ensureLoop = useCallback(() => {
    if (rafRef.current || REDUCED || !metricsRef.current) return;
    lastTRef.current = performance.now();
    const step = (now: number) => {
      rafRef.current = 0;
      const m = metricsRef.current;
      if (!m) return;
      const dt = Math.min(0.032, Math.max(0.001, (now - lastTRef.current) / 1000));
      lastTRef.current = now;
      const n = LABEL.length;
      const sp = springRef.current;

      // 指针低通跟随: 原始 clientX 逐事件跳变, 直接驱动窄高斯会让目标 scale
      // 剧烈波动. 每帧向最新原始位置逼近一小步 (指数平滑, 与帧率无关), 高斯
      // 峰与锚点共用这个平滑值, 峰连续滑动, 弹簧只需追一个平滑目标.
      // 指针离开时清空平滑值, 但 anchorXRef 保留最后位置供弹簧收回用.
      const raw = pointerXRef.current;
      let px: number | null = null;
      if (raw !== null) {
        const cur = smoothXRef.current;
        px = cur === null ? raw : cur + (raw - cur) * (1 - Math.exp(-dt / POINTER_TAU_S));
        smoothXRef.current = px;
        anchorXRef.current = px;
      } else {
        smoothXRef.current = null;
      }

      // 目标: 悬浮的字符最大, 两侧逐渐变小. 距离先减掉"指针位于本字符
      // 上"的容差 (DOCK_EDGE_RELIEF), 再进窄高斯 (DOCK_SIGMA_PX 只约一个
      // 字符间距), 两三步之外基本回落到 1
      const targets: number[] = new Array(n).fill(1);
      let energy = 0;
      for (let i = 0; i < n; i += 1) {
        if (px !== null) {
          const d = Math.max(0, Math.abs(m.slotLefts[i] + m.slotWs[i] / 2 - px) - m.slotWs[i] * DOCK_EDGE_RELIEF);
          targets[i] = 1 + (DOCK_MAX_SCALE - 1) * Math.exp(-(d * d) / (2 * DOCK_SIGMA_PX * DOCK_SIGMA_PX));
        }
        const v = sp.v[i] + (SPRING_K * (targets[i] - sp.s[i]) - SPRING_C * sp.v[i]) * dt;
        sp.v[i] = v;
        sp.s[i] += v * dt;
        energy = Math.max(energy, Math.abs(targets[i] - sp.s[i]), Math.abs(v));
      }
      if (energy < 0.0015) {
        // 收敛: 将 scale 置于目标值并再排一帧终版布局, 然后停止循环
        for (let i = 0; i < n; i += 1) {
          sp.s[i] = targets[i];
          sp.v[i] = 0;
        }
      }
      layoutPass();
      if (energy < 0.0015) return;
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  }, [layoutPass]);

  /** 只记录原始指针位置, 放大峰/锚点由帧循环统一从平滑值写入, 两者始终
      同一个 x, 且不会因 pointermove 的事件级跳变而抖动. 进入时也要记录, 否则
      最初几帧没有指针, 弹簧先按默认锚生长, 随后 move 又整体跳变 */
  const trackPointer = useCallback(
    (clientX: number) => {
      const box = containerRef.current;
      if (!box) return;
      pointerXRef.current = clientX - box.getBoundingClientRect().left;
      ensureLoop();
    },
    [ensureLoop]
  );

  useLayoutEffect(() => {
    measure();
    document.fonts?.ready.then(measure).catch(() => undefined);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      clearTimeout(eggTimerRef.current);
    };
  }, [measure]);

  // NiceDay回调经 ref 转发: 父组件重渲染不会触发 effect 重跑/定时器重置
  useEffect(() => {
    onAllClickedRef.current = onAllClicked;
  }, [onAllClicked]);

  // 1800ms 无后续点击 -> 级联恢复; 全部点完 -> 泡沫 + 级联恢复.
  // 依赖 gone: 每次点击都会重置/清理定时器, 自然实现"顺延".
  useEffect(() => {
    if (gone.size === 0) return;
    const cascade = () => {
      if (!REDUCED) setRestoring(true);
      setGone(new Set());
    };
    if (CLICKABLE.every((i) => gone.has(i))) {
      // 先让"全部消隐"状态停留一个间隔, 再泛泡沫并开始级联恢复; 泡泡飞起
      // FINALE_EGG_DELAY_MS 后 NiceDay 卡片才出现
      const timers: number[] = [];
      timers.push(
        window.setTimeout(
          () => {
            const box = containerRef.current;
            if (box && !REDUCED) {
              const w = box.offsetWidth;
              const h = box.offsetHeight;
              // foam 形: 整词范围里升起一泡沫更大的慢速泡泡
              setBubbles(
                Array.from({ length: 16 }, () => {
                  const size = 6 + Math.random() * 8;
                  return {
                    id: nextIdRef.current++,
                    x: 2 + Math.random() * Math.max(4, w - 4) - size / 2,
                    y: h * 0.45 + Math.random() * h * 0.4,
                    size,
                    burstX: 0,
                    burstY: 0,
                    drift: (Math.random() - 0.5) * 24,
                    rise: 42 + Math.random() * 20,
                    dur: 1400 + Math.random() * 500,
                    delay: Math.random() * 500,
                    form: "foam" as BubbleForm
                  };
                })
              );
            }
            cascade();
          },
          REDUCED ? 0 : FINALE_PAUSE_MS
        )
      );
      // NiceDay 定时器放在 ref 里: cascade 清空 gone 会让本 effect 重跑并
      // 清掉 timers, NiceDay 卡片需在这之后 ~1.1s 才触发, 不能跟着被清掉
      eggTimerRef.current = window.setTimeout(
        () => onAllClickedRef.current?.(),
        REDUCED ? 0 : FINALE_PAUSE_MS + FINALE_EGG_DELAY_MS
      );
      return () => timers.forEach(clearTimeout);
    }
    const t = window.setTimeout(cascade, Math.max(250, lastClickRef.current + RESTORE_AFTER_MS - Date.now()));
    return () => clearTimeout(t);
  }, [gone]);

  // 级联的收场: gone 清空且 restoring 仍开着 -> 播完级联再撤掉延迟状态
  // (期间新点击会立即 setRestoring(false), 不阻塞交互)
  useEffect(() => {
    if (gone.size > 0 || !restoring) return;
    const t = window.setTimeout(() => setRestoring(false), REDUCED ? 200 : RESTORE_SETTLE_MS);
    return () => clearTimeout(t);
  }, [gone, restoring]);

  /** 点击字符: 先给弹簧一个向上冲量, 碎片按当前可视盒 + 当前渐变切片向四周散开,
      同位迸出 pop 泡泡 (坐标在状态更新前取). 已消隐的字符不再响应点击,
      避免同一位置反复点击让字符无限"消隐/恢复"; 消隐后只能等级联自动恢复 */
  const onCharClick = useCallback(
    (i: number, el: HTMLSpanElement) => {
      // 已消隐: 直接忽略 (槽上也设了 pointer-events:none). 必须在更新
      // lastClickRef / restoring 之前返回, 否则点击已消隐的槽位会一直顺延自动恢复
      if (gone.has(i)) return;
      lastClickRef.current = Date.now();
      setRestoring(false);
      const box = containerRef.current;
      if (box && !REDUCED) {
        // Dock 反馈: 给该字符弹簧一个向上冲量 (确保循环在跑)
        const sp = springRef.current;
        if (sp.v.length === LABEL.length) {
          sp.v[i] += 2.6;
          ensureLoop();
        }

        const self = el.getBoundingClientRect();
        const base = box.getBoundingClientRect();
        const ox = self.left - base.left;
        const oy = self.top - base.top;

        // 碎片: 字符的"当前可视盒" (含 Dock 放大与位移) 复制 7 片,
        // 渐变切片也取当前值, 碎片颜色和原字逐像素一致
        const m = metricsRef.current;
        const frame = frameRef.current;
        const piece: Shard[] =
          m && frame
            ? Array.from({ length: 7 }, (_, k) => {
                const angle = (k / 7) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
                const dist = 13 + Math.random() * 17;
                const s = frame.s[i];
                const cbx = m.slotLefts[i] + m.slotWs[i] / 2;
                const cby = m.slotTops[i] + m.slotHs[i];
                // scale 以槽底边中心为锚: 可视盒 = 基准盒绕锚点缩放 + 位移
                const x = cbx + (m.charLefts[i] - cbx) * s + frame.dx[i];
                const y = cby - (cby - (m.slotTops[i] + m.charTops[i])) * s;
                return {
                  id: nextIdRef.current++,
                  x,
                  y,
                  w: m.charWs[i] * s,
                  h: m.charHs[i] * s,
                  bgW: frame.w,
                  bgX: x - frame.l0,
                  scale: s,
                  fs: m.fs,
                  char: LABEL[i],
                  dx: Math.cos(angle) * dist,
                  dy: Math.sin(angle) * dist * 0.85,
                  rot: (Math.random() - 0.5) * 150,
                  dur: 480 + Math.random() * 260,
                  delay: Math.random() * 60
                };
              })
            : [];
        setShards((prev) => [...prev, ...piece]);

        // pop 泡泡: 从点击处迸出, 先向四周散开, 再轻摆上升
        const burst: Bubble[] = Array.from({ length: 6 }, () => {
          const size = 4 + Math.random() * 4;
          return {
            id: nextIdRef.current++,
            x: ox + Math.random() * Math.max(2, self.width - size),
            y: oy + self.height * (0.2 + Math.random() * 0.62),
            size,
            burstX: (Math.random() - 0.5) * 26,
            burstY: (Math.random() - 0.5) * 18,
            drift: (Math.random() - 0.5) * 10,
            rise: 22 + Math.random() * 14,
            dur: 700 + Math.random() * 320,
            delay: Math.random() * 120,
            form: "pop" as BubbleForm
          };
        });
        setBubbles((prev) => [...prev, ...burst]);
      }
      setGone((prev) => {
        const next = new Set(prev);
        next.add(i);
        return next;
      });
    },
    [gone, ensureLoop]
  );

  /** 基于当前帧可视盒的命中反解 (替代挂在被 transform 槽上的 onClick):
      槽每帧被 Dock 动画改写 transform (放大 + 相邻推开 + 锚定位移), 命中区
      跟着漂移, 用户瞄准字符到鼠标按下的几十毫秒里字符已经移动, 加上 click
      要求 pointerdown/up 落在同一元素, 动画中很容易 down 在 A / up 在 B 而
      整段点击丢失. 这里按下瞬间直接用 clientX 与最新帧可视盒做一维最近邻,
      "点你所见" 命中视觉上最近的可点字符, 微小抖动也不会偏移到相邻字符. */
  const hitTestChar = useCallback(
    (clientX: number, clientY: number): number | null => {
      const box = containerRef.current;
      const m = metricsRef.current;
      if (!box || !m) return null;
      const rect = box.getBoundingClientRect();
      const px = clientX - rect.left;
      const py = clientY - rect.top;
      // 垂直放宽: 放大以底边为锚向上生长, 允许容器上下各 8px 内按下
      if (py < -8 || py > rect.height + 8) return null;
      const frame = frameRef.current;
      let best = -1;
      let bestDist = Infinity;
      for (const i of CLICKABLE) {
        if (gone.has(i)) continue;
        const s = frame ? frame.s[i] : 1;
        const dx = frame ? frame.dx[i] : 0;
        const center = m.slotLefts[i] + m.slotWs[i] / 2 + dx;
        const half = (m.slotWs[i] * s) / 2;
        // 指针在可视盒内记 0, 否则记到盒边的距离, 间隙归给更近的字符
        const d = Math.max(0, Math.abs(px - center) - half);
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      }
      // 距最近可视盒超过约一个字符宽时视为未命中, 不误触发
      if (best < 0 || bestDist > (m.slotWs[best] || 10)) return null;
      return best;
    },
    [gone]
  );

  const slotStyle = (i: number): CSSProperties | undefined =>
    restoring ? ({ "--brand-restore-delay": `${i * 45}ms` } as CSSProperties) : undefined;

  return (
    <span
      ref={containerRef}
      className="application-menu__brand"
      role="img"
      aria-label={LABEL}
      onPointerEnter={(event) => {
        if (REDUCED || event.pointerType === "touch") return;
        trackPointer(event.clientX);
      }}
      onPointerMove={(event) => {
        if (REDUCED || event.pointerType === "touch") return;
        trackPointer(event.clientX);
      }}
      onPointerLeave={() => {
        pointerXRef.current = null;
        ensureLoop();
      }}
      onPointerDown={(event) => {
        // 只响应主键 (鼠标左键 / 触摸 / 笔), 其余按键不触发消隐
        if (event.pointerType === "mouse" && event.button !== 0) return;
        const i = hitTestChar(event.clientX, event.clientY);
        if (i === null) return;
        const el = slotRefs.current[i];
        if (el) onCharClick(i, el);
      }}
    >
      {LABEL.split("").map((ch, i) => (
        <span
          key={i}
          ref={(el) => {
            slotRefs.current[i] = el;
          }}
          aria-hidden="true"
          className={`brand__slot${ch === " " ? " brand__slot--space" : ""}${gone.has(i) ? " is-gone" : ""}`}
          data-char={ch}
          style={slotStyle(i)}
        >
          <span
            ref={(el) => {
              charRefs.current[i] = el;
            }}
            className="brand__char"
          >
            {ch === " " ? "\u00A0" : ch}
          </span>
        </span>
      ))}
      {shards.map((s) => (
        <span
          key={s.id}
          className="brand__shard"
          aria-hidden="true"
          style={
            {
              left: s.x,
              top: s.y,
              width: s.w,
              height: s.h,
              fontSize: `${s.fs * s.scale}px`,
              lineHeight: `${22 * s.scale}px`,
              backgroundSize: `${s.bgW}px 100%`,
              backgroundPosition: `${-s.bgX}px 0`,
              "--sx": `${s.dx}px`,
              "--sy": `${s.dy}px`,
              "--rot": `${s.rot}deg`,
              animationDuration: `${s.dur}ms`,
              animationDelay: `${s.delay}ms`
            } as CSSProperties
          }
          onAnimationEnd={() => setShards((prev) => prev.filter((q) => q.id !== s.id))}
        >
          {s.char}
        </span>
      ))}
      {bubbles.map((b) => (
        <span
          key={b.id}
          className={`brand__bubble brand__bubble--${b.form}`}
          aria-hidden="true"
          style={
            {
              left: b.x,
              top: b.y,
              width: b.size,
              height: b.size,
              "--bx": `${b.burstX + b.drift}px`,
              "--by": `${b.burstY}px`,
              "--rise": `${b.rise}px`,
              animationDuration: `${b.dur}ms`,
              animationDelay: `${b.delay}ms`
            } as CSSProperties
          }
          onAnimationEnd={() => setBubbles((prev) => prev.filter((q) => q.id !== b.id))}
        />
      ))}
    </span>
  );
}
