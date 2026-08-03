# SST / 注意偏向 14 天训练微信小程序

本项目按《行为训练任务开发要求-陆静修改版》实现两类科研行为任务：停止信号任务（SST）和注意偏向训练（ABM）。主包只包含训练营首页；SST、注意偏向和数据导出分别位于独立分包。大图和提示音不进入代码包，均在每个区块开始前从 CDN 预加载。

## 已实现流程

- 第 1 天：SST 操作指导（32 试次）→ SST 正式测量（3×72 试次）。
- 第 2 天：SST 干预（3×60）→ 注意偏向练习（20）→ 注意偏向正式训练（6×50）。
- 第 3—13 天：SST 干预（3×60）→ 注意偏向正式训练（6×50）。
- 第 14 天：SST 正式测量（3×72）。
- SST 测量：Go/Stop=75%/25%，Go 连续不超过 4 次，SSD 以 50ms 步长在 50—500ms 内追踪。
- SST 干预：Go/Stop=60%/40%，Stop 连续不超过 3 次，首尾不连续 3 个 Stop；动态步长 30→20→10ms，当天跨块继承、次日重置。
- 注意偏向：探测点始终位于中性图片原位置，左右各半、同侧连续不超过 4 次；正式任务每天从 250ms、40ms 步长开始，反转后为 20ms、10ms。
- 所有科研反应时使用 `wx.getPerformance().now()`，底层反应事件使用 `touchstart` / `touchend`，不使用 `click` 或 `Date.now()` 计算反应时。
- 每个区块保存随机种子；逐试次保存预设值、实际时长、触摸时间、坐标、结果和原始事件；支持 JSON 与 CSV 导出。
- 应用进入后台时立即暂停并记录中断，未完成试次会重新呈现；已完成试次通过检查点恢复。

## CDN 上传与配置

素材总量较大，严禁复制到 `miniprogram/`。上传脚本默认读取：

- `/Users/songyijie/Documents/创业/陆静-游戏成瘾训练/游戏图片`
- `/Users/songyijie/Documents/创业/陆静-游戏成瘾训练/中性图片`

脚本支持 AWS S3、Cloudflare R2 等 S3 兼容对象存储，使用 macOS `sips` 将图片最长边压到 1600px、JPEG 质量 78；提示音由脚本生成 80ms 单次“滴”声。对象使用一年不可变缓存，上传后自动更新两个分包内的 CDN 根地址。

```bash
export CDN_ENDPOINT='https://<account>.r2.cloudflarestorage.com'
export CDN_BUCKET='<bucket>'
export CDN_ACCESS_KEY_ID='<key-id>'
export CDN_SECRET_ACCESS_KEY='<secret>'
export CDN_PUBLIC_BASE_URL='https://cdn.example.org'
export CDN_REGION='auto'
python3 scripts/upload_cdn.py --dry-run
python3 scripts/upload_cdn.py
```

随后在微信公众平台把 `CDN_PUBLIC_BASE_URL` 的域名加入 downloadFile、request 合法域名。正式发布前不要关闭微信开发者工具的 URL 合法域名校验。

## 开发与验证

1. 用微信开发者工具打开项目根目录，填写真实 `appid`（当前为 `touristappid`）。
2. 配置 CDN，并确认资源域名已加入小程序后台白名单。
3. 执行 `npm test` 校验随机化与自适应算法。
4. 执行 `npm run check:size` 校验主包体积和“包内无任务媒体”规则。
5. 真机测试长按、松开、点击、音画同步、后台切换和断点恢复。开发者工具鼠标事件无法替代最终真机时序验证。

## 研究规则说明

文档中注意偏向呈现时长有两版规则。本实现采用后出现的“规则更改”：每天重置 250ms 和 40ms 步长，第 1、2 次反转后降至 20ms、10ms，不跨天继承。

另有一处定义冲突：文档规定探测点必须始终位于中性图片原位置，同时要求计算“探测点与游戏图片同侧/异侧”的传统偏向分数。按前一条规则，探测点与游戏图片永远异侧，因此同侧 RT 不存在。本实现严格保持探测点位于中性图片位置，原始数据写入 `probeGameRelation: "opposite"`，汇总中的同侧 RT 和偏向分数留空并附原因，避免生成伪数据。

## Git 备份

本地仓库的 `origin` 已配置为 `https://github.com/yijiesung/SST.git`。该远端当前要求 GitHub 身份认证；登录后执行：

```bash
git push -u origin main
```

