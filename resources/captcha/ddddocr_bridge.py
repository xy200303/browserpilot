import io
import json
import sys

import ddddocr
from PIL import Image

# 用法:
#   python ddddocr_bridge.py slide <背景图> <拼图片>   → {"x","y","confidence"}
#   python ddddocr_bridge.py ocr <图片>                → {"text"}
#   python ddddocr_bridge.py det <图片>                → {"bboxes": [[x1,y1,x2,y2],...]}
mode = sys.argv[1]

if mode == "slide":
    bg_path, slice_path = sys.argv[2], sys.argv[3]
    slide = ddddocr.DdddOcr(det=False, ocr=False, show_ad=False)
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
    print(json.dumps({
        "x": int(res["target_x"]) - piece.width // 2,
        "y": int(res["target_y"]) - piece.height // 2,
        "confidence": float(res.get("confidence", 0)),
    }))
elif mode == "ocr":
    ocr = ddddocr.DdddOcr(show_ad=False)
    with open(sys.argv[2], "rb") as f:
        print(json.dumps({"text": ocr.classification(f.read())}))
elif mode == "det":
    det = ddddocr.DdddOcr(det=True, ocr=False, show_ad=False)
    with open(sys.argv[2], "rb") as f:
        print(json.dumps({"bboxes": det.detection(f.read())}))
else:
    print(json.dumps({"error": f"unknown mode {mode}"}))
    sys.exit(2)
