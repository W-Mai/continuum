# 程序化跑车模型

一台中置引擎双门跑车的 3D 模型，用纯 Python 标准库从参数生成。没有 Blender、没有建模软件、没有第三方包——车身的每一根曲线都是 `carmodel/` 里的一段函数。

这台车也是同仓库 `Endless Drive` 的游戏主角，见 [game-README.md](game-README.md)。

```
4500 × 1816 × 1312 mm   轴距 2700 mm   20 英寸轮毂   45,900 三角面
```

## 先看东西

```bash
python3 build.py --verify      # 生成 out/car.obj + out/car.glb，并跑几何自检
open preview.html              # 浏览器里转圈看
```

`preview.html` 直接打开即可（用 `file://`），六个预设视角、线框叠加、自动旋转、实时显示尺寸。

## 交付物

| 文件 | 说明 |
|---|---|
| `out/car.obj` + `out/car.mtl` | 通用网格，Z 轴朝上，毫米单位。Blender / C4D / Maya 直接导入 |
| `out/car.glb` | glTF 2.0 二进制，已烘焙成 Y 轴朝上 + PBR 材质。网页 / Unity / Unreal 直接用 |
| `preview.html` | 交互预览页，orbit 控制 + 预设机位 |
| `out/renders/*.png` | 六视角渲染图，1600×1000 |
| `out/report.json` | 每个部件的顶点/面数、材质清单、自检结果 |

两种网格格式的分轴差异是刻意的：OBJ 保持建模习惯的 Z-up 便于人工编辑，GLB 按 glTF 规范烘焙成 Y-up，所以任何查看器都不会把车放躺。

## 模型构成

14 个具名部件，在 OBJ 里各自独立成组，可以直接单独选中修改：

| 组 | 内容 |
|---|---|
| `body_hull` | 下车身壳体。截面从一侧座舱边缘翻过肩线、沿侧围、进轮拱口、下到车底再加到另一侧 |
| `body_deck` | 引擎盖与发动机盖板，封住座舱以外的顶面 |
| `body_canopy` | 座舱盖。有真实厚度的双层壳：外皮、内饰顶棚、窗框边缘 |
| `body_cockpit` | 座舱地板、内壁、前后隔板 |
| `detail_front_end` | 前唇、格栅、进气口 |
| `detail_headlights` | 贴合车头曲面的灯组与日行灯 |
| `detail_rear_end` | 贯穿式尾灯、扩散器、四出排气 |
| `detail_wing` | 尾翼、端板、鹅颈支架 |
| `detail_sides` | 侧裙、中置引擎进气口、后视镜、油箱盖、前轮后排气口 |
| `detail_interior` | 两张桶椅、方向盘、仪表台、中央通道 |
| `wheel_fl / fr / rl / rr` | 四个轮组：轮胎、轮毂、辐条、刹车盘、卡钳、轮毂螺母 |

## 怎么长出来的

车身不是一堆拼起来的方块，而是**按站（station）扫出来的**：

1. `profile.py` 定义四条纵向设计曲线——plan view 半宽、门槛高度、腰线高度、轮拱开口。
2. `body.py` 在每个站上按这些曲线生成一个横截面环，环上各点的位置由三条截面公式给出（肩部、侧围、轮拱）。
3. 相邻截面之间桥接成四边形，就是车壳。

这样做的直接好处是：轮拱不是"挖"出来的，而是截面在轮拱区间自然抬高——所以没有布尔运算的破面，也没有补丁接缝。座舱同理，截面顶部留空就是敞口。

座舱盖用的是**超椭圆截面**（`|sin|^0.55`），侧向增长集中在下半段，于是得到又高又直的侧窗带，配上圆润的车顶。用普通椭圆会得到一个圆滚滚的玻璃罩。

细节件（灯、进气口、裙边）不是浮在车外的独立物体，而是通过 `surface.py` 查询车身实际曲面后**贴在皮上**再沿法线挤出。所以改设计曲线时它们会跟着走，不会飘出去——`build.py --verify` 里的 clearance 检查就是在守这条线。

## 材质

17 种材质，全部 PBR 参数（颜色 / 金属度 / 粗糙度 / 透明度 / 自发光）。车漆是金属漆（metallic 0.55, roughness 0.28），玻璃用 `alphaMode: BLEND`，尾灯与日行灯带自发光。

在 `materials.py` 里改一行换色；`MATERIALS["paint"]["color"] = (0.05, 0.12, 0.42)` 就是一台蓝车。

## 自检

`python3 build.py --verify` 会跑完这些，任何一项不过就非零退出：

| 检查 | 断言 |
|---|---|
| `bounds` | 总长 4500±60 mm，总宽 1800±90 mm，最低点贴地 z=0 |
| `winding` | 每个闭合子壳的有符号体积必须为正（法线朝外）。按连通分量判定，因为包围盒中心对非凸壳体不成立 |
| `clearance` | 轮胎不穿出车身，轮拱顶部高于胎顶 |
| `materials` | 用到的材质名必须都在调色板里 |
| `closure` | 报告每个部件的开放边数 |

另外两个独立验证：

```bash
python3 tools/check_preview.py   # 无头浏览器打开预览页，断言 HUD 数字由几何算出
python3 tools/render_shots.py --check   # 渲染一帧并做空白检测
```

## 渲染管线

`tools/render_shots.py` 驱动无头 Chrome 打开 `tools/render.html`，用 three.js 渲染并截图。全部离线（three r160 已 vendored 到 `tools/vendor/`）。

```bash
python3 tools/render_shots.py --model out/car.glb --outdir out/renders \
    --views hero34,side --width 1600 --height 1000 [--wire] [--bg '#1b2a3a']
```

两个环境相关的坑值得记一下：`requestAnimationFrame` 在 `--virtual-time-budget` 下只触发一次，所以渲染循环用 `setTimeout` 链；动态 `import()` 在虚拟时间下不会 resolve，所以页面只用静态 import。

## 改参数

尺寸全在 `carmodel/params.py`（毫米），外形曲线在 `carmodel/profile.py`。例如拉长轴距：

```python
AXLE_F = 1450.0
AXLE_R = -1420.0
```

轮距会根据胎宽自动重算（`arch_list()`），不用手工对齐。

## 目录

```
build.py                总装 + 导出 + 自检
preview.html            交互预览
carmodel/
  params.py             尺寸常量
  profile.py            纵向设计曲线
  body.py               车身壳体 / 盖板 / 座舱盖 / 内舱
  wheels.py             轮组（轮胎、轮毂、辐条、刹车）
  details.py            灯组、格栅、尾翼、后视镜、内饰等
  surface.py            车身曲面查询（细节件贴合用）
  geom.py               网格基元：向量、放样、旋转体、挤出、椭球
  materials.py          材质调色板
  export.py             OBJ/MTL 与 GLB 写出（含回读校验）
tools/
  render.html           离屏渲染页
  render_shots.py       截图驱动 + PNG 空白检测
  check_preview.py      预览页自动化验证
  vendor/               three.js r160
```

## 已知取舍

- 曲面是低多边形硬边风格（`HULL_STATIONS = 130` 个站）。要更平滑就调高这个数，但面数会线性涨。
- 轮拱开口是椭圆近似，不是真正的圆弧翼子板。
- 内饰只做到能透过玻璃看出来的程度，不是可拆解的结构。
- 没有 UV 贴图坐标——材质靠 PBR 参数而不是纹理。
