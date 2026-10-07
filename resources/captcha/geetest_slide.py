import io
import json
import sys

import ddddocr
from PIL import Image

# 用法: python geetest_slide.py <背景图路径> <拼图片路径>
# 输出: {"x": 缺口在背景图里的左边缘, "y": ..., "confidence": ...}
bg_path, slice_path = sys.argv[1], sys.argv[2]

slide = ddddocr.DdddOcr(det=False, ocr=False, show_ad=False)

# 按透明通道裁出拼图本体，ddddocr 转 RGB 时透明区域会变成黑色参与匹配
piece = Image.open(slice_path).convert("RGBA")
bbox = piece.split()[3].getbbox()
if bbox:
    piece = piece.crop(bbox)
buf = io.BytesIO()
piece.save(buf, format="PNG")

with open(bg_path, "rb") as f:
    background = f.read()

res = slide.slide_match(buf.getvalue(), background)
# ddddocr 返回的是匹配区域的中心点，换算回左边缘
x = int(res["target_x"]) - piece.width // 2
print(json.dumps({
    "x": x,
    "y": int(res["target_y"]) - piece.height // 2,
    "confidence": float(res.get("confidence", 0)),
}))
