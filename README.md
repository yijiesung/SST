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


项目已按腾讯云 COS 作为正式素材存储方案配置。脚本使用 macOS `sips` 将图片最长边压到 1600px、JPEG 质量 78；提示音由脚本生成 80ms 单次“滴”声。对象使用一年不可变缓存，上传后自动更新两个分包内的 CDN 根地址。

先在腾讯云 COS 控制台创建存储桶，记录完整存储桶名称（必须包含腾讯云账号 APPID 后缀，例如 `sst-training-1250000000`）和地域（例如 `ap-shanghai`）。生产环境建议使用 COS 作为源站连接腾讯云 CDN 自定义域名；若使用私有读存储桶，需要给 CDN 服务完成回源授权。最终填写到 `COS_PUBLIC_BASE_URL` 的 HTTPS 地址必须能匿名读取图片和音频。

上传密钥应使用 CAM 子账号并限定到该存储桶。脚本至少需要 `cos:PutObject`；使用 `--resume` 时还需要对象查询权限。不要使用主账号密钥，不要把 SecretKey 写进项目文件。

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-cos.txt

export COS_SECRET_ID='<CAM 子账号 SecretId>'
export COS_SECRET_KEY='<CAM 子账号 SecretKey>'
export COS_BUCKET='<存储桶名称-APPID>'
export COS_REGION='<地域，例如 ap-shanghai>'
export COS_PUBLIC_BASE_URL='https://<COS 自定义域名或 CDN 域名>'

python scripts/upload_cos.py --dry-run
python scripts/upload_cos.py --resume
```

`COS_SECRET_ID`、`COS_SECRET_KEY` 应使用仅对目标存储桶具有对象上传/查询权限的 CAM 子账号密钥，不要写入代码或提交到 Git。`COS_PUBLIC_BASE_URL` 必须能匿名 HTTPS 读取对象；可使用公开读存储桶的自定义域名，或使用 COS 作为源站的腾讯云 CDN 域名。

随后在微信公众平台把 `COS_PUBLIC_BASE_URL` 的域名加入 `downloadFile 合法域名`。工程中的图片和提示音均通过下载接口预加载；域名只填写 `https://主机名`，不要附带 `/sst-assets` 路径、端口或末尾斜杠。正式发布前不要关闭微信开发者工具的 URL 合法域名校验。

运行时始终通过 HTTPS 域名访问素材，不保存、绑定或校验本地/公网 IP。资源连接失败会重新创建下载任务并有限重试；网络恢复时自动续载，错误页也可手动点击“重新加载”。

## 开发与验证

1. 用微信开发者工具打开项目根目录；AppID 已配置为 `wxad7881ff77589f11`。
2. 配置 CDN，并确认资源域名已加入小程序后台白名单。
3. 执行 `npm test` 校验随机化与自适应算法。
4. 执行 `npm run check:size` 校验主包体积和“包内无任务媒体”规则。
5. 真机测试长按、松开、点击、音画同步、后台切换和断点恢复。开发者工具鼠标事件无法替代最终真机时序验证。

## 研究规则说明

文档中注意偏向呈现时长有两版规则。本实现采用后出现的“规则更改”：每天重置 250ms 和 40ms 步长，第 1、2 次反转后降至 20ms、10ms，不跨天继承。

另有一处定义冲突：文档规定探测点必须始终位于中性图片原位置，同时要求计算“探测点与游戏图片同侧/异侧”的传统偏向分数。按前一条规则，探测点与游戏图片永远异侧，因此同侧 RT 不存在。本实现严格保持探测点位于中性图片位置，原始数据写入 `probeGameRelation: "opposite"`，汇总中的同侧 RT 和偏向分数留空并附原因，避免生成伪数据。


确认远端是否已有提交后再决定直接推送或合并；不要使用强制推送覆盖未知远端历史。
