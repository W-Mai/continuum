# 无缝无限赛道赛车游戏 — 设计

## 目标形态

一个可以当壁纸用的赛车游戏：车在无限延伸的赛道上自动行驶，沿途穿过截然不同的世界（太空、地底、地狱、天堂、山间、城市、沙漠、深海），切换时没有任何黑屏或跳变。也能手动驾驶。

技术栈固定为 three.js r160（仓库内已 vendored）+ 浏览器 ES modules，不引入新依赖。

## 1. 无限赛道

### 中心线用曲率积分，不用样条

样条需要预先给出控制点，无限延伸时控制点本身成了问题。改成对**曲率**做噪声积分：

```
kappa(s) = sum over octaves of A_i * sin(2*pi*s / L_i + phase_i)
theta(s) = integral of kappa
p(s)     = integral of (cos theta, sin theta)
```

好处：
- 天然 O(1) 采样，任意 `s` 都能算，不需要"生成控制点"
- 曲率连续，方向盘转角就连续，车不会突然甩
- 换 biome 只改 `A_i` 和 `L_i`，路的「性格」跟着变（山间多弯、太空长直）

各 octave 振幅之和控制在 0.022 以内，对应最小转弯半径约 45 m。

### 采样与浮点精度

采样间隔 `STEP = 2 m`，用 float64 累加位置。用 Map 按索引缓存，窗口 `[s_car - 400, s_car + 1600]`，窗外回收。

长时间运行会累积坐标，所以当 `|p| > 20000` 做一次**浮动原点重基**：把所有活跃采样点和场景物体位置减去同一常量，车回到原点附近。float32 顶点就不会抖动。

### 赛道网格分块与回收

每 24 个采样点一个 chunk（48 m），含路面、路肩、边线。chunk 用对象池复用，`BufferGeometry` 的 `position` 属性原地改写后 `needsUpdate = true`，不新建 geometry。这是长时间运行不泄漏的关键。

## 2. 车辆动力学

用**自行车模型 + 轮胎侧偏角**，而不是「按键直接改朝向」。

状态：位置、航向 `yaw`、世界速度、横摆角速度 `r`。

每轴侧偏角：
```
alpha_f = atan2(vy + a*r, vx) - delta
alpha_r = atan2(vy - b*r, vx)
```

轮胎侧向力用「线性区 + 饱和」：
```
F = -mu * Fz * tanh(C * alpha / mu)
```
`tanh` 让线性区自然过渡到滑动区，不用分段也不会数值爆炸。

纵向：引擎驱动力随速度衰减、滚阻、空气阻力、刹车。加速时后轴载荷转移，后轮附着力随油门上升。

积分固定步长 `1/120 s`，与渲染帧率解耦（累加器模式），30fps 和 144fps 手感一致。

## 3. 自动驾驶

**纯跟踪（pure pursuit）+ 曲率限速**：

- 前方 `Ld = clamp(8 + v*0.55, 10, 34)` 处取目标点
- 由几何关系算目标转向角
- 速度上限由前方 40 m 内最大曲率决定：`v_max = sqrt(mu*g/|kappa|)` 再乘保守系数
- 转向输出经一阶低通，模拟人不会瞬间打满

在 45 m 最小半径、`mu=1.1` 的赛道上稳定。掉出路面时用「回到最近中心线点」恢复，不会永远卡死。

## 4. 场景系统

biome 是**纯数据 + 一个装饰物生成函数**：

```js
{
  id, name,
  sky:   { top, bottom, starDensity, sunAngle, sunColor },
  fog:   { color, near, far, density },
  lights:{ hemiSky, hemiGround, keyColor, keyIntensity, ambient },
  road:  { asphalt, lineColor, shoulderColor },
  terrain:{ kind, colorA, colorB, roughness, heightAmp },
  props: { density, spawn(index, transform) },
  car:   { envIntensity },
}
```

8 种：`alpine` `desert` `city` `space` `cavern` `inferno` `heaven` `abyss`。

装饰物（树、楼、水晶、岩浆柱）由共享实例化池管理，每种 biome 有自己的 `spawn`。池总量固定，换 biome 时复用同一批 slot，只换几何和材质引用——不新增 draw call，也不新增内存。

## 5. 无缝切换（核心难点）

不用「淡入淡出」的假过渡，而是让**所有视觉参数本身连续变化**。

维护 `blend ∈ [0,1]` 与 `from / to` 两个 biome。所有可插值项每帧按 `blend` 取值：
- 天空渐变颜色、星星密度、太阳角度与颜色
- 雾色、雾距
- 三盏灯的颜色与强度、环境光
- 路面颜色、地形颜色
- 装饰物的**缩放与不透明度**（旧的在 blend→1 时缩到 0，新的从 0 长出）
- 车漆环境反射强度

每项都是连续函数，屏幕上没有一项突然改变，所以没有可感知接缝。

触发方式：手动按键轮换；壁纸模式每 60~90 秒自动切换。

`blend` 用 smootherstep 缓动，时长 6 秒。切换期间赛道曲率参数跟着插值，路的形态也是连续变形，不是硬切。

物理上再叠一层**过渡门**：切换窗口内，在车前方生成逐渐收拢的光环/门框，车穿过它时正好是 blend 中点。视觉上给出「穿越」的因果感。

## 6. 壁纸模式

- 全屏（Fullscreen API）、隐藏 HUD
- 自动开启自动驾驶 + 自动轮换 biome
- 空闲时降开销：`setPixelRatio` 按帧率自适应；持续掉帧就降 shadow map 分辨率，而不是掉帧
- 标签页隐藏（`visibilitychange`）暂停循环，回来继续

## 7. 性能与不泄漏

- 固定对象池：chunk 24 个、装饰物 600 个、粒子固定数
- 每帧不 `new` Vector3/Matrix4（用模块级 scratch）
- geometry 复用，`dispose` 只在真正替换材质时调用
- 帧率监控：滚动平均，掉到 45fps 以下降级，升回 55 以上恢复

## 验证方式

不能只靠"打开看了看"。要能机械化验证：

1. `tools/game_check.mjs` — 无头 Chrome 跑固定帧数，断言：
   - 行驶距离单调增长（在跑）
   - 自动驾驶没冲出路面（横向偏差 < 路宽）
   - 切换 biome 后参数确实变了，且 blend 过程中相邻帧参数差 < 阈值（连续性断言）
   - 几何/纹理数量不随帧数增长（泄漏断言）
2. `tools/game_shots.mjs` — 逐个 biome 出图，人眼复核美术
3. 页面内置 FPS/帧时间 overlay，可按键开关
