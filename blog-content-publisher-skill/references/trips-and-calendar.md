# 旅行与日历

旅行行程和日历条目的维护细则。字段契约以 `src/content/schema.ts` 为准；导入的转换与校验规则在 `src/utils/pitravel.mjs`（圆周旅迹）和 `src/utils/trip-draft.mjs`（手写草稿），和这里冲突时听代码。

## 旅行 `/trips/`

站内只保存导入脚本生成的中立数据：每段旅程一个目录 `src/data/trips/<id>/`，里面是 `trip.json` 和它引用的图片。不要手写或手改 `trip.json` 和图片，路线、里程和图片压缩都由脚本生成。数据里不保存来源链接、圆周行程 ID 或账号信息。「计划」和「记录」由日期自动标注（结束日已过为记录），不写进数据，未来的行程直接按计划整理。

行程有两种来源，用同一个脚本导入：

- **圆周旅迹分享链接**，形如 `https://www.pitravel.cn/plan/journey/<数字>?lang=cn`。行程必须在圆周旅迹里设为公开。
- **用户给的照片和信息**：一堆照片（有没有定位、时间都可以），加上文字行程、聊天记录、截图、订单等。由你带用户整理成草稿 JSON，再交给脚本。

### 共同步骤

1. 先读现有旅程：列出 `src/data/trips/*/trip.json` 的目录名、`title`、`start`、`end`。
2. 定 `id`：
   - 更新已有旅程（标题相同，或日期重叠且用户确认是同一段）时，沿用原目录名。
   - 新旅程用短 ASCII：`<年份>-<地名拼音>`，如 `2026-chongqing`；重名时加月份或序号。只允许小写字母、数字和连字符。
   - `id` 就是页面地址 `/trips/#<id>`，发布后不改。
3. 先校验：每次都先带 `--check` 运行导入命令（见下面两节）。它只拉取、转换和校验，不下载图片、不请求路线服务、不写文件。按下一节的分类处理问题，直到校验干净。
4. 再正式导入：去掉 `--check` 重跑（需要联网，约一分钟）。脚本逐段请求打车、开车、步行或骑行路线，飞机、火车、船和公共交通画直线；下载或读取并压缩图片（GIF 动图保留动画，存成动图 WebP；其余转 JPEG）；整体替换目标目录，中途失败不会留下半份数据。封面拼图优先用各站照片；一张都没有时才用来源给的封面候选和地点实景图，最多三张；什么图都没有时，页面显示标题首字与路线轮廓。
5. 读脚本输出的摘要和警告，逐条告诉用户：
   - 「路线请求失败，按直线处理」可以稍后重新导入。
   - 远程图片下载失败会被跳过；本地图片路径写错会直接报错。
6. 照片会公开展示，提醒用户确认都是自己可以公开的图片。
7. 内容有误时改来源（圆周旅迹或草稿），再用同一个 `--id` 重新导入，整个目录会被覆盖；覆盖前按标题和日期确认是同一段旅程。删除旅程就删整个目录。
8. 运行 `pnpm check`、`pnpm build`、`pnpm test:built-restructure`。需要预览时启动或复用 dev，打开 `/trips/#<id>`；导入时 dev 已在运行的，先重启 dev（导入是整目录替换，dev 的内容缓存会停在旧数据上，图片显示为裂图）。地图底图来自在线的 OpenFreeMap，断网时页面只显示面板，这不是导入失败。
9. 交接时说明：`id`，天数、地点数、照片数和封面候选数，直线路段数，全部警告，以及目录大小。

### 校验问题的三类

`--check` 和正式导入都把问题分三组打印。出现前两组时退出码为 1，什么都没写入。

| 分组 | 含义 | 怎么做 |
| :--- | :--- | :--- |
| 【来源未覆盖】 | 圆周旅迹返回了适配器 `src/utils/pitravel.mjs` 没有映射的取值，如新的事件类型、交通代码、坐标系 | 告诉用户来源里多了什么，提议更新适配器；改完重新校验 |
| 【本站 schema 表达不了】 | 数据超出本站 `tripSchema`（`src/content/schema.ts`）的范围，如视频、实况照片，或生成的 `trip.json` 没通过 `tripSchema` | 说明表达不了什么，先问用户：扩展 schema（属于实现改动，征得同意再做），还是在来源里调整、接受取舍 |
| 【个别条目降级】 | 个别条目缺数据，已跳过或降级 | 逐条告诉用户，不改代码；能在来源补全的补全后重新导入 |

只有校验干净（或只剩用户认可的降级）才正式导入。

### 从圆周旅迹导入

```bash
pnpm trips:import '<分享链接>' --id <id> --check
pnpm trips:import '<分享链接>' --id <id>
```

坐标会从 GCJ-02 转成 WGS84；航班、火车、船、公交等交通安排拆成出发和到达两站；「待计划」里的地点不导入。要改内容就先在圆周旅迹里改。

### 用照片和信息手动整理

用户没有圆周行程，发来一堆照片和零散信息时：

1. 读照片。用户发来的图片先存成文件，和草稿一起放在 `.local/` 或仓库外，不提交。然后运行：

   ```bash
   pnpm trips:photos <照片或目录>... --geocode
   ```

   stdout 是 JSON：`photos` 是每张图的绝对路径、宽高、是否动图、拍摄时间 `takenAt`（拍摄地的本地时刻）、时区 `offset` 和 WGS84 坐标 `coordinates`；`places` 是按日期、时间间隔（超过 90 分钟）和距离（超过 500 米）归出的候选地点，带日期、起止时刻、平均坐标和照片列表，`--geocode` 时再附 OpenStreetMap Nominatim 给的 `name`、`address`。候选只是起点，名字常是附近的店铺或路名，要和用户核对。逆地理编码失败只在 stderr 警告。
2. HEIC／HEIF 照片要先在 macOS 上转成 JPEG，草稿里引用转换后的文件：`sips -s format jpeg <原图.heic> --out <新图>.jpg`。读照片时遇到解码不了的 HEIC，脚本会给出这条命令。
3. 按顺序带用户逐步确认，一步确认完再进下一步，不要一次问完：
   1. 标题和起止日期。
   2. 逐天确认地点：名称、坐标、时间、分类和 emoji。没有定位的照片，问用户在哪；也可以按前后照片的时间和地点给出推断，请用户确认后再用。
   3. 逐段确认交通方式和明细：班次号、起止时刻、公交线路、票价等。
   4. 备注：感受、花费、提醒写进各站 `note`，一天的概括写 `summary`。
   5. 写草稿 JSON，先校验，按报错改草稿，干净后正式导入：

      ```bash
      pnpm trips:import --from <草稿.json> --id <id> --check
      pnpm trips:import --from <草稿.json> --id <id>
      ```

整理时间线时：按日期分天、按时间排序；用户没安排的日子保留空的 `stops`，不确定的时间就不写，不要编造。航班、火车、船拆成出发和到达两站，班次写在出发站的 `service` 里。

坐标必须查证，不凭印象写：

- 照片自带的坐标就是 WGS84，可以直接用。
- 其余优先用 OpenStreetMap Nominatim（`https://nominatim.openstreetmap.org/search?q=<地名 城市>&format=json&limit=3`，结果是 WGS84），按地址和城市核对是同一处。
- 用户给的是高德、腾讯地图的坐标或链接里的坐标时属于 GCJ-02，在草稿顶层写 `"coordinateSystem": "gcj02"`；同一份草稿只用一种坐标系，混用时先把其中一种换算过来。
- 查不到或有歧义时问用户，不要猜。

### 草稿格式

草稿是纯 JSON，由 `src/utils/trip-draft.mjs` 校验。下面示例里的 `//` 注释只作说明，写文件时去掉。

```jsonc
{
  "title": "重庆周末",
  "coordinateSystem": "wgs84", // 可省，或 "gcj02"
  "cover": ["./cover.jpg"], // 可选，各站都没有照片时才用
  "days": [
    {
      "date": "2026-12-05", // YYYY-MM-DD，严格递增
      "summary": "飞重庆·解放碑", // 可选
      "stops": [
        {
          "name": "南京禄口国际机场",
          "coordinates": [118.8697, 31.7356], // [经度, 纬度]
          "category": "交通", // 以下均可选
          "emoji": "✈️",
          "time": { "start": "07:30" },
          "travel": "flight", // 去下一站的方式
          "travelMinutes": 145,
          "service": { "number": "MU2805", "depart": "08:10", "arrive": "10:35" }
        },
        {
          "name": "重庆江北国际机场",
          "coordinates": [106.6417, 29.7192],
          "travel": "transit",
          "travelMinutes": 50,
          "transit": {
            "fare": "7 元",
            "lines": [{ "name": "轨道交通 10 号线", "from": "T2 航站楼", "to": "红土地", "stops": 9 }]
          }
        },
        {
          "name": "解放碑",
          "coordinates": [106.5772, 29.5572],
          "category": "景点",
          "address": "重庆市渝中区…",
          "time": { "start": "11:30", "end": "13:00" },
          "note": "…",
          "photos": ["./photos/jfb.jpg"] // 相对草稿文件的路径或 http(s) 地址
        }
      ]
    },
    { "date": "2026-12-06" } // 没安排的日子
  ]
}
```

- 顶层：`title` 必填；`coordinateSystem` 可省（默认 `wgs84`，或 `gcj02`）；`cover` 是封面候选；`days` 至少一天，每天 `date` 必须真实存在且严格递增，`summary`、`stops` 可省。
- 每站：`name` 与 `coordinates` 必填；`category`、`emoji`、`address`、`note` 是非空文字；`time` 是 `{ "start"?: "HH:mm", "end"?: "HH:mm" }`，至少一项；`photos` 是相对草稿文件的路径或 http(s) 地址。
- 交通字段都描述「从这一站去下一站」，`travel` 默认 `drive`：

| `travel` | 含义 | 地图画法 | 可加字段 |
| :--- | :--- | :--- | :--- |
| `flight` | 飞机 | 两点直线，粗虚线 | `travelMinutes`、`service` |
| `train`／`ferry` | 火车／船 | 两点直线 | `travelMinutes`、`service` |
| `taxi`／`drive`／`walk`／`bike` | 打车／开车／步行／骑行 | 公共 Valhalla 路网路线，时长由路线给出；请求失败按直线 | 无 |
| `transit` | 公共交通 | 没有路线时画直线并标出 | `travelMinutes`、`transit` |

- `travelMinutes` 是正数分钟；`service` 是 `{ "number"?, "depart"?: "HH:mm", "arrive"?: "HH:mm" }`，至少一项；`transit` 是 `{ "fare"?, "lines": [{ "name", "from"?, "to"?, "stops"? }] }`，`lines` 至少一条，`stops` 是正整数站数。
- 整段旅程的最后一站没有下一站，不写 `travel`、`travelMinutes`、`service`、`transit`。
- 路段属于出发那一天：夜车、红眼航班这类跨天路段，出发站写在出发日，到达站写在次日，里程计入出发日。

校验从严：未知字段、类型不对、不存在的日期、日期顺序、坐标范围、时间格式、未知交通方式、交通字段和方式不匹配（如开车写了 `travelMinutes`、火车写了 `transit`）、最后一站写了交通字段，都会报错并指出位置，按提示改草稿后重跑。

圆周旅迹接口、Nominatim 和公共路线服务都可能变化或限流。导入失败时原样报告错误，不要手工伪造数据。

## 日历条目

日历记录某一天的小事：一段文字、几张照片，或二者都有。每条一个目录 `src/data/calendar/<id>/entry.md`，图片放在同一目录。

1. 先列出 `src/data/calendar/*/entry.md` 的目录名、`title`、`date`，避免重复。
2. 定 `id`：建议 `YYYY-MM-DD-<短名>`，如 `2026-12-20-first-snow`；只允许小写字母、数字和连字符，发布后不改。
3. 有照片时先运行 `pnpm trips:photos <照片> --geocode`，用读到的拍摄时间和地点填 `date`、`time`、`place`，和用户确认后再写。
4. 写 `entry.md`：

```markdown
---
title: 初雪
date: 2026-12-20
time: '08:15'
place:
  name: 玄武湖
  coordinates: [118.7953, 32.0703]
photos:
  - ./snow.jpg
  - ./snow.gif
---

早上推开窗，湖面一层白。
```

- `title`、`date`（`YYYY-MM-DD`）必填。
- `time` 可选，`HH:mm`，要加引号，否则 YAML 可能把它当成数字。
- `place` 可选，`name` 和 `[经度, 纬度]` 都要写，坐标用 WGS84。高德、腾讯等国内地图给的是 GCJ-02，先换算：`node -e "import('./src/utils/pitravel.mjs').then((m) => console.log(m.gcj02ToWgs84(<经度>, <纬度>)))"`。查不到坐标就问用户，不要猜。
- `photos` 可选，相对 `entry.md` 的图片路径，GIF 可以；HEIC 先转 JPEG。图片长边 1600px 以内即可，构建时会生成响应式 WebP；原图过大时用 `sips -Z 1600 <原图> --out <新图>` 缩小。
- 正文是文字，可以为空；只有文字或只有照片的条目都可以。

有 `place` 的条目会出现在旅行地图上，并能从条目跳到地图上的位置。日历条目和旅程互不关联，不要往条目里写旅程 `id`，也不要为了日历去改旅程数据。照片会公开展示，同样提醒用户确认可以公开。删除条目就删整个目录。

改完运行 `pnpm check` 和 `pnpm build`。交接时说明 `id`、日期、是否有地点、照片数和构建结果。
