# 地理数据与底图

## 底图（在线）

地图使用 [Leaflet 1.9.4](https://leafletjs.com)（BSD-2，见 `../vendor/Leaflet-LICENSE.txt`）加载栅格瓦片：

1. **Esri World Street Map** — `server.arcgisonline.com/.../World_Street_Map`（含路网、地名、地形）
2. **OpenStreetMap 标准瓦片** — `tile.openstreetmap.org`（Esri 不可用时自动切换）

版权：**© Esri, HERE, Garmin, © OpenStreetMap contributors**。页面右下角已标注。
瓦片仅用于底图显示；仓库、订单、路线、航次等业务数据全部来自本仓库内的演示数据，在浏览器端绘制。

## 离线回退

若瓦片不可达，地图自动改用内置的州界轮廓（`us-states.js`）并提示「底图瓦片不可用，已切换到离线示意模式」。
此时点位、聚合、路线、检视器与派车计算仍然可用。

## us-states.js

简化版美国州界 GeoJSON（49 个本土州面，不含 AK / HI / PR 等，源自 U.S. Census Bureau 边界文件，公有领域），
仅用于离线回退显示。
