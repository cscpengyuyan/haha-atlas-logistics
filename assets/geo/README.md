# 地理数据出处

## us-states / geo.js 州界
来源：简化版美国州界 GeoJSON（源自 U.S. Census Bureau 边界文件，公有领域）。
仅保留本土 49 个面（不含 AK / HI / PR 等），已按 Albers 等积圆锥投影预计算为 SVG path。

## 道路
来源：U.S. Census Bureau TIGER/Line 2025 Primary Roads 与 Primary/Secondary Roads。
https://www2.census.gov/geo/tiger/TIGER2025/PRIMARYROADS/
已裁剪、简化（Douglas–Peucker，屏幕坐标容差 0.7–1.1 px）并按等级合并为三条 SVG path。
仅作示意图，不含转向、交通、限行或商用路径规划信息。

## 投影
Albers equal-area conic，标准纬线 29.5° / 45.5°，原点 37.5°，中央经线 96°W，
球体半径 6,378,137 m。构建脚本见仓库根目录 	ools/build_geo.py（离线运行一次）。

## 说明
本仓库不含任何商业瓦片服务、API Key 或第三方运行时依赖。
